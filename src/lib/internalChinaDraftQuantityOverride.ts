import { createHash } from "node:crypto";
import {
  CHINA_ORDER_EVENT_OPERATION_TYPE,
  loadChinaOrderLedger,
  normalizeChinaOrderCommitmentEvent,
} from "@/lib/chinaOrderLedger";
import {
  loadInternalChinaMonthlyPurchaseSummary,
  type InternalChinaMonthlyPurchaseSummary,
} from "@/lib/internalChinaMonthlyPurchaseSummary";
import type {
  InternalChinaPurchaseDraft,
  InternalChinaPurchaseDraftInput,
} from "@/lib/internalChinaPurchaseDraft";
import {
  createSupabaseAdminClient,
  createSupabaseAdminHeaders,
} from "@/lib/supabase/admin";

export const INTERNAL_CHINA_QUANTITY_OVERRIDE_OPERATION_TYPE =
  "INTERNAL_CHINA_PURCHASE_QUANTITY_OVERRIDE";

const SOURCE_SYSTEM = "fast-purchase-mvp";
const OVERRIDE_SOURCE = "ops-center-internal-china-order-quantity-override";
const DRAFT_ID = /^fast-purchase-draft:[a-f0-9]{20}$/;
const BARCODE = /^[A-Z]{3}\d+-\d+$/;
const QUANTITY_MAX = 9_999;

type StoredOverrideRow = {
  input_snapshot?: unknown;
  started_at?: unknown;
};

