import { createHash } from "node:crypto";
import {
  buildCandidateRollingRows,
  loadLatestCandidateSalesSnapshot,
} from "@/lib/stage8CandidateDemandParity";
import {
  loadProductMasterCanonicalSalesAudit,
  type CanonicalRollingSalesRow,
} from "@/lib/productMasterCanonicalSalesAudit";
import {
  SALES_EVENT_FULL,
  loadProductMasterShoplingSalesEventSyncStatus,
} from "@/lib/productMasterShoplingSalesEventSync";
import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type PostApplyCanonicalReconciliationState =
  | "WAITING"
  | "READY"
  | "BLOCKED";

export type PostApplyCanonicalReconciliationCheck = {
  key: string;
  passed: boolean;
  message: string;
};

export type PostApplyCanonicalRowMismatch = {
  barcode: string;
  unitBuckets: number[];
  revenueBuckets: number[];
  candidateUnits: number[];
  persistedUnits: number[];
  candidateRevenue: number[];
  persistedRevenue: number[];
};

export type ExtraPersistedSkuPlanningMatch = {
  skuId: string;
  modelNo: string | null;
  productName: string;
  skuActive: boolean | null;
  listingCount: number;
  activeListingCount: number;
};

export type ExtraPersistedSkuDiagnostic = {
  barcode: string;
  persistedHasDemand: boolean;
  persistedValidEventCount: number;
  persistedMonthlyUnits: number[];
  persistedMonthlyRevenue: number[];
  persistedLastSaleAt: string | null;
  planningMatchCount: number;
  activePlanningMatchCount: number;
  candidateOmissionReason:
    | "NO_PLANNING_ROW"
    | "ALL_PLANNING_ROWS_INACTIVE"
    | "DUPLICATE_ACTIVE_PLANNING_ROWS"
    | "UNKNOWN_CANDIDATE_INDEX_EXCLUSION";
  planningMatches: ExtraPersistedSkuPlanningMatch[];
};

export type PostApplyCanonicalReconciliation = {
  generatedAt: string;
  state: PostApplyCanonicalReconciliationState;
  ready: boolean;
  message: string;
  candidateSalesRequestId: string | null;
  analysisAsOf: string | null;
  candidatePlanFingerprint: string | null;
  candidateEventFingerprint: string | null;
  persistedContentFingerprint: string | null;
  reconciliationFingerprint: string | null;
  candidateSourceEventCount: number;
  persistedSourceEventCount: number;
  candidateValidEventCount: number;
  persistedValidEventCount: number;
  candidateTombstoneCount: number;
  persistedTombstoneCount: number;
  candidateActiveRowCount: number;
  persistedActiveRowCount: number;
  sharedActiveRowCount: number;
  exactActiveRowCount: number;
  rowMismatchCount: number;
  missingPersistedCount: number;
  extraPersistedCount: number;
  extraPersistedNonZeroCount: number;
  fullApplyVerified: boolean;
  fullApplyWritten: number;
  missingPersistedBarcodes: string[];
  extraPersistedBarcodes: string[];
  extraPersistedDiagnostics: ExtraPersistedSkuDiagnostic[];
  rowMismatchSamples: PostApplyCanonicalRowMismatch[];
  checks: PostApplyCanonicalReconciliationCheck[];
};

type FullOperationRow = {
  status?: unknown;
  input_snapshot?: unknown;
  result_snapshot?: unknown;
  started_at?: unknown;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function numeric(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function integer(value: unknown) {
  return Math.round(numeric(value));
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizedArray(values: number[]) {
  return values.map(integer);
}

function arraysEqual(left: number[], right: number[]) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => integer(value) === integer(right[index]));
}

function differingBuckets(left: number[], right: number[]) {
  const output: number[] = [];
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (integer(left[index]) !== integer(right[index])) output.push(index);
  }
  return output;
}

function persistedRowIsZero(row: CanonicalRollingSalesRow) {
  return (
    integer(row.validEventCount) === 0 &&
    row.monthlyUnits.every((value) => integer(value) === 0) &&
    row.monthlyRevenue.every((value) => integer(value) === 0)
  );
}

