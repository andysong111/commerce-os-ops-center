import {
  CHINA_ORDER_EVENT_OPERATION_TYPE,
  loadChinaOrderLedger,
  normalizeChinaOrderCommitmentEvent,
} from "@/lib/chinaOrderLedger";
import {
  INTERNAL_CHINA_QUANTITY_OVERRIDE_OPERATION_TYPE,
  loadInternalChinaDraftWithQuantityOverrides,
  loadInternalChinaQuantityOverrides,
} from "@/lib/internalChinaDraftQuantityOverride";
import {
  loadInternalChinaPurchaseDraft,
  type InternalChinaPurchaseDraft,
} from "@/lib/internalChinaPurchaseDraft";
import {
  normalizePurchaseDraftDirectEditRequest,
} from "@/lib/internalChinaPurchaseDraftDirectEditCore";
import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import { PURCHASE_DRAFT_MANUAL_ADDITION_PROVENANCE_VERSION } from "@/lib/purchaseCycleDraftRegenerationCore";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";

const SOURCE_SYSTEM = "fast-purchase-mvp";
const DIRECT_EDIT_SOURCE = "ops-center-internal-china-order-direct-edit";

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function normalizedBarcode(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

function supabaseConnection() {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const secret = (
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  )?.trim();
  if (!baseUrl || !secret) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  return { baseUrl, secret };
}

function quantityOverrideOperation(input: {
  draftId: string;
  barcode: string;
  targetQuantity: number;
  requestId: string;
  occurredAt: string;
}) {
  return {
    operation_type: INTERNAL_CHINA_QUANTITY_OVERRIDE_OPERATION_TYPE,
    status: "SUCCEEDED",
    source: DIRECT_EDIT_SOURCE,
    source_event_id: `internal-china-quantity:${input.draftId}:${input.barcode}:direct-edit:${input.requestId}`,
    correlation_id: `internal-china-quantity:${input.draftId}:${input.barcode}`,
    actor_type: "OPS_OPERATOR",
    input_snapshot: {
      draftId: input.draftId,
      barcode: input.barcode,
      targetQuantity: input.targetQuantity,
      savedAt: input.occurredAt,
      requestId: input.requestId,
      directEdit: true,
    },
    result_snapshot: {
      accepted: true,
      draftId: input.draftId,
      barcode: input.barcode,
      targetQuantity: input.targetQuantity,
      directEdit: true,
      externalOrderExecuted: false,
    },
    error_message: null,
    started_at: input.occurredAt,
    finished_at: input.occurredAt,
    updated_at: input.occurredAt,
  };
}

function manualAdditionOperation(input: {
  draft: InternalChinaPurchaseDraft;
  barcode: string;
  targetQuantity: number;
  requestId: string;
  occurredAt: string;
  product: { modelNo?: unknown; productName?: unknown; optionName?: unknown };
}) {
  const event = normalizeChinaOrderCommitmentEvent({
    sourceSystem: SOURCE_SYSTEM,
    sourceLineId: `${input.draft.draftId}:${input.barcode}`,
    sourceRunId: input.draft.draftId,
    sourceEventId: `${input.draft.draftId}:${input.barcode}:direct-edit:${input.requestId}`,
    barcode: input.barcode,
    status: "RESERVED",
    requestedQuantity: input.targetQuantity,
    occurredAt: input.occurredAt,
    note: `현재 발주초안 직접 편집 · 목표수량 ${input.targetQuantity}개`,
    payload: {
      manualAddition: true,
      directEdit: true,
      manualAdditionProvenanceVersion:
        PURCHASE_DRAFT_MANUAL_ADDITION_PROVENANCE_VERSION,
      modelNo: text(input.product.modelNo),
      productName: text(input.product.productName),
      optionName: text(input.product.optionName),
      previousRequestedQuantity: 0,
      addedQuantity: input.targetQuantity,
      targetRequestedQuantity: input.targetQuantity,
      externalOrderExecuted: false,
    },
  });
  return {
    operation_type: CHINA_ORDER_EVENT_OPERATION_TYPE,
    status: "SUCCEEDED",
    source: DIRECT_EDIT_SOURCE,
    source_event_id: `china-order:${encodeURIComponent(event.sourceSystem)}:${encodeURIComponent(event.sourceEventId)}`,
    correlation_id: `china-order-line:${encodeURIComponent(event.sourceSystem)}:${encodeURIComponent(event.sourceLineId)}`,
    actor_type: "OPS_OPERATOR",
    input_snapshot: event,
    result_snapshot: {
      accepted: true,
      internalDraft: true,
      manualAddition: true,
      directEdit: true,
      externalOrderExecuted: false,
      draftId: input.draft.draftId,
      barcode: input.barcode,
      targetRequestedQuantity: input.targetQuantity,
    },
    error_message: null,
    started_at: input.occurredAt,
    finished_at: input.occurredAt,
    updated_at: input.occurredAt,
  };
}

export async function applyInternalChinaPurchaseDraftDirectEdit(
  draftIdInput: unknown,
  requestInput: unknown,
) {
  const request = normalizePurchaseDraftDirectEditRequest(requestInput);
  const draft = await loadInternalChinaPurchaseDraft(draftIdInput);
  if (draft.status !== "DRAFT") throw new Error("INTERNAL_CHINA_DRAFT_ALREADY_ORDERED");

  const [planning, ledger] = await Promise.all([
    loadProductPlanningSnapshot(),
    loadChinaOrderLedger(),
  ]);
  if (ledger.error) throw new Error(`CHINA_ORDER_LEDGER_UNAVAILABLE:${ledger.error}`);
  const draftCommitments = ledger.commitments.filter(
    (row) => row.sourceSystem === SOURCE_SYSTEM && row.sourceRunId === draft.draftId,
  );
  if (draftCommitments.some((row) =>
    row.orderedQuantity > 0 ||
    ["ORDERED", "PARTIALLY_RECEIVED", "RECEIVED"].includes(row.status)
  )) {
    throw new Error("PURCHASE_DRAFT_DIRECT_EDIT_AFTER_ORDER_STARTED");
  }

  const currentBarcodes = new Set(draft.lines.map((line) => normalizedBarcode(line.barcode)));
  for (const row of request.quantityChanges) {
    if (!currentBarcodes.has(row.barcode)) {
      throw new Error(`PURCHASE_DRAFT_DIRECT_EDIT_LINE_NOT_FOUND:${row.barcode}`);
    }
  }
  for (const barcode of request.excludedBarcodes) {
    if (!currentBarcodes.has(barcode)) {
      throw new Error(`PURCHASE_DRAFT_DIRECT_EDIT_LINE_NOT_FOUND:${barcode}`);
    }
  }

  const productByBarcode = new Map(
    planning.products
      .filter((row) => row.skuActive !== false)
      .map((row) => [normalizedBarcode(row.barcode), row] as const),
  );
  for (const row of request.additions) {
    if (currentBarcodes.has(row.barcode)) continue;
    if (draftCommitments.some((commitment) =>
      normalizedBarcode(commitment.barcode) === row.barcode &&
      ["CANCELLED", "FAILED"].includes(commitment.status)
    )) {
      throw new Error(`INTERNAL_CHINA_MANUAL_ADD_CANCELLED_LINE:${row.barcode}`);
    }
    if (!productByBarcode.has(row.barcode)) {
      throw new Error(`INTERNAL_CHINA_MANUAL_ADD_BARCODE_NOT_ACTIVE:${row.barcode}`);
    }
  }

  const occurredAt = new Date().toISOString();
  const operations: Record<string, unknown>[] = [];
  for (const row of request.additions) {
    if (currentBarcodes.has(row.barcode)) {
      operations.push(quantityOverrideOperation({
        draftId: draft.draftId,
        ...row,
        requestId: request.requestId,
        occurredAt,
      }));
      continue;
    }
    operations.push(manualAdditionOperation({
      draft,
      ...row,
      requestId: request.requestId,
      occurredAt,
      product: productByBarcode.get(row.barcode)!,
    }));
  }
  for (const row of request.quantityChanges) {
    operations.push(quantityOverrideOperation({
      draftId: draft.draftId,
      ...row,
      requestId: request.requestId,
      occurredAt,
    }));
  }
  for (const barcode of request.excludedBarcodes) {
    operations.push(quantityOverrideOperation({
      draftId: draft.draftId,
      barcode,
      targetQuantity: 0,
      requestId: request.requestId,
      occurredAt,
    }));
  }

  const { baseUrl, secret } = supabaseConnection();
  const response = await fetch(
    `${baseUrl}/rest/v1/commerce_operation_runs?on_conflict=source_event_id&select=source_event_id`,
    {
      method: "POST",
      headers: {
        ...createSupabaseAdminHeaders(secret),
        "content-type": "application/json",
        Prefer: "resolution=ignore-duplicates,return=representation",
      },
      body: JSON.stringify(operations),
      cache: "no-store",
    },
  );
  const responseBody = await response.text();
  if (!response.ok) {
    throw new Error(
      `PURCHASE_DRAFT_DIRECT_EDIT_STORE_FAILED:${response.status}:${responseBody.slice(0, 300)}`,
    );
  }

  const base = await loadInternalChinaPurchaseDraft(draft.draftId);
  const [updatedDraft, overrides] = await Promise.all([
    loadInternalChinaDraftWithQuantityOverrides(base),
    loadInternalChinaQuantityOverrides(draft.draftId),
  ]);
  const lineByBarcode = new Map(updatedDraft.lines.map((line) => [line.barcode, line] as const));
  for (const row of [...request.additions, ...request.quantityChanges]) {
    if (lineByBarcode.get(row.barcode)?.quantity !== row.targetQuantity) {
      throw new Error(`PURCHASE_DRAFT_DIRECT_EDIT_READBACK_MISMATCH:${row.barcode}`);
    }
  }
  for (const barcode of request.excludedBarcodes) {
    if (lineByBarcode.has(barcode)) {
      throw new Error(`PURCHASE_DRAFT_DIRECT_EDIT_READBACK_MISMATCH:${barcode}`);
    }
  }

  return {
    draft: updatedDraft,
    overrides: [...overrides.values()].sort((left, right) =>
      left.barcode.localeCompare(right.barcode)
    ),
    addedCount: request.additions.length,
    removedCount: request.excludedBarcodes.length,
    changedCount: request.quantityChanges.length,
    externalOrderExecuted: false as const,
  };
}
