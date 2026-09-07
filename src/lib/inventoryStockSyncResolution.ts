import type {
  InventoryStockControlReport,
  ShoplingStockDesiredStatus,
  ShoplingStockSyncEvent,
} from "@/lib/inventoryStockControl";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const STALE_UNRESOLVED_REASON =
  "이전 Shopling 실행이 STARTED/UNCERTAIN 상태라 중복 실행을 차단했습니다.";
const SHOPLING_STOCK_STATUS_SYNC_OPERATION_TYPE =
  "SHOPLING_STOCK_STATUS_SYNC_EVENT";
const OPERATOR_STOP_CODE = "STOCK_SYNC_OPERATOR_STOPPED";
const RESULT_TIMEOUT_CODE = "STOCK_SYNC_RESULT_TIMEOUT";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function truthy(value: unknown) {
  return value === true || text(value).toLowerCase() === "true";
}

function normalizedBarcode(value: unknown) {
  return text(value)
    .toUpperCase()
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/\s+/g, "");
}

function storedSnapshot(row: Record<string, unknown>) {
  const result = object(row.result_snapshot);
  const nested = object(result.snapshot);
  if (Object.keys(nested).length) return nested;
  const input = object(row.input_snapshot);
  return Object.keys(input).length ? input : result;
}

function legacyMarketplaceFailureCompletionEvidence(
  source: Record<string, unknown>,
  productKind: string,
) {
  const evidence = object(source.evidence);
  const result = object(evidence.result);
  const expectedComplete =
    productKind === "OPTION"
      ? truthy(result.optionComplete)
      : truthy(result.productComplete);
  const failureCount = Number(result.failureCount || 0);
  const marketplaceFailure =
    (Number.isFinite(failureCount) && failureCount > 0) ||
    truthy(result.explicitFailure);
  return Boolean(
    expectedComplete &&
      text(result.readyState).toLowerCase() === "complete" &&
      marketplaceFailure,
  );
}

function resultTimeoutRetryEvidence(
  source: Record<string, unknown>,
  productKind: string,
  desiredStatus: string,
) {
  if (productKind !== "OPTION") return false;
  const evidence = object(source.evidence);
  if (
    text(evidence.code).toUpperCase() !== RESULT_TIMEOUT_CODE ||
    text(evidence.stage).toUpperCase() !== "WAIT_A21_RESULT"
  ) {
    return false;
  }
  const history = Array.isArray(evidence.history)
    ? evidence.history.map(object)
    : [];
  const targetStatus = desiredStatus === "SOLD_OUT" ? "C" : "B";
  const optionApiVerified = history.some((entry) => {
    const optionEvidence = object(entry.optionApiEvidence);
    return Boolean(
      /^\d+$/.test(text(optionEvidence.matchedGoodsKey)) &&
        text(optionEvidence.statusAfter).toUpperCase() === targetStatus &&
        text(optionEvidence.targetStatusCode).toUpperCase() === targetStatus,
    );
  });
  const submitWasInvoked = history.some(
    (entry) =>
      text(entry.priceCoreStage).toUpperCase() === "SUBMIT_CLICKED" &&
      /^\d+$/.test(text(entry.goodsKey)),
  );
  return optionApiVerified && submitWasInvoked;
}

export function latestRelevantShoplingSync(
  events: ShoplingStockSyncEvent[],
  desiredStatus: ShoplingStockDesiredStatus,
  desiredSince: string,
) {
  const relevant = events
    .filter(
      (event) =>
        event.desiredStatus === desiredStatus &&
        event.occurredAt >= desiredSince,
    )
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  return relevant[relevant.length - 1] ?? null;
}

export function isUnresolvedShoplingSync(
  latest: ShoplingStockSyncEvent | null,
) {
  return Boolean(
    latest &&
      (latest.outcome === "STARTED" || latest.outcome === "UNCERTAIN"),
  );
}

export function normalizeRetryableShoplingSyncReport(
  report: InventoryStockControlReport,
): InventoryStockControlReport {
  let changed = false;
  const rows = report.rows.map((row) => {
    const staleFailedBlock =
      row.syncNeeded &&
      row.syncBlocked &&
      row.latestSyncOutcome === "FAILED" &&
      row.syncBlockReason === STALE_UNRESOLVED_REASON;
    if (!staleFailedBlock) return row;
    changed = true;
    return {
      ...row,
      syncBlocked: false,
      syncBlockReason: null,
    };
  });
  if (!changed) return report;
  return {
    ...report,
    rows,
    pendingSyncCount: rows.filter(
      (row) => row.syncNeeded && !row.syncBlocked,
    ).length,
  };
}