function check(
  checks: PostApplyCanonicalReconciliationCheck[],
  key: string,
  passed: boolean,
  message: string,
) {
  checks.push({ key, passed, message });
  return passed;
}

async function loadVerifiedFullApply(
  requestId: string,
  planFingerprint: string,
  expectedRows: number,
) {
  const admin = await createSupabaseAdminClient();
  if (!admin) {
    return { verified: false, written: 0, reason: "SUPABASE_ADMIN_NOT_CONFIGURED" };
  }
  const result = await admin
    .from("commerce_operation_runs")
    .select("status,input_snapshot,result_snapshot,started_at")
    .eq("operation_type", SALES_EVENT_FULL)
    .eq("correlation_id", `product-master-sales-events:${requestId}`)
    .order("started_at", { ascending: false })
    .limit(10);
  if (result.error) throw new Error(result.error.message);
  for (const row of (result.data ?? []) as FullOperationRow[]) {
    const input = object(row.input_snapshot);
    const output = object(row.result_snapshot);
    const selected = integer(input.selected);
    const written = integer(output.written);
    const inputPlan = text(input.planFingerprint);
    const outputPlan = text(output.planFingerprint);
    const snapshotActiveRows = integer(output.snapshotActiveRows);
    if (
      text(row.status) === "SUCCEEDED" &&
      output.verified === true &&
      output.snapshotFinalized === true &&
      selected === expectedRows &&
      written === expectedRows &&
      snapshotActiveRows === expectedRows &&
      inputPlan === planFingerprint &&
      outputPlan === planFingerprint
    ) {
      return { verified: true, written, reason: null };
    }
  }
  return { verified: false, written: 0, reason: "FULL_APPLY_EVIDENCE_NOT_FOUND" };
}

function makeReconciliationFingerprint(input: {
  candidateSalesRequestId: string;
  analysisAsOf: string;
  candidatePlanFingerprint: string;
  candidateEventFingerprint: string;
  persistedContentFingerprint: string;
  persistedSourceEventCount: number;
  persistedValidEventCount: number;
  persistedTombstoneCount: number;
  exactActiveRowCount: number;
  rowMismatchCount: number;
  missingPersistedBarcodes: string[];
  extraPersistedBarcodes: string[];
  extraPersistedNonZeroCount: number;
  fullApplyWritten: number;
}) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex")}`;
}

function waiting(
  checks: PostApplyCanonicalReconciliationCheck[],
  message: string,
): PostApplyCanonicalReconciliation {
  return {
    generatedAt: new Date().toISOString(),
    state: "WAITING",
    ready: false,
    message,
    candidateSalesRequestId: null,
    analysisAsOf: null,
    candidatePlanFingerprint: null,
    candidateEventFingerprint: null,
    persistedContentFingerprint: null,
    reconciliationFingerprint: null,
    candidateSourceEventCount: 0,
    persistedSourceEventCount: 0,
    candidateValidEventCount: 0,
    persistedValidEventCount: 0,
    candidateTombstoneCount: 0,
    persistedTombstoneCount: 0,
    candidateActiveRowCount: 0,
    persistedActiveRowCount: 0,
    sharedActiveRowCount: 0,
    exactActiveRowCount: 0,
    rowMismatchCount: 0,
    missingPersistedCount: 0,
    extraPersistedCount: 0,
    extraPersistedNonZeroCount: 0,
    fullApplyVerified: false,
    fullApplyWritten: 0,
    missingPersistedBarcodes: [],
    extraPersistedBarcodes: [],
    extraPersistedDiagnostics: [],
    rowMismatchSamples: [],
    checks,
  };
}

