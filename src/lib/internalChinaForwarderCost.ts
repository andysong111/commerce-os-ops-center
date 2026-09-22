import { loadChinaOrderLedger } from "@/lib/chinaOrderLedger";
import { loadInternalChinaDraftWithQuantityOverrides } from "@/lib/internalChinaDraftQuantityOverride";
import {
  loadInternalChinaPurchaseDraft,
  type InternalChinaPurchaseDraft,
} from "@/lib/internalChinaPurchaseDraft";
import { seoulCalendarMonth } from "@/lib/monthlyPurchasePolicy";
import { temporaryOpsIdentity } from "@/lib/opsLoginBypass";
import {
  mergePriceAdjustmentReceiptCachePage,
  readPriceAdjustmentReceiptCache,
  type PriceAdjustmentReceipt,
} from "@/lib/priceAdjustmentReceiptCache";
import { pushCanonicalProductMasterSnapshotFromTrackerState } from "@/lib/productMasterCanonicalSync";
import {
  getProductLaunchAdminConfig,
  readProductLaunchState,
} from "@/lib/productLaunchTrackerServer";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";

export const INTERNAL_CHINA_FORWARDER_COST_OPERATION_TYPE =
  "INTERNAL_CHINA_FORWARDER_COST_CLOSE";

const SOURCE_SYSTEM = "fast-purchase-mvp";
const SOURCE = "ops-center-internal-china-forwarder-cost";
const DRAFT_ID = /^fast-purchase-draft:[a-f0-9]{20}$/;
const MAX_ACTUAL_COST_KRW = 1_000_000_000;

type StoredCostRow = {
  result_snapshot?: unknown;
  started_at?: unknown;
  updated_at?: unknown;
};

export type InternalChinaForwarderCostInput = {
  draftId?: unknown;
  cycleMonth?: unknown;
  actualCostKrw?: unknown;
};

export type InternalChinaReceiptCostReconciliation = {
  matchedRows: number;
  updatedRows: number;
  productMasterSynced: boolean;
  productMasterError: string | null;
};

