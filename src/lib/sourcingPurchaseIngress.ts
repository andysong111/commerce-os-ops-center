import { createHash } from "node:crypto";

import {
  CHINA_ORDER_EVENT_OPERATION_TYPE,
  loadChinaOrderLedger,
  normalizeChinaOrderCommitmentEvent,
} from "@/lib/chinaOrderLedger";
import { resolveExistingSourcingPurchase as resolveExistingSourcingPurchaseDomain } from "@/domain/sourcing-purchase-replay";
import { seoulCalendarMonth } from "@/lib/monthlyPurchasePolicy";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";

const SOURCE_SYSTEM = "fast-purchase-mvp";
const SOURCE = "sourcing-confirmed-auto-ingress";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BARCODE = /^[A-Z]{3}\d+-\d+$/;
const MODEL_NO = /^AAA\d{3,}(?:-\d+)?$/i;
const DRAFT_ID = /^fast-purchase-draft:[a-f0-9]{20}$/;

export type SourcingPurchaseIngressInput = {
  intakeId?: unknown;
  outboxId?: unknown;
  barcode?: unknown;
  modelNumber?: unknown;
  productName?: unknown;
  quantity?: unknown;
  unitPriceCny?: unknown;
  saleOption?: unknown;
  chinaOption?: unknown;
  supplierLink?: unknown;
  sourceConfirmedAt?: unknown;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}
