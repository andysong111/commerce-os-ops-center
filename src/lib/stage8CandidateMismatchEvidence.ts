import {
  combineDemandMismatchEvidenceChunks,
  compileDemandMismatchEvidenceChunk,
  type DemandMismatchEvidenceChunk,
  type DemandMismatchEvidenceSummary,
} from "@/lib/stage8DemandMismatchEvidenceEngine";
import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import {
  loadCandidateDemandParityStatus,
  loadLatestCandidateSalesSnapshot,
} from "@/lib/stage8CandidateDemandParity";
import {
  ShoplingReadClient,
  shoplingReadConfigFromEnv,
  splitShoplingDateRange,
  type ShoplingDateRange,
} from "@/lib/shopling/shoplingReadClient";
import {
  createSupabaseAdminClient,
  createSupabaseAdminHeaders,
} from "@/lib/supabase/admin";

export const CANDIDATE_MISMATCH_EVIDENCE_REQUEST =
  "STAGE8_CANDIDATE_MISMATCH_EVIDENCE_REQUEST";
export const CANDIDATE_MISMATCH_EVIDENCE_CHUNK =
  "STAGE8_CANDIDATE_MISMATCH_EVIDENCE_CHUNK";
export const CANDIDATE_MISMATCH_EVIDENCE_STEP_FAILURE =
  "STAGE8_CANDIDATE_MISMATCH_EVIDENCE_STEP_FAILURE";
export const CANDIDATE_MISMATCH_EVIDENCE_REPORT =
  "STAGE8_CANDIDATE_MISMATCH_EVIDENCE_REPORT";
export const CANDIDATE_MISMATCH_EVIDENCE_FAILED =
  "STAGE8_CANDIDATE_MISMATCH_EVIDENCE_FAILED";

const ANALYSIS_DAYS = 360;
const RANGE_DAYS = 7;
const MAX_STEP_ATTEMPTS = 3;
const OPERATION_LIMIT = 500;

export type CandidateMismatchEvidenceRequest = {
  requestId: string;
  candidateSalesRequestId: string;
  candidateParityRequestId: string;
  analysisAsOf: string;
  planningContentFingerprint: string;
  candidateEventFingerprint: string;
  candidatePlanFingerprint: string;
  candidateParityFingerprint: string;
  targetBarcodes: string[];
  ranges: ShoplingDateRange[];
  createdAt: string;
};

export type CandidateMismatchEvidenceStatus = {
  configured: boolean;
  requestId: string | null;
  candidateSalesRequestId?: string | null;
  candidateParityRequestId?: string | null;
  analysisAsOf?: string | null;
  planningContentFingerprint?: string | null;
  candidateEventFingerprint?: string | null;
  candidatePlanFingerprint?: string | null;
  candidateParityFingerprint?: string | null;
  state: "IDLE" | "QUEUED" | "RUNNING" | "COMPLETE" | "FAILED";
  stage: string;
  message: string;
  completedRanges: number;
  totalRanges: number;
  progress: number;
  targetBarcodes: string[];
  report: DemandMismatchEvidenceSummary | null;
  error: string | null;
};

type OperationRow = {
  input_snapshot?: unknown;
  result_snapshot?: unknown;
  error_message?: unknown;
  started_at?: unknown;
};

type StoreOperationInput = {
  operationType: string;
  sourceEventId: string;
  correlationId: string;
  status?: "SUCCEEDED" | "FAILED";
  inputSnapshot: unknown;
  resultSnapshot: unknown;
  errorMessage?: string | null;
  occurredAt?: string;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function iso(value: unknown) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function safeMessage(error: unknown) {
  return (error instanceof Error ? error.message : text(error))
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[A-Za-z0-9+/=_-]{48,}/g, "[redacted]")
    .slice(0, 1000);
}

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function rangeKey(range: ShoplingDateRange) {
  return `${range.start}:${range.end}`;
}

function requestCorrelationId(requestId: string) {
  return `stage8-candidate-mismatch-evidence:${requestId}`;
}