export type InternalChinaForwarderCostSummary = {
  draftId: string;
  cycleMonth: string;
  productPurchaseCostKrw: number;
  domesticChinaFreightKrw: number;
  estimatedMultiplier: number;
  estimatedForwarderCostKrw: number;
  estimatedTotalOutflowKrw: number;
  actualCostKrw: number | null;
  actualTotalOutflowKrw: number | null;
  actualMultiplier: number | null;
  closedAt: string | null;
  appliesToProductUnitCost: true;
  appliesToPriceAdjustment: true;
  receiptCostReconciliation?: InternalChinaReceiptCostReconciliation | null;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function integer(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function decimal(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function validDraftId(value: unknown) {
  const draftId = text(value);
  if (!DRAFT_ID.test(draftId)) throw new Error("CHINA_FORWARDER_COST_DRAFT_INVALID");
  return draftId;
}

function validCycleMonth(value: unknown) {
  const cycleMonth = text(value);
  if (!/^\d{4}-\d{2}$/.test(cycleMonth)) {
    throw new Error("CHINA_FORWARDER_COST_CYCLE_MONTH_INVALID");
  }
  return cycleMonth;
}

function validActualCostKrw(value: unknown) {
  const actualCostKrw = integer(value);
  if (actualCostKrw <= 0) throw new Error("CHINA_FORWARDER_COST_AMOUNT_REQUIRED");
  if (actualCostKrw > MAX_ACTUAL_COST_KRW) {
    throw new Error("CHINA_FORWARDER_COST_AMOUNT_EXCEEDED");
  }
  return actualCostKrw;
}

function sourceEventId(draftId: string) {
  return `internal-china-forwarder-cost:${draftId}`;
}

function correlationId(draftId: string) {
  return `internal-china-purchase:${draftId}`;
}

function supabaseConnection() {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const secret = (
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  )?.trim();
  if (!baseUrl || !secret) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  return { baseUrl, secret };
}

function freightGroups(draft: InternalChinaPurchaseDraft) {
  const groups = new Map<string, { quantity: number; freightCny: number }>();
  for (const line of draft.lines) {
    const key = line.freightGroupId.trim() || `__${line.barcode}`;
    const current = groups.get(key) ?? { quantity: 0, freightCny: 0 };
    current.quantity += line.quantity;
    current.freightCny += decimal(line.domesticChinaFreightCny);
    groups.set(key, current);
  }
  return groups;
}

function productPurchaseCostKrw(draft: InternalChinaPurchaseDraft) {
  const totalCny = draft.lines.reduce(
    (sum, line) => sum + decimal(line.unitPriceCny) * line.quantity,
    0,
  );
  return Math.max(1, Math.round(totalCny * draft.exchangeRateKrwPerCny));
}

function domesticChinaFreightKrw(draft: InternalChinaPurchaseDraft) {
  const totalCny = [...freightGroups(draft).values()].reduce(
    (sum, group) => sum + group.freightCny,
    0,
  );
  return Math.max(0, Math.round(totalCny * draft.exchangeRateKrwPerCny));
}

function landedCostMultiplier(
  draft: InternalChinaPurchaseDraft,
  actualForwarderCostKrw: number,
) {
  const productCost = productPurchaseCostKrw(draft);
  return productCost > 0
    ? (productCost + actualForwarderCostKrw) / productCost
    : 1;
}

function productUnitCostByBarcode(
  draft: InternalChinaPurchaseDraft,
  multiplier: number,
) {
  const groups = freightGroups(draft);
  const result = new Map<string, number>();
  for (const line of draft.lines) {
    const key = line.freightGroupId.trim() || `__${line.barcode}`;
    const group = groups.get(key) ?? { quantity: line.quantity, freightCny: 0 };
    const freightPerUnitKrw =
      group.quantity > 0
        ? (group.freightCny / group.quantity) * draft.exchangeRateKrwPerCny
        : 0;
    const productUnitKrw =
      decimal(line.unitPriceCny) * draft.exchangeRateKrwPerCny;
    const landedUnitKrw = productUnitKrw * multiplier + freightPerUnitKrw;
    result.set(line.barcode, Math.max(1, Math.round(landedUnitKrw)));
  }
  return result;
}

export function buildInternalChinaForwarderCostSummaryFromDraft(
  draft: InternalChinaPurchaseDraft,
  cycleMonth: string,
  actualCostKrw: number | null,
  closedAt: string | null,
  receiptCostReconciliation: InternalChinaReceiptCostReconciliation | null = null,
): InternalChinaForwarderCostSummary {
  const productCost = productPurchaseCostKrw(draft);
  const domesticFreight = domesticChinaFreightKrw(draft);
  const estimatedForwarder = Math.max(
    0,
    Math.round(productCost * (draft.internalOrderCostMultiplier - 1)),
  );
  const estimatedTotal = productCost + estimatedForwarder + domesticFreight;
  const actualMultiplierRaw =
    actualCostKrw === null || productCost <= 0
      ? null
      : (productCost + actualCostKrw) / productCost;
  const actualTotal =
    actualCostKrw === null
      ? null
      : productCost + actualCostKrw + domesticFreight;

  return {
    draftId: draft.draftId,
    cycleMonth,
    productPurchaseCostKrw: productCost,
    domesticChinaFreightKrw: domesticFreight,
    estimatedMultiplier: draft.internalOrderCostMultiplier,
    estimatedForwarderCostKrw: estimatedForwarder,
    estimatedTotalOutflowKrw: estimatedTotal,
    actualCostKrw,
    actualTotalOutflowKrw: actualTotal,
    actualMultiplier:
      actualMultiplierRaw === null
        ? null
        : Math.round(actualMultiplierRaw * 10_000) / 10_000,
    closedAt,
    appliesToProductUnitCost: true,
    appliesToPriceAdjustment: true,
    receiptCostReconciliation,
  };
}

async function syncReceiptCostsToProductMaster() {
  const config = getProductLaunchAdminConfig();
  if (!config.ok) throw new Error(config.body.message);
  const identity = temporaryOpsIdentity();
  const stored = await readProductLaunchState(config.value, identity.userId);
  if (!stored?.state_payload || typeof stored.state_payload !== "object") {
    throw new Error("PRODUCT_LAUNCH_STATE_REQUIRED");
  }
  return pushCanonicalProductMasterSnapshotFromTrackerState(stored.state_payload);
}

async function reconcileReceiptCosts(
  draft: InternalChinaPurchaseDraft,
  cycleMonth: string,
  actualForwarderCostKrw: number,
): Promise<InternalChinaReceiptCostReconciliation> {
  const cache = await readPriceAdjustmentReceiptCache();
  if (!cache) {
    return {
      matchedRows: 0,
      updatedRows: 0,
      productMasterSynced: false,
      productMasterError: "PRICE_ADJUSTMENT_RECEIPT_CACHE_REQUIRED",
    };
  }

  const multiplier = landedCostMultiplier(draft, actualForwarderCostKrw);
  const unitCosts = productUnitCostByBarcode(draft, multiplier);
  const cycleBatchId = Number(cycleMonth.replace("-", ""));
  const corrections: PriceAdjustmentReceipt[] = [];
  let matchedRows = 0;

  for (const line of draft.lines) {
    const nextUnitCostKrw = unitCosts.get(line.barcode);
    if (!nextUnitCostKrw) continue;
    const rows = cache.receiptsByBarcode[line.barcode] ?? [];
    for (const row of rows) {
      if (
        row.batchId !== cycleBatchId ||
        !row.id.startsWith("china-receipt:")
      ) {
        continue;
      }
      matchedRows += 1;
      corrections.push({ ...row, unitCostKrw: nextUnitCostKrw });
    }
  }

  if (!corrections.length) {
    return {
      matchedRows,
      updatedRows: 0,
      productMasterSynced: false,
      productMasterError: "LANDED_RECEIPT_ROWS_NOT_FOUND",
    };
  }

  await mergePriceAdjustmentReceiptCachePage({
    snapshotId: cache.snapshotId,
    generatedAt: new Date().toISOString(),
    complete: cache.complete,
    receipts: corrections,
  });

  try {
    await syncReceiptCostsToProductMaster();
    return {
      matchedRows,
      updatedRows: corrections.length,
      productMasterSynced: true,
      productMasterError: null,
    };
  } catch (error) {
    return {
      matchedRows,
      updatedRows: corrections.length,
      productMasterSynced: false,
      productMasterError:
        error instanceof Error
          ? error.message
          : "PRODUCT_MASTER_LANDED_RECEIPT_SYNC_FAILED",
    };
  }
}

async function readStoredCost(draftId: string) {
  const { baseUrl, secret } = supabaseConnection();
  const response = await fetch(
    `${baseUrl}/rest/v1/commerce_operation_runs?operation_type=eq.${INTERNAL_CHINA_FORWARDER_COST_OPERATION_TYPE}&source_event_id=eq.${encodeURIComponent(sourceEventId(draftId))}&select=result_snapshot,started_at,updated_at&limit=1`,
    {
      headers: createSupabaseAdminHeaders(secret),
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    },
  );
  if (!response.ok) {
    throw new Error(`CHINA_FORWARDER_COST_READ_FAILED:${response.status}`);
  }
  const rows = (await response.json().catch(() => [])) as StoredCostRow[];
  const row = rows[0];
  const snapshot = object(row?.result_snapshot);
  if (text(snapshot.draftId) !== draftId) return null;
  const actualCostKrw = integer(snapshot.actualCostKrw);
  if (actualCostKrw <= 0) return null;
  return {
    actualCostKrw,
    closedAt:
      text(snapshot.closedAt) ||
      text(row?.updated_at) ||
      text(row?.started_at) ||
      null,
  };
}

async function storeSummary(
  draftId: string,
  actualCycleMonth: string,
  actualCostKrw: number,
  summary: InternalChinaForwarderCostSummary,
  reconciliation: InternalChinaReceiptCostReconciliation,
  now: string,
) {
  const { baseUrl, secret } = supabaseConnection();
  const response = await fetch(
    `${baseUrl}/rest/v1/commerce_operation_runs?on_conflict=source_event_id&select=source_event_id,result_snapshot,updated_at`,
    {
      method: "POST",
      headers: {
        ...createSupabaseAdminHeaders(secret),
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify([
        {
          operation_type: INTERNAL_CHINA_FORWARDER_COST_OPERATION_TYPE,
          status: "SUCCEEDED",
          source: SOURCE,
          source_event_id: sourceEventId(draftId),
          correlation_id: correlationId(draftId),
          actor_type: "OPS_OPERATOR",
          input_snapshot: {
            draftId,
            cycleMonth: actualCycleMonth,
            actualCostKrw,
          },
          result_snapshot: summary,
          error_message: reconciliation.productMasterError,
          started_at: now,
          finished_at: now,
          updated_at: now,
        },
      ]),
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    },
  );
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `CHINA_FORWARDER_COST_STORE_FAILED:${response.status}:${body.slice(0, 300)}`,
    );
  }
}

export async function loadInternalChinaForwarderCostSummary(
  draftIdInput: unknown,
  cycleMonthInput: unknown,
): Promise<InternalChinaForwarderCostSummary> {
  const draftId = validDraftId(draftIdInput);
  const cycleMonth = validCycleMonth(cycleMonthInput);
  const draft = await loadInternalChinaDraftWithQuantityOverrides(
    await loadInternalChinaPurchaseDraft(draftId),
  );
  const stored = await readStoredCost(draftId);
  return buildInternalChinaForwarderCostSummaryFromDraft(
    draft,
    cycleMonth,
    stored?.actualCostKrw ?? null,
    stored?.closedAt ?? null,
  );
}

export async function recordInternalChinaForwarderCost(
  input: InternalChinaForwarderCostInput,
): Promise<InternalChinaForwarderCostSummary> {
  const draftId = validDraftId(input.draftId);
  const requestedCycleMonth = validCycleMonth(input.cycleMonth);
  const actualCostKrw = validActualCostKrw(input.actualCostKrw);

  const ledger = await loadChinaOrderLedger();
  if (ledger.error) {
    throw new Error(`CHINA_FORWARDER_COST_LEDGER_UNAVAILABLE:${ledger.error}`);
  }
  const commitments = ledger.commitments.filter(
    (row) => row.sourceSystem === SOURCE_SYSTEM && row.sourceRunId === draftId,
  );
  if (!commitments.length) throw new Error("CHINA_FORWARDER_COST_DRAFT_NOT_FOUND");

  const actualCycleMonth = seoulCalendarMonth(
    commitments.reduce((earliest, row) => {
      const candidate = row.reservedAt || row.updatedAt;
      if (!earliest) return candidate;
      return Date.parse(candidate) < Date.parse(earliest) ? candidate : earliest;
    }, ""),
  );
  if (actualCycleMonth !== requestedCycleMonth) {
    throw new Error(
      `CHINA_FORWARDER_COST_CYCLE_MONTH_CONFLICT:${requestedCycleMonth}:${actualCycleMonth}`,
    );
  }
  const openQuantity = commitments.reduce((sum, row) => sum + row.openQuantity, 0);
  if (openQuantity > 0) {
    throw new Error(`CHINA_FORWARDER_COST_RECEIPT_OPEN:${openQuantity}`);
  }

  const draft = await loadInternalChinaDraftWithQuantityOverrides(
    await loadInternalChinaPurchaseDraft(draftId),
  );
  let reconciliation: InternalChinaReceiptCostReconciliation;
  try {
    reconciliation = await reconcileReceiptCosts(
      draft,
      actualCycleMonth,
      actualCostKrw,
    );
  } catch (error) {
    reconciliation = {
      matchedRows: 0,
      updatedRows: 0,
      productMasterSynced: false,
      productMasterError:
        error instanceof Error
          ? error.message
          : "LANDED_RECEIPT_RECONCILIATION_FAILED",
    };
  }

  const now = new Date().toISOString();
  const summary = buildInternalChinaForwarderCostSummaryFromDraft(
    draft,
    actualCycleMonth,
    actualCostKrw,
    now,
    reconciliation,
  );
  await storeSummary(
    draftId,
    actualCycleMonth,
    actualCostKrw,
    summary,
    reconciliation,
    now,
  );
  return summary;
}