function integer(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}
function decimal(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
function normalizeUrl(value: unknown) {
  const candidate = text(value);
  if (!candidate) return "";
  if (candidate.length > 4000) throw new Error("SOURCING_PURCHASE_SUPPLIER_LINK_TOO_LONG");
  try {
    const url = new URL(candidate);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("INVALID_PROTOCOL");
    return url.toString();
  } catch {
    throw new Error("SOURCING_PURCHASE_SUPPLIER_LINK_INVALID");
  }
}
function supabaseConnection() {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const secret = (
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  )?.trim();
  if (!baseUrl || !secret) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  return { baseUrl, secret };
}
function deterministicDraftId(cycleMonth: string) {
  const digest = createHash("sha256")
    .update("commerce-os:sourcing-cycle:" + cycleMonth + ":v1")
    .digest("hex")
    .slice(0, 20);
  return "fast-purchase-draft:" + digest;
}
function rowCycle(row: { reservedAt: string | null; updatedAt: string }) {
  return seoulCalendarMonth(row.reservedAt || row.updatedAt);
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function resolveExistingSourcingPurchase(
  commitments: ChinaOrderCommitmentSnapshot[],
  normalized: ReturnType<typeof normalizeSourcingPurchaseIngress>,
) {
  const matches = commitments.filter((row) => {
    if (row.sourceSystem !== SOURCE_SYSTEM) return false;
    const payload = record(row.latestPayload);
    return (
      text(payload.sourcingOutboxId).toLowerCase() === normalized.outboxId ||
      text(payload.sourcingIntakeId).toLowerCase() === normalized.intakeId
    );
  });
  if (!matches.length) return null;
  if (matches.length > 1) throw new Error("SOURCING_PURCHASE_REPLAY_AMBIGUOUS");

  const row = matches[0];
  const payload = record(row.latestPayload);
  if (
    text(payload.sourcingOutboxId).toLowerCase() !== normalized.outboxId ||
    text(payload.sourcingIntakeId).toLowerCase() !== normalized.intakeId ||
    row.barcode !== normalized.barcode ||
    text(payload.modelNo).toUpperCase() !== normalized.modelNumber ||
    text(payload.productName) !== normalized.productName ||
    row.requestedQuantity !== normalized.quantity
  ) {
    throw new Error("SOURCING_PURCHASE_REPLAY_IDENTITY_CONFLICT");
  }
  if (!row.sourceRunId || !DRAFT_ID.test(row.sourceRunId)) {
    throw new Error("SOURCING_PURCHASE_REPLAY_DRAFT_INVALID");
  }
  return {
    ok: true as const,
    draftId: row.sourceRunId,
    cycleMonth: rowCycle(row),
    externalLineId: row.sourceLineId,
    barcode: normalized.barcode,
    modelNumber: normalized.modelNumber,
    productName: normalized.productName,
    quantity: normalized.quantity,
    duplicate: true as const,
    externalOrderExecuted: false as const,
  };
}

export function normalizeSourcingPurchaseIngress(input: SourcingPurchaseIngressInput) {
  const intakeId = text(input.intakeId).toLowerCase();
  const outboxId = text(input.outboxId).toLowerCase();
  const barcode = text(input.barcode).toUpperCase().replace(/\s+/g, "");
  const modelNumber = text(input.modelNumber).toUpperCase();
  const productName = text(input.productName).slice(0, 240);
  const quantity = integer(input.quantity);
  const unitPriceCny = decimal(input.unitPriceCny);
  const saleOption = text(input.saleOption).slice(0, 200);
  const chinaOption = text(input.chinaOption).slice(0, 500);
  const supplierLink = normalizeUrl(input.supplierLink);
  const confirmed = Date.parse(text(input.sourceConfirmedAt));
  const sourceConfirmedAt = Number.isFinite(confirmed)
    ? new Date(confirmed).toISOString()
    : new Date().toISOString();

  if (!UUID.test(intakeId) || !UUID.test(outboxId)) {
    throw new Error("SOURCING_PURCHASE_IDENTITY_INVALID");
  }
  if (!BARCODE.test(barcode)) throw new Error("SOURCING_PURCHASE_BCODE_INVALID");
  if (!MODEL_NO.test(modelNumber)) throw new Error("SOURCING_PURCHASE_MODEL_INVALID");
  if (!productName) throw new Error("SOURCING_PURCHASE_PRODUCT_NAME_REQUIRED");
  if (quantity < 1 || quantity > 9999) throw new Error("SOURCING_PURCHASE_QUANTITY_INVALID");
  if (!(unitPriceCny > 0 && unitPriceCny <= 1_000_000)) {
    throw new Error("SOURCING_PURCHASE_UNIT_PRICE_INVALID");
  }
  return {
    intakeId, outboxId, barcode, modelNumber, productName, quantity, unitPriceCny,
    saleOption, chinaOption, supplierLink, sourceConfirmedAt,
  };
}

export async function ingestSourcingPurchase(input: SourcingPurchaseIngressInput) {
  const normalized = normalizeSourcingPurchaseIngress(input);
  const ledger = await loadChinaOrderLedger();
  if (ledger.error) throw new Error("SOURCING_PURCHASE_LEDGER_UNAVAILABLE:" + ledger.error);

  const replay = resolveExistingSourcingPurchase(ledger.commitments, normalized);
  if (replay) return replay;

  const cycleMonth = seoulCalendarMonth(normalized.sourceConfirmedAt);
  const cycleRows = ledger.commitments.filter(
    (row) => row.sourceSystem === SOURCE_SYSTEM && rowCycle(row) === cycleMonth,
  );
  const draftIds = [
    ...new Set(
      cycleRows
        .map((row) => row.sourceRunId)
        .filter((value): value is string => Boolean(value && DRAFT_ID.test(value))),
    ),
  ];
  if (draftIds.length > 1) throw new Error("SOURCING_PURCHASE_MULTIPLE_MONTH_DRAFTS");
  if (
    cycleRows.some(
      (row) =>
        row.orderedQuantity > 0 ||
        row.receivedQuantity > 0 ||
        ["ORDERED", "PARTIALLY_RECEIVED", "RECEIVED"].includes(row.status),
    )
  ) {
    throw new Error("SOURCING_PURCHASE_MONTH_ALREADY_PROGRESSING");
  }

  const draftId = draftIds[0] || deterministicDraftId(cycleMonth);
  const sourceLineId = draftId + ":" + normalized.barcode;
  const sourceEventId =
    draftId + ":" + normalized.barcode + ":sourcing:" + normalized.outboxId;
  const occurredAt = new Date().toISOString();
  const event = normalizeChinaOrderCommitmentEvent({
    sourceSystem: SOURCE_SYSTEM,
    sourceLineId,
    sourceRunId: draftId,
    sourceEventId,
    barcode: normalized.barcode,
    status: "RESERVED",
    requestedQuantity: normalized.quantity,
    occurredAt,
    note: "소싱확정 자동 인입 · " + normalized.modelNumber + " · " + normalized.productName,
    payload: {
      sourcingConfirmed: true,
      sourcingIntakeId: normalized.intakeId,
      sourcingOutboxId: normalized.outboxId,
      modelNo: normalized.modelNumber,
      productName: normalized.productName,
      saleOption: normalized.saleOption,
      chinaOption: normalized.chinaOption,
      supplierLink: normalized.supplierLink,
      unitPriceCny: normalized.unitPriceCny,
      sourceConfirmedAt: normalized.sourceConfirmedAt,
      externalOrderExecuted: false,
    },
  });

  const { baseUrl, secret } = supabaseConnection();
  const response = await fetch(
    baseUrl + "/rest/v1/commerce_operation_runs?on_conflict=source_event_id&select=source_event_id",
    {
      method: "POST",
      headers: {
        ...createSupabaseAdminHeaders(secret),
        Prefer: "resolution=ignore-duplicates,return=representation",
      },
      body: JSON.stringify([
        {
          operation_type: CHINA_ORDER_EVENT_OPERATION_TYPE,
          status: "SUCCEEDED",
          source: SOURCE,
          source_event_id:
            "china-order:" + encodeURIComponent(event.sourceSystem) + ":" +
            encodeURIComponent(event.sourceEventId),
          correlation_id:
            "china-order-line:" + encodeURIComponent(event.sourceSystem) + ":" +
            encodeURIComponent(event.sourceLineId),
          actor_type: "SYSTEM",
          input_snapshot: event,
          result_snapshot: {
            accepted: true,
            sourcingConfirmed: true,
            sourcingIntakeId: normalized.intakeId,
            sourcingOutboxId: normalized.outboxId,
            draftId,
            barcode: normalized.barcode,
            requestedQuantity: normalized.quantity,
            externalOrderExecuted: false,
          },
          error_message: null,
          started_at: occurredAt,
          finished_at: occurredAt,
          updated_at: occurredAt,
        },
      ]),
      cache: "no-store",
    },
  );
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      "SOURCING_PURCHASE_STORE_FAILED:" + response.status + ":" + body.slice(0, 300),
    );
  }
  const inserted = body ? (JSON.parse(body) as unknown) : [];
  const duplicate = Array.isArray(inserted) && inserted.length === 0;

  return {
    ok: true as const,
    draftId,
    cycleMonth,
    externalLineId: sourceLineId,
    barcode: normalized.barcode,
    modelNumber: normalized.modelNumber,
    productName: normalized.productName,
    quantity: normalized.quantity,
    duplicate,
    externalOrderExecuted: false as const,
  };
}