export type InternalChinaQuantityOverride = {
  barcode: string;
  targetQuantity: number;
  savedAt: string;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function normalizeBarcode(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

function validDraftId(value: unknown) {
  const draftId = text(value);
  if (!DRAFT_ID.test(draftId)) {
    throw new Error("INTERNAL_CHINA_DRAFT_ID_INVALID");
  }
  return draftId;
}

function validBarcode(value: unknown) {
  const barcode = normalizeBarcode(value);
  if (!BARCODE.test(barcode)) {
    throw new Error(`INTERNAL_CHINA_QUANTITY_BARCODE_INVALID:${barcode}`);
  }
  return barcode;
}

function validQuantity(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error("INTERNAL_CHINA_QUANTITY_INVALID");
  }
  const quantity = Math.round(parsed);
  if (quantity < 1 || quantity > QUANTITY_MAX) {
    throw new Error("INTERNAL_CHINA_QUANTITY_INVALID");
  }
  return quantity;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function supabaseConnection() {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const secret = (
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  )?.trim();
  if (!baseUrl || !secret) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  return { baseUrl, secret };
}

export async function loadInternalChinaQuantityOverrides(
  draftIdInput: unknown,
): Promise<Map<string, InternalChinaQuantityOverride>> {
  const draftId = validDraftId(draftIdInput);
  const admin = await createSupabaseAdminClient();
  if (!admin) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");

  const result = await admin
    .from("commerce_operation_runs")
    .select("input_snapshot,started_at")
    .eq("operation_type", INTERNAL_CHINA_QUANTITY_OVERRIDE_OPERATION_TYPE)
    .eq("status", "SUCCEEDED")
    .order("started_at", { ascending: false })
    .limit(5000);
  if (result.error) throw new Error(result.error.message);

  const overrides = new Map<string, InternalChinaQuantityOverride>();
  for (const raw of Array.isArray(result.data) ? result.data : []) {
    const row = raw as StoredOverrideRow;
    const input = object(row.input_snapshot);
    if (text(input.draftId) !== draftId) continue;
    const barcode = normalizeBarcode(input.barcode);
    if (!BARCODE.test(barcode) || overrides.has(barcode)) continue;
    const targetQuantity = Number(input.targetQuantity);
    if (!Number.isFinite(targetQuantity)) continue;
    const quantity = Math.round(targetQuantity);
    if (quantity < 1 || quantity > QUANTITY_MAX) continue;
    overrides.set(barcode, {
      barcode,
      targetQuantity: quantity,
      savedAt: text(input.savedAt) || text(row.started_at),
    });
  }
  return overrides;
}

export function applyInternalChinaQuantityOverrides(
  draft: InternalChinaPurchaseDraft,
  overrides: Map<string, InternalChinaQuantityOverride>,
): InternalChinaPurchaseDraft {
  const lines = draft.lines.map((line) => {
    const override = overrides.get(normalizeBarcode(line.barcode));
    return override ? { ...line, quantity: override.targetQuantity } : line;
  });
  return {
    ...draft,
    lines,
    lineCount: lines.length,
    totalQuantity: lines.reduce((sum, line) => sum + line.quantity, 0),
  };
}

/**
 * The actual 1688 import stores goods, service fee and China domestic freight
 * separately. Operational landed-cost calculations must treat goods + 1688
 * service fee as the product purchase unit cost, while domestic freight stays
 * a separate per-order-group add-on. This overlay also upgrades already-saved
 * September data without rewriting the immutable source snapshot.
 */
export function applyInternalChinaActualPurchaseCosts(
  draft: InternalChinaPurchaseDraft,
  monthly: InternalChinaMonthlyPurchaseSummary | null,
): InternalChinaPurchaseDraft {
  if (!monthly) return draft;

  type ActualCostAggregate = {
    quantity: number;
    goodsPaidCny: number;
    serviceFeeCny: number;
    domesticChinaFreightCny: number;
  };
  const byBarcode = new Map<string, ActualCostAggregate>();
  for (const line of monthly.lines) {
    const key = normalizeBarcode(line.barcode);
    if (
      !line.assigned ||
      line.draftId !== draft.draftId ||
      !BARCODE.test(key)
    ) {
      continue;
    }
    const current = byBarcode.get(key) ?? {
      quantity: 0,
      goodsPaidCny: 0,
      serviceFeeCny: 0,
      domesticChinaFreightCny: 0,
    };
    current.quantity += line.quantity;
    current.goodsPaidCny += line.goodsPaidCny;
    current.serviceFeeCny += line.serviceFeeCny;
    current.domesticChinaFreightCny += line.domesticChinaFreightCny;
    byBarcode.set(key, current);
  }
  if (!byBarcode.size) return draft;

  const lines = draft.lines.map((line) => {
    const actual = byBarcode.get(normalizeBarcode(line.barcode));
    if (!actual || actual.quantity <= 0) return line;
    const actualProductUnitCny =
      (actual.goodsPaidCny + actual.serviceFeeCny) / actual.quantity;
    return {
      ...line,
      unitPriceCny:
        actualProductUnitCny > 0
          ? Math.round(actualProductUnitCny * 1_000_000) / 1_000_000
          : line.unitPriceCny,
      domesticChinaFreightCny:
        Math.round(actual.domesticChinaFreightCny * 10_000) / 10_000,
    };
  });
  return {
    ...draft,
    lines,
    lineCount: lines.length,
    totalQuantity: lines.reduce((sum, line) => sum + line.quantity, 0),
  };
}

export async function loadInternalChinaDraftWithQuantityOverrides(
  draft: InternalChinaPurchaseDraft,
) {
  const [overrides, monthly] = await Promise.all([
    loadInternalChinaQuantityOverrides(draft.draftId),
    loadInternalChinaMonthlyPurchaseSummary(draft.cycleMonth).catch(() => null),
  ]);
  return applyInternalChinaActualPurchaseCosts(
    applyInternalChinaQuantityOverrides(draft, overrides),
    monthly,
  );
}

export async function saveInternalChinaQuantityOverride(input: {
  draftId: unknown;
  barcode: unknown;
  targetQuantity: unknown;
}) {
  const draftId = validDraftId(input.draftId);
  const barcode = validBarcode(input.barcode);
  const targetQuantity = validQuantity(input.targetQuantity);
  const now = new Date().toISOString();
  const { baseUrl, secret } = supabaseConnection();
  const eventId = crypto.randomUUID();
  const response = await fetch(
    `${baseUrl}/rest/v1/commerce_operation_runs?select=source_event_id`,
    {
      method: "POST",
      headers: {
        ...createSupabaseAdminHeaders(secret),
        "content-type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify([
        {
          operation_type: INTERNAL_CHINA_QUANTITY_OVERRIDE_OPERATION_TYPE,
          status: "SUCCEEDED",
          source: OVERRIDE_SOURCE,
          source_event_id: `internal-china-quantity:${draftId}:${barcode}:${eventId}`,
          correlation_id: `internal-china-quantity:${draftId}:${barcode}`,
          actor_type: "OPS_OPERATOR",
          input_snapshot: {
            draftId,
            barcode,
            targetQuantity,
            savedAt: now,
          },
          result_snapshot: {
            accepted: true,
            draftId,
            barcode,
            targetQuantity,
            externalOrderExecuted: false,
          },
          error_message: null,
          started_at: now,
          finished_at: now,
          updated_at: now,
        },
      ]),
      cache: "no-store",
    },
  );
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `INTERNAL_CHINA_QUANTITY_STORE_FAILED:${response.status}:${body.slice(0, 300)}`,
    );
  }
  return { draftId, barcode, targetQuantity, savedAt: now };
}