async function loadEvidenceRetryableBarcodes(
  report: InventoryStockControlReport,
) {
  const candidates = new Map(
    report.rows
      .filter(
        (row) =>
          row.syncNeeded &&
          row.syncBlocked &&
          row.latestSyncOutcome === "UNCERTAIN" &&
          row.syncBlockReason === STALE_UNRESOLVED_REASON,
      )
      .map((row) => [row.barcode, row] as const),
  );
  if (!candidates.size) return new Set<string>();

  const admin = await createSupabaseAdminClient();
  if (!admin) return new Set<string>();
  const correlations = [...candidates.keys()].map(
    (barcode) => `shopling-stock:${barcode}`,
  );
  const response = await admin
    .from("commerce_operation_runs")
    .select(
      "correlation_id,input_snapshot,result_snapshot,started_at,status",
    )
    .eq("operation_type", SHOPLING_STOCK_STATUS_SYNC_OPERATION_TYPE)
    .eq("status", "SUCCEEDED")
    .in("correlation_id", correlations)
    .order("started_at", { ascending: false })
    .limit(Math.min(2_000, Math.max(100, candidates.size * 40)));
  if (response.error) return new Set<string>();

  const storedRows = Array.isArray(response.data)
    ? (response.data as Array<Record<string, unknown>>)
    : [];
  const retryable = new Set<string>();
  const seen = new Set<string>();
  for (const row of storedRows) {
    const source = storedSnapshot(row);
    const barcode =
      normalizedBarcode(source.barcode) ||
      normalizedBarcode(
        text(row.correlation_id).replace(/^shopling-stock:/i, ""),
      );
    const candidate = candidates.get(barcode);
    if (!candidate || seen.has(barcode)) continue;
    seen.add(barcode);

    const outcome = text(source.outcome).toUpperCase();
    const evidence = object(source.evidence);
    const code = text(evidence.code).toUpperCase();
    const desiredStatus = text(source.desiredStatus).toUpperCase();
    const occurredAt =
      Date.parse(text(source.occurredAt)) || Date.parse(text(row.started_at));
    const desiredSince = Date.parse(candidate.desiredSince);
    const matchesCurrentDesiredState =
      desiredStatus === candidate.desiredStatus &&
      Number.isFinite(occurredAt) &&
      Number.isFinite(desiredSince) &&
      occurredAt >= desiredSince;
    const retryableOperatorStop = code === OPERATOR_STOP_CODE;
    const retryableLegacyMarketplaceFailure =
      legacyMarketplaceFailureCompletionEvidence(
        source,
        text(candidate.productKind).toUpperCase(),
      );
    const retryableResultTimeout = resultTimeoutRetryEvidence(
      source,
      text(candidate.productKind).toUpperCase(),
      desiredStatus,
    );

    if (
      matchesCurrentDesiredState &&
      outcome === "UNCERTAIN" &&
      (retryableOperatorStop ||
        retryableLegacyMarketplaceFailure ||
        retryableResultTimeout)
    ) {
      retryable.add(barcode);
    }
  }
  return retryable;
}

export async function normalizeRetryableShoplingSyncReportWithEvidence(
  report: InventoryStockControlReport,
): Promise<InventoryStockControlReport> {
  const normalized = normalizeRetryableShoplingSyncReport(report);
  const retryableBarcodes = await loadEvidenceRetryableBarcodes(normalized);
  if (!retryableBarcodes.size) return normalized;

  let changed = false;
  const rows = normalized.rows.map((row) => {
    const evidenceRetryableBlock =
      retryableBarcodes.has(row.barcode) &&
      row.syncNeeded &&
      row.syncBlocked &&
      row.latestSyncOutcome === "UNCERTAIN" &&
      row.syncBlockReason === STALE_UNRESOLVED_REASON;
    if (!evidenceRetryableBlock) return row;
    changed = true;
    return {
      ...row,
      syncBlocked: false,
      syncBlockReason: null,
    };
  });
  if (!changed) return normalized;

  return {
    ...normalized,
    rows,
    pendingSyncCount: rows.filter(
      (row) => row.syncNeeded && !row.syncBlocked,
    ).length,
    uncertainSyncCount: rows.filter(
      (row) =>
        row.syncNeeded &&
        row.syncBlocked &&
        row.latestSyncOutcome === "UNCERTAIN",
    ).length,
  };
}