export async function loadPostApplyCanonicalReconciliation(): Promise<PostApplyCanonicalReconciliation> {
  const checks: PostApplyCanonicalReconciliationCheck[] = [];
  const salesStatus = await loadProductMasterShoplingSalesEventSyncStatus();
  if (salesStatus.state !== "COMPLETED" || !salesStatus.requestId) {
    check(
      checks,
      "sales-full-completed",
      false,
      `판매 이벤트 상태 ${salesStatus.state}`,
    );
    return waiting(
      checks,
      "검증된 Product Master 전수 적재가 완료될 때까지 persisted reconciliation을 대기합니다.",
    );
  }

  const [candidate, planning, audit] = await Promise.all([
    loadLatestCandidateSalesSnapshot(),
    loadProductPlanningSnapshot(),
    loadProductMasterCanonicalSalesAudit(),
  ]);
  const persisted = audit.snapshot;

  check(
    checks,
    "sales-full-completed",
    true,
    `판매 이벤트 요청 ${salesStatus.requestId}가 COMPLETED입니다.`,
  );
  check(
    checks,
    "candidate-request-match",
    candidate.salesRequestId === salesStatus.requestId,
    `후보 ${candidate.salesRequestId} · 완료 ${salesStatus.requestId}`,
  );
  check(
    checks,
    "candidate-report-match",
    Boolean(
      salesStatus.report &&
        salesStatus.report.planFingerprint === candidate.planFingerprint &&
        salesStatus.report.eventFingerprint === candidate.eventFingerprint &&
        salesStatus.report.sourceEventCount === candidate.report.sourceEventCount,
    ),
    "완료된 판매 이벤트 report와 candidate event/plan 지문 및 행수가 같아야 합니다.",
  );
  check(
    checks,
    "planning-fingerprint-stable",
    planning.contentFingerprint === candidate.planningContentFingerprint,
    `현재 planning ${planning.contentFingerprint} · 후보 ${candidate.planningContentFingerprint}`,
  );
  check(
    checks,
    "persisted-audit-ready",
    audit.ready && Boolean(persisted),
    audit.message,
  );

  if (!persisted) {
    return {
      ...waiting(checks, "Product Master canonical snapshot을 읽지 못해 검증을 차단합니다."),
      state: "BLOCKED",
      candidateSalesRequestId: candidate.salesRequestId,
      analysisAsOf: candidate.analysisAsOf,
      candidatePlanFingerprint: candidate.planFingerprint,
      candidateEventFingerprint: candidate.eventFingerprint,
    };
  }

  check(
    checks,
    "analysis-time-match",
    persisted.analysisAsOf === candidate.analysisAsOf &&
      salesStatus.analysisAsOf === candidate.analysisAsOf,
    `persisted ${persisted.analysisAsOf} · candidate ${candidate.analysisAsOf}`,
  );
  check(
    checks,
    "persisted-classification-complete",
    persisted.classificationComplete && persisted.orphanEventCount === 0,
    `분류완료 ${persisted.classificationComplete} · orphan ${persisted.orphanEventCount}`,
  );
  check(
    checks,
    "source-event-count-match",
    persisted.sourceEventCount === candidate.report.sourceEventCount,
    `persisted ${persisted.sourceEventCount} · candidate ${candidate.report.sourceEventCount}`,
  );
  check(
    checks,
    "valid-event-count-match",
    persisted.validEventCount + persisted.inactiveManagedValidEventCount ===
      candidate.report.validEventCount,
    `persisted 활성 ${persisted.validEventCount} + 비활성역사 ${persisted.inactiveManagedValidEventCount} · candidate ${candidate.report.validEventCount}`,
  );
  check(
    checks,
    "tombstone-count-match",
    persisted.tombstoneCount + persisted.inactiveManagedTombstoneCount ===
      candidate.report.tombstoneCount,
    `persisted 활성 ${persisted.tombstoneCount} + 비활성역사 ${persisted.inactiveManagedTombstoneCount} · candidate ${candidate.report.tombstoneCount}`,
  );

  const candidateRows = buildCandidateRollingRows(
    planning,
    candidate.events,
    candidate.analysisAsOf,
  );
  const candidateByBarcode = new Map(
    candidateRows.map((row) => [row.barcode, row]),
  );
  const persistedByBarcode = new Map(
    persisted.rows.map((row) => [text(row.barcode).toUpperCase(), row]),
  );

  let sharedActiveRowCount = 0;
  let exactActiveRowCount = 0;
  const missingPersistedBarcodes: string[] = [];
  const rowMismatchSamples: PostApplyCanonicalRowMismatch[] = [];

  for (const candidateRow of candidateRows) {
    const persistedRow = persistedByBarcode.get(candidateRow.barcode);
    if (!persistedRow) {
      missingPersistedBarcodes.push(candidateRow.barcode);
      continue;
    }
    sharedActiveRowCount += 1;
    const unitMatch = arraysEqual(
      candidateRow.monthlyUnits,
      persistedRow.monthlyUnits,
    );
    const revenueMatch = arraysEqual(
      candidateRow.monthlyRevenue,
      persistedRow.monthlyRevenue,
    );
    const validEventMatch =
      integer(candidateRow.validEventCount) === integer(persistedRow.validEventCount);
    if (unitMatch && revenueMatch && validEventMatch) {
      exactActiveRowCount += 1;
      continue;
    }
    if (rowMismatchSamples.length < 50) {
      rowMismatchSamples.push({
        barcode: candidateRow.barcode,
        unitBuckets: differingBuckets(
          candidateRow.monthlyUnits,
          persistedRow.monthlyUnits,
        ),
        revenueBuckets: differingBuckets(
          candidateRow.monthlyRevenue,
          persistedRow.monthlyRevenue,
        ),
        candidateUnits: normalizedArray(candidateRow.monthlyUnits),
        persistedUnits: normalizedArray(persistedRow.monthlyUnits),
        candidateRevenue: normalizedArray(candidateRow.monthlyRevenue),
        persistedRevenue: normalizedArray(persistedRow.monthlyRevenue),
      });
    }
  }

  const extraPersistedBarcodes = [...persistedByBarcode.keys()]
    .filter((barcode) => !candidateByBarcode.has(barcode))
    .sort();
  const extraPersistedNonZeroCount = extraPersistedBarcodes.filter((barcode) => {
    const row = persistedByBarcode.get(barcode);
    return row ? !persistedRowIsZero(row) : false;
  }).length;
  const extraPersistedDiagnostics: ExtraPersistedSkuDiagnostic[] =
    extraPersistedBarcodes.map((barcode) => {
      const persistedRow = persistedByBarcode.get(barcode)!;
      const planningMatches = (planning.products ?? [])
        .filter((product) => text(product.barcode).toUpperCase() === barcode)
        .map((product) => ({
          skuId: text(product.skuId),
          modelNo: text(product.modelNo) || null,
          productName: text(product.productName) || barcode,
          skuActive:
            typeof product.skuActive === "boolean" ? product.skuActive : null,
          listingCount: Array.isArray(product.listings) ? product.listings.length : 0,
          activeListingCount: Array.isArray(product.listings)
            ? product.listings.filter((listing) => listing.active !== false).length
            : 0,
        }));
      const activePlanningMatchCount = planningMatches.filter(
        (row) => row.skuActive !== false,
      ).length;
      const candidateOmissionReason: ExtraPersistedSkuDiagnostic["candidateOmissionReason"] =
        planningMatches.length === 0
          ? "NO_PLANNING_ROW"
          : activePlanningMatchCount === 0
            ? "ALL_PLANNING_ROWS_INACTIVE"
            : activePlanningMatchCount > 1
              ? "DUPLICATE_ACTIVE_PLANNING_ROWS"
              : "UNKNOWN_CANDIDATE_INDEX_EXCLUSION";
      return {
        barcode,
        persistedHasDemand: !persistedRowIsZero(persistedRow),
        persistedValidEventCount: integer(persistedRow.validEventCount),
        persistedMonthlyUnits: normalizedArray(persistedRow.monthlyUnits),
        persistedMonthlyRevenue: normalizedArray(persistedRow.monthlyRevenue),
        persistedLastSaleAt: persistedRow.lastSaleAt,
        planningMatchCount: planningMatches.length,
        activePlanningMatchCount,
        candidateOmissionReason,
        planningMatches,
      };
    });

  const rowMismatchCount =
    candidateRows.length - exactActiveRowCount - missingPersistedBarcodes.length;
  check(
    checks,
    "candidate-active-rows-persisted",
    missingPersistedBarcodes.length === 0,
    `후보 active ${candidateRows.length} · persisted 누락 ${missingPersistedBarcodes.length}`,
  );
  check(
    checks,
    "candidate-active-arrays-exact",
    rowMismatchCount === 0 && exactActiveRowCount === candidateRows.length,
    `완전일치 ${exactActiveRowCount}/${candidateRows.length} · 불일치 ${rowMismatchCount}`,
  );
  check(
    checks,
    "extra-persisted-rows-zero-only",
    extraPersistedNonZeroCount === 0,
    `persisted 추가 active SKU ${extraPersistedBarcodes.length}개 · 판매값 보유 ${extraPersistedNonZeroCount}개`,
  );

  const fullApply = await loadVerifiedFullApply(
    candidate.salesRequestId,
    candidate.planFingerprint,
    candidate.report.sourceEventCount,
  );
  check(
    checks,
    "full-apply-evidence-verified",
    fullApply.verified,
    fullApply.verified
      ? `FULL operation ${fullApply.written}건 검증 완료`
      : `FULL operation 증거 없음: ${fullApply.reason}`,
  );

  const ready = checks.every((row) => row.passed);
  const persistedContentFingerprint = persisted.contentFingerprint;
  const reconciliationFingerprint = ready
    ? makeReconciliationFingerprint({
        candidateSalesRequestId: candidate.salesRequestId,
        analysisAsOf: candidate.analysisAsOf,
        candidatePlanFingerprint: candidate.planFingerprint,
        candidateEventFingerprint: candidate.eventFingerprint,
        persistedContentFingerprint,
        persistedSourceEventCount: persisted.sourceEventCount,
        persistedValidEventCount:
          persisted.validEventCount + persisted.inactiveManagedValidEventCount,
        persistedTombstoneCount:
          persisted.tombstoneCount + persisted.inactiveManagedTombstoneCount,
        exactActiveRowCount,
        rowMismatchCount,
        missingPersistedBarcodes,
        extraPersistedBarcodes,
        extraPersistedNonZeroCount,
        fullApplyWritten: fullApply.written,
      })
    : null;

  return {
    generatedAt: new Date().toISOString(),
    state: ready ? "READY" : "BLOCKED",
    ready,
    message: ready
      ? "Product Master persisted canonical 판매원장이 승인된 candidate와 동일하게 저장됐습니다. Legacy 직접집계와의 알려진 안전한 BAB3-1 차이는 persisted 불일치로 취급하지 않습니다."
      : "승인 candidate와 Product Master persisted canonical 원장 사이에 검증 차단 조건이 남아 있습니다.",
    candidateSalesRequestId: candidate.salesRequestId,
    analysisAsOf: candidate.analysisAsOf,
    candidatePlanFingerprint: candidate.planFingerprint,
    candidateEventFingerprint: candidate.eventFingerprint,
    persistedContentFingerprint,
    reconciliationFingerprint,
    candidateSourceEventCount: candidate.report.sourceEventCount,
    persistedSourceEventCount: persisted.sourceEventCount,
    candidateValidEventCount: candidate.report.validEventCount,
    persistedValidEventCount:
      persisted.validEventCount + persisted.inactiveManagedValidEventCount,
    candidateTombstoneCount: candidate.report.tombstoneCount,
    persistedTombstoneCount:
      persisted.tombstoneCount + persisted.inactiveManagedTombstoneCount,
    candidateActiveRowCount: candidateRows.length,
    persistedActiveRowCount: persisted.rows.length,
    sharedActiveRowCount,
    exactActiveRowCount,
    rowMismatchCount,
    missingPersistedCount: missingPersistedBarcodes.length,
    extraPersistedCount: extraPersistedBarcodes.length,
    extraPersistedNonZeroCount,
    fullApplyVerified: fullApply.verified,
    fullApplyWritten: fullApply.written,
    missingPersistedBarcodes,
    extraPersistedBarcodes,
    extraPersistedDiagnostics,
    rowMismatchSamples,
    checks,
  };
}