export function stripDraftInputQuantities(
  input: InternalChinaPurchaseDraftInput,
): InternalChinaPurchaseDraftInput {
  return {
    ...input,
    lines: Array.isArray(input.lines)
      ? input.lines.map((line) => {
          const { quantity: _quantity, ...rest } = line;
          return rest;
        })
      : input.lines,
  };
}

function correctionEventId(draftId: string, barcode: string, target: number) {
  const digest = createHash("sha256")
    .update(`${draftId}:${barcode}:${target}:quantity-correction-v1`)
    .digest("hex")
    .slice(0, 16);
  return `${draftId}:${barcode}:quantity-correction:${digest}`;
}

export async function recordOrderedQuantityOverrideCorrections(
  draftIdInput: unknown,
) {
  const draftId = validDraftId(draftIdInput);
  const overrides = await loadInternalChinaQuantityOverrides(draftId);
  if (!overrides.size) return { correctedCount: 0 };

  const ledger = await loadChinaOrderLedger();
  if (ledger.error) {
    throw new Error(`CHINA_ORDER_LEDGER_UNAVAILABLE:${ledger.error}`);
  }
  const commitments = ledger.commitments
    .filter(
      (row) => row.sourceSystem === SOURCE_SYSTEM && row.sourceRunId === draftId,
    )
    .sort(
      (left, right) =>
        Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
    );
  const byBarcode = new Map<string, (typeof commitments)[number]>();
  for (const row of commitments) {
    const barcode = normalizeBarcode(row.barcode);
    if (!byBarcode.has(barcode)) byBarcode.set(barcode, row);
  }

  const now = new Date().toISOString();
  const operations: Record<string, unknown>[] = [];
  for (const [barcode, override] of overrides) {
    const commitment = byBarcode.get(barcode);
    if (!commitment) continue;
    const currentOpen = Math.max(0, commitment.openQuantity);
    const target = override.targetQuantity;
    if (target === currentOpen) continue;

    const upwardDelta = Math.max(0, target - currentOpen);
    const downwardDelta = Math.max(0, currentOpen - target);
    const orderedQuantity =
      upwardDelta > 0
        ? commitment.committedQuantity + upwardDelta
        : commitment.orderedQuantity;
    const cancelledQuantity =
      downwardDelta > 0
        ? commitment.cancelledQuantity + downwardDelta
        : commitment.cancelledQuantity;

    const event = normalizeChinaOrderCommitmentEvent({
      sourceSystem: commitment.sourceSystem,
      sourceLineId: commitment.sourceLineId,
      sourceRunId: draftId,
      sourceEventId: correctionEventId(draftId, barcode, target),
      barcode,
      status: "ORDERED",
      orderedQuantity,
      cancelledQuantity,
      occurredAt: now,
      note: `중국 발주초안 운영자 수량조정 · ${currentOpen}개 → ${target}개`,
      payload: {
        quantityOverride: true,
        targetQuantity: target,
        previousOpenQuantity: currentOpen,
        ...(upwardDelta > 0
          ? { manualAddition: true, addedQuantity: upwardDelta }
          : {}),
        externalOrderExecuted: false,
      },
    });

    operations.push({
      operation_type: CHINA_ORDER_EVENT_OPERATION_TYPE,
      status: "SUCCEEDED",
      source: OVERRIDE_SOURCE,
      source_event_id: `china-order:${encodeURIComponent(event.sourceSystem)}:${encodeURIComponent(event.sourceEventId)}`,
      correlation_id: `china-order-line:${encodeURIComponent(event.sourceSystem)}:${encodeURIComponent(event.sourceLineId)}`,
      actor_type: "OPS_OPERATOR",
      input_snapshot: event,
      result_snapshot: {
        accepted: true,
        quantityOverride: true,
        draftId,
        barcode,
        previousOpenQuantity: currentOpen,
        targetQuantity: target,
        externalOrderExecuted: false,
      },
      error_message: null,
      started_at: now,
      finished_at: now,
      updated_at: now,
    });
  }

  if (!operations.length) return { correctedCount: 0 };
  const { baseUrl, secret } = supabaseConnection();
  const response = await fetch(
    `${baseUrl}/rest/v1/commerce_operation_runs?on_conflict=source_event_id&select=source_event_id`,
    {
      method: "POST",
      headers: {
        ...createSupabaseAdminHeaders(secret),
        Prefer: "resolution=ignore-duplicates,return=representation",
      },
      body: JSON.stringify(operations),
      cache: "no-store",
    },
  );
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `INTERNAL_CHINA_QUANTITY_ORDER_CORRECTION_FAILED:${response.status}:${body.slice(0, 300)}`,
    );
  }
  const inserted = body ? (JSON.parse(body) as unknown) : [];
  return { correctedCount: Array.isArray(inserted) ? inserted.length : 0 };
}