function shoplingEnvironment() {
  return {
    SHOPLING_LOGIN_ID: process.env.SHOPLING_LOGIN_ID,
    SHOPLING_COMPANY_ID: process.env.SHOPLING_COMPANY_ID,
    SHOPLING_API_AUTH_KEY: process.env.SHOPLING_API_AUTH_KEY,
    SHOPLING_PRODUCTS_API_URL: process.env.SHOPLING_PRODUCTS_API_URL,
    SHOPLING_ORDERS_API_URL: process.env.SHOPLING_ORDERS_API_URL,
    SHOPLING_CLAIMS_API_URL: process.env.SHOPLING_CLAIMS_API_URL,
  };
}

function supabaseConnection() {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const secret = (
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  )?.trim();
  if (!baseUrl || !secret) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  return { baseUrl, secret };
}

export function candidateMismatchEvidenceConfigured() {
  try {
    shoplingReadConfigFromEnv(shoplingEnvironment());
    supabaseConnection();
    return true;
  } catch {
    return false;
  }
}

async function storeOperation(input: StoreOperationInput) {
  const { baseUrl, secret } = supabaseConnection();
  const occurredAt = input.occurredAt || new Date().toISOString();
  const response = await fetch(
    `${baseUrl}/rest/v1/commerce_operation_runs?on_conflict=source_event_id&select=id,source_event_id,started_at`,
    {
      method: "POST",
      headers: {
        ...createSupabaseAdminHeaders(secret),
        Prefer: "resolution=ignore-duplicates,return=representation",
      },
      body: JSON.stringify([
        {
          operation_type: input.operationType,
          status: input.status ?? "SUCCEEDED",
          source: "stage8-candidate-mismatch-evidence",
          source_event_id: input.sourceEventId,
          correlation_id: input.correlationId,
          actor_type:
            input.operationType === CANDIDATE_MISMATCH_EVIDENCE_REQUEST
              ? "OPS_OPERATOR"
              : "OPS_WORKER",
          input_snapshot: input.inputSnapshot,
          result_snapshot: input.resultSnapshot,
          error_message: input.errorMessage ?? null,
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
      `CANDIDATE_MISMATCH_EVIDENCE_STORE_FAILED:${response.status}:${body.slice(0, 300)}`,
    );
  }
}

async function readOperations(
  operationType: string,
  correlationId?: string,
  limit = OPERATION_LIMIT,
) {
  const admin = await createSupabaseAdminClient();
  if (!admin) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  let query = admin
    .from("commerce_operation_runs")
    .select("input_snapshot,result_snapshot,error_message,started_at")
    .eq("operation_type", operationType);
  if (correlationId) query = query.eq("correlation_id", correlationId);
  const result = await query.order("started_at", { ascending: false }).limit(limit);
  if (result.error) throw new Error(result.error.message);
  return (Array.isArray(result.data) ? result.data : []).filter(
    (row): row is OperationRow => Boolean(row && typeof row === "object"),
  );
}

function parseRanges(value: unknown): ShoplingDateRange[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(object)
    .map((range) => ({ start: text(range.start), end: text(range.end) }))
    .filter(
      (range) =>
        /^\d{4}-\d{2}-\d{2}$/.test(range.start) &&
        /^\d{4}-\d{2}-\d{2}$/.test(range.end),
    );
}

function requestFromRow(row: OperationRow): CandidateMismatchEvidenceRequest | null {
  const value = object(row.input_snapshot);
  const requestId = text(value.requestId);
  const candidateSalesRequestId = text(value.candidateSalesRequestId);
  const candidateParityRequestId = text(value.candidateParityRequestId);
  const analysisAsOf = iso(value.analysisAsOf);
  const planningContentFingerprint = text(value.planningContentFingerprint);
  const candidateEventFingerprint = text(value.candidateEventFingerprint);
  const candidatePlanFingerprint = text(value.candidatePlanFingerprint);
  const candidateParityFingerprint = text(value.candidateParityFingerprint);
  const targetBarcodes = Array.isArray(value.targetBarcodes)
    ? value.targetBarcodes.map(text).filter(Boolean)
    : [];
  const ranges = parseRanges(value.ranges);
  if (
    !requestId ||
    !candidateSalesRequestId ||
    !candidateParityRequestId ||
    !analysisAsOf ||
    !/^sha256:[a-f0-9]{64}$/.test(planningContentFingerprint) ||
    !/^sha256:[a-f0-9]{64}$/.test(candidateEventFingerprint) ||
    !/^sha256:[a-f0-9]{64}$/.test(candidatePlanFingerprint) ||
    !/^sha256:[a-f0-9]{64}$/.test(candidateParityFingerprint) ||
    !targetBarcodes.length ||
    !ranges.length
  ) return null;
  return {
    requestId,
    candidateSalesRequestId,
    candidateParityRequestId,
    analysisAsOf,
    planningContentFingerprint,
    candidateEventFingerprint,
    candidatePlanFingerprint,
    candidateParityFingerprint,
    targetBarcodes,
    ranges,
    createdAt: iso(value.createdAt) || analysisAsOf,
  };
}

function chunkFromRow(row: OperationRow): DemandMismatchEvidenceChunk | null {
  const value = object(row.result_snapshot);
  return value.range && Array.isArray(value.evidence)
    ? (value as unknown as DemandMismatchEvidenceChunk)
    : null;
}

function reportFromRow(row: OperationRow): DemandMismatchEvidenceSummary | null {
  const value = object(row.result_snapshot);
  return /^sha256:[a-f0-9]{64}$/.test(text(value.evidenceFingerprint))
    ? (value as unknown as DemandMismatchEvidenceSummary)
    : null;
}

async function latestRequest() {
  const rows = await readOperations(CANDIDATE_MISMATCH_EVIDENCE_REQUEST, undefined, 20);
  for (const row of rows) {
    const request = requestFromRow(row);
    if (request) return request;
  }
  return null;
}

async function requestOperations(request: CandidateMismatchEvidenceRequest) {
  const correlationId = requestCorrelationId(request.requestId);
  const [chunks, stepFailures, reports, failures] = await Promise.all([
    readOperations(CANDIDATE_MISMATCH_EVIDENCE_CHUNK, correlationId),
    readOperations(CANDIDATE_MISMATCH_EVIDENCE_STEP_FAILURE, correlationId),
    readOperations(CANDIDATE_MISMATCH_EVIDENCE_REPORT, correlationId, 10),
    readOperations(CANDIDATE_MISMATCH_EVIDENCE_FAILED, correlationId, 10),
  ]);
  return { correlationId, chunks, stepFailures, reports, failures };
}

function operationRangeKey(row: OperationRow) {
  const input = object(row.input_snapshot);
  const range = object(input.range);
  return range.start && range.end
    ? `${text(range.start)}:${text(range.end)}`
    : text(input.rangeKey);
}

function stepAttemptCount(rows: OperationRow[], stageKey: string) {
  return rows.filter(
    (row) => text(object(row.result_snapshot).stageKey) === stageKey,
  ).length;
}

async function storeStepFailure(
  request: CandidateMismatchEvidenceRequest,
  stageKey: string,
  attempt: number,
  error: unknown,
) {
  const message = safeMessage(error);
  await storeOperation({
    operationType: CANDIDATE_MISMATCH_EVIDENCE_STEP_FAILURE,
    sourceEventId: `candidate-mismatch-evidence-step-failure:${request.requestId}:${encodeURIComponent(stageKey)}:${attempt}`,
    correlationId: requestCorrelationId(request.requestId),
    status: "FAILED",
    inputSnapshot: { requestId: request.requestId, stageKey, attempt },
    resultSnapshot: { requestId: request.requestId, stageKey, attempt, message },
    errorMessage: message,
  });
  return message;
}

async function storeTerminalFailure(
  request: CandidateMismatchEvidenceRequest,
  stageKey: string,
  message: string,
) {
  await storeOperation({
    operationType: CANDIDATE_MISMATCH_EVIDENCE_FAILED,
    sourceEventId: `candidate-mismatch-evidence-failed:${request.requestId}`,
    correlationId: requestCorrelationId(request.requestId),
    status: "FAILED",
    inputSnapshot: { requestId: request.requestId, stageKey },
    resultSnapshot: { requestId: request.requestId, stageKey, message },
    errorMessage: message,
  });
}

async function verifiedContext(request: CandidateMismatchEvidenceRequest) {
  const [parity, planning, candidate] = await Promise.all([
    loadCandidateDemandParityStatus(),
    loadProductPlanningSnapshot(),
    loadLatestCandidateSalesSnapshot(),
  ]);
  if (parity.state !== "MISMATCH" || !parity.report) {
    throw new Error(`CANDIDATE_MISMATCH_EVIDENCE_PARITY_CHANGED:${parity.state}`);
  }
  if (
    parity.requestId !== request.candidateParityRequestId ||
    parity.report.parityFingerprint !== request.candidateParityFingerprint
  ) {
    throw new Error("CANDIDATE_MISMATCH_EVIDENCE_PARITY_FINGERPRINT_CHANGED");
  }
  if (planning.contentFingerprint !== request.planningContentFingerprint) {
    throw new Error("CANDIDATE_MISMATCH_EVIDENCE_PLANNING_CHANGED");
  }
  if (
    candidate.salesRequestId !== request.candidateSalesRequestId ||
    candidate.analysisAsOf !== request.analysisAsOf ||
    candidate.eventFingerprint !== request.candidateEventFingerprint ||
    candidate.planFingerprint !== request.candidatePlanFingerprint
  ) {
    throw new Error("CANDIDATE_MISMATCH_EVIDENCE_CANDIDATE_CHANGED");
  }
  return planning;
}

export async function createCandidateMismatchEvidenceRequest() {
  shoplingReadConfigFromEnv(shoplingEnvironment());
  const [parity, planning, candidate] = await Promise.all([
    loadCandidateDemandParityStatus(),
    loadProductPlanningSnapshot(),
    loadLatestCandidateSalesSnapshot(),
  ]);
  if (parity.state !== "MISMATCH" || !parity.report || !parity.requestId) {
    throw new Error(
      `CANDIDATE_MISMATCH_EVIDENCE_PARITY_REQUIRED:${parity.state}`,
    );
  }
  if (
    planning.contentFingerprint !== parity.report.planningContentFingerprint ||
    candidate.salesRequestId !== parity.report.candidateSalesRequestId ||
    candidate.analysisAsOf !== parity.report.analysisAsOf ||
    candidate.eventFingerprint !== parity.report.candidateEventFingerprint ||
    candidate.planFingerprint !== parity.report.candidatePlanFingerprint
  ) {
    throw new Error("CANDIDATE_MISMATCH_EVIDENCE_CONTEXT_CHANGED_RERUN_PARITY");
  }

  const targets = new Set<string>();
  for (const row of parity.report.mismatchSamples) targets.add(row.barcode);
  for (const barcode of parity.report.missingDirectBarcodes) targets.add(barcode);
  for (const barcode of parity.report.directOnlyManagedBarcodes) targets.add(barcode);
  if (!targets.size) {
    throw new Error("CANDIDATE_MISMATCH_EVIDENCE_TARGETS_EMPTY");
  }

  const asOf = new Date(parity.report.analysisAsOf);
  const start = new Date(asOf.valueOf() - ANALYSIS_DAYS * 24 * 60 * 60 * 1000);
  const request: CandidateMismatchEvidenceRequest = {
    requestId: crypto.randomUUID(),
    candidateSalesRequestId: candidate.salesRequestId,
    candidateParityRequestId: parity.requestId,
    analysisAsOf: asOf.toISOString(),
    planningContentFingerprint: parity.report.planningContentFingerprint,
    candidateEventFingerprint: parity.report.candidateEventFingerprint,
    candidatePlanFingerprint: parity.report.candidatePlanFingerprint,
    candidateParityFingerprint: parity.report.parityFingerprint,
    targetBarcodes: [...targets].sort(),
    ranges: splitShoplingDateRange(dateOnly(start), dateOnly(asOf), RANGE_DAYS),
    createdAt: new Date().toISOString(),
  };
  await storeOperation({
    operationType: CANDIDATE_MISMATCH_EVIDENCE_REQUEST,
    sourceEventId: `candidate-mismatch-evidence-request:${request.requestId}`,
    correlationId: requestCorrelationId(request.requestId),
    inputSnapshot: request,
    resultSnapshot: {
      accepted: true,
      state: "QUEUED",
      targetCount: request.targetBarcodes.length,
      message:
        "Product Master 쓰기 전 candidate parity에 남은 SKU만 같은 원주문행을 두 resolver로 다시 분류합니다.",
    },
    occurredAt: request.createdAt,
  });
  return request;
}

export async function runCandidateMismatchEvidenceStep() {
  const request = await latestRequest();
  if (!request) return { processed: false, state: "IDLE" as const };
  const operations = await requestOperations(request);
  if (operations.reports.length) {
    return { processed: false, state: "COMPLETE" as const, requestId: request.requestId };
  }
  if (operations.failures.length) {
    return {
      processed: false,
      state: "FAILED" as const,
      requestId: request.requestId,
      message: safeMessage(
        operations.failures[0].error_message ||
          object(operations.failures[0].result_snapshot).message,
      ),
    };
  }

  let planning;
  try {
    planning = await verifiedContext(request);
  } catch (error) {
    const message = safeMessage(error);
    await storeTerminalFailure(request, "context", message);
    return { processed: true, state: "FAILED" as const, requestId: request.requestId, message };
  }

  const completed = new Set(operations.chunks.map(operationRangeKey));
  const nextRange = request.ranges.find((range) => !completed.has(rangeKey(range)));
  if (nextRange) {
    const stageKey = `orders:${rangeKey(nextRange)}`;
    const attempt = stepAttemptCount(operations.stepFailures, stageKey) + 1;
    if (attempt > MAX_STEP_ATTEMPTS) {
      const message = `CANDIDATE_MISMATCH_EVIDENCE_RETRY_EXHAUSTED:${rangeKey(nextRange)}`;
      await storeTerminalFailure(request, stageKey, message);
      return { processed: true, state: "FAILED" as const, requestId: request.requestId, message };
    }
    try {
      const raw = await new ShoplingReadClient(
        shoplingReadConfigFromEnv(shoplingEnvironment()),
      ).read("orders", nextRange);
      const summary = compileDemandMismatchEvidenceChunk(
        raw,
        planning,
        request.analysisAsOf,
        nextRange,
        request.targetBarcodes,
      );
      await storeOperation({
        operationType: CANDIDATE_MISMATCH_EVIDENCE_CHUNK,
        sourceEventId: `candidate-mismatch-evidence-chunk:${request.requestId}:${rangeKey(nextRange)}`,
        correlationId: requestCorrelationId(request.requestId),
        inputSnapshot: {
          requestId: request.requestId,
          range: nextRange,
          rangeKey: rangeKey(nextRange),
          analysisAsOf: request.analysisAsOf,
          planningContentFingerprint: request.planningContentFingerprint,
          candidateEventFingerprint: request.candidateEventFingerprint,
          candidatePlanFingerprint: request.candidatePlanFingerprint,
          candidateParityFingerprint: request.candidateParityFingerprint,
          targetBarcodes: request.targetBarcodes,
        },
        resultSnapshot: summary,
      });
      return {
        processed: true,
        state: "RUNNING" as const,
        requestId: request.requestId,
        range: nextRange,
        fetchedRows: summary.fetchedRows,
        candidateRows: summary.candidateRows,
        evidenceRows: summary.evidenceRows,
      };
    } catch (error) {
      const message = await storeStepFailure(request, stageKey, attempt, error);
      if (attempt >= MAX_STEP_ATTEMPTS) {
        await storeTerminalFailure(request, stageKey, message);
      }
      return {
        processed: true,
        state: attempt >= MAX_STEP_ATTEMPTS ? ("FAILED" as const) : ("RUNNING" as const),
        requestId: request.requestId,
        attempt,
        message,
      };
    }
  }

  const chunks = operations.chunks
    .map(chunkFromRow)
    .filter(Boolean) as DemandMismatchEvidenceChunk[];
  const report = combineDemandMismatchEvidenceChunks(chunks);
  await storeOperation({
    operationType: CANDIDATE_MISMATCH_EVIDENCE_REPORT,
    sourceEventId: `candidate-mismatch-evidence-report:${request.requestId}`,
    correlationId: requestCorrelationId(request.requestId),
    inputSnapshot: {
      requestId: request.requestId,
      candidateSalesRequestId: request.candidateSalesRequestId,
      candidateParityRequestId: request.candidateParityRequestId,
      analysisAsOf: request.analysisAsOf,
      planningContentFingerprint: request.planningContentFingerprint,
      candidateEventFingerprint: request.candidateEventFingerprint,
      candidatePlanFingerprint: request.candidatePlanFingerprint,
      candidateParityFingerprint: request.candidateParityFingerprint,
      targetBarcodes: request.targetBarcodes,
    },
    resultSnapshot: report,
  });
  return {
    processed: true,
    state: "COMPLETE" as const,
    requestId: request.requestId,
    report,
  };
}

export async function loadCandidateMismatchEvidenceStatus(): Promise<CandidateMismatchEvidenceStatus> {
  const configured = candidateMismatchEvidenceConfigured();
  const request = await latestRequest();
  const empty: CandidateMismatchEvidenceStatus = {
    configured,
    requestId: null,
    state: "IDLE",
    stage: "대기",
    message: "쓰기 전 candidate parity 차이 원주문행 evidence가 아직 없습니다.",
    completedRanges: 0,
    totalRanges: 0,
    progress: 0,
    targetBarcodes: [],
    report: null,
    error: null,
  };
  if (!request) return empty;
  const operations = await requestOperations(request);
  const completedRanges = new Set(operations.chunks.map(operationRangeKey)).size;
  const report = operations.reports.map(reportFromRow).find(Boolean) ?? null;
  const common = {
    ...empty,
    requestId: request.requestId,
    candidateSalesRequestId: request.candidateSalesRequestId,
    candidateParityRequestId: request.candidateParityRequestId,
    analysisAsOf: request.analysisAsOf,
    planningContentFingerprint: request.planningContentFingerprint,
    candidateEventFingerprint: request.candidateEventFingerprint,
    candidatePlanFingerprint: request.candidatePlanFingerprint,
    candidateParityFingerprint: request.candidateParityFingerprint,
    completedRanges,
    totalRanges: request.ranges.length,
    progress: Math.min(
      100,
      Math.round((completedRanges / request.ranges.length) * 100),
    ),
    targetBarcodes: request.targetBarcodes,
    report,
  };
  if (operations.failures.length) {
    const error = safeMessage(
      operations.failures[0].error_message ||
        object(operations.failures[0].result_snapshot).message,
    );
    return {
      ...common,
      state: "FAILED",
      stage: "Candidate evidence 수집 실패",
      message: error,
      error,
    };
  }
  if (report) {
    return {
      ...common,
      state: "COMPLETE",
      stage: "쓰기 전 candidate 차이 원인 evidence 완료",
      message: `대상 ${request.targetBarcodes.length}개 SKU에서 ${report.evidenceRows}개 resolver 차이 주문행을 분류했습니다.`,
      progress: 100,
    };
  }
  return {
    ...common,
    state: completedRanges ? "RUNNING" : "QUEUED",
    stage: completedRanges ? "Candidate 원주문행 비교 중" : "Worker 대기",
    message: `${completedRanges}/${request.ranges.length}개 구간을 읽었습니다. Shopling GET만 사용합니다.`,
  };
}
