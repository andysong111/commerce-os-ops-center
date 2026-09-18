import { withSalesEventMutationGuard } from "@/lib/salesEventMutationGuard";
import { assertSalesEventRefreshAllowed, SalesEventActionError, type SalesEventRefreshInput } from "@/lib/salesEventRefreshPolicy";
import { createHash } from "node:crypto";
import {
  aggregateProductMasterShoplingSalesEventChunk,
  combineProductMasterShoplingSalesEventChunks,
  PRODUCT_MASTER_SALES_EVENT_FORMAT,
  PRODUCT_MASTER_SALES_EVENT_SOURCE,
  PRODUCT_MASTER_SALES_EVENT_ANALYSIS_DAYS,
  type ProductMasterShoplingSalesEventChunk,
  type ProductMasterSalesEventRow,
} from "@/lib/productMasterShoplingSalesEventEngine";
import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
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

export const SALES_EVENT_REQUEST = "PRODUCT_MASTER_SHOPLING_SALES_EVENT_REQUEST";
export const SALES_EVENT_CHUNK = "PRODUCT_MASTER_SHOPLING_SALES_EVENT_CHUNK";
export const SALES_EVENT_REPORT = "PRODUCT_MASTER_SHOPLING_SALES_EVENT_REPORT";
export const SALES_EVENT_CANARY = "PRODUCT_MASTER_SHOPLING_SALES_EVENT_CANARY";
export const SALES_EVENT_FULL = "PRODUCT_MASTER_SHOPLING_SALES_EVENT_FULL";
export const SALES_EVENT_FAILED = "PRODUCT_MASTER_SHOPLING_SALES_EVENT_FAILED";

const DEFAULT_PRODUCT_MASTER_URL = "https://commerce-os-product-master.vercel.app";
const ANALYSIS_DAYS = PRODUCT_MASTER_SALES_EVENT_ANALYSIS_DAYS;
export const SALES_EVENT_SOURCE_RANGE_DAYS = 7;
const LEGACY_SALES_EVENT_SOURCE_RANGE_DAYS = 30;
const OPERATION_LIMIT = 500;
const APPLY_BATCH_SIZE = 2_000;

type OperationRow = {
  operation_type?: unknown;
  source_event_id?: unknown;
  correlation_id?: unknown;
  status?: unknown;
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

export type SalesEventSyncRequest = {
  requestId: string;
  analysisAsOf: string;
  analysisStartDate: string;
  analysisEndDate: string;
  chunkDays: number;
  planningGeneratedAt: string;
  planningContentFingerprint: string;
  ranges: ShoplingDateRange[];
  createdAt: string;
};

export type SalesEventSyncReport = {
  generatedAt: string;
  sourceEventCount: number;
  validEventCount: number;
  tombstoneCount: number;
  fetchedRows: number;
  ignoredRows: number;
  unmappedRows: number;
  duplicateRows: number;
  identityConflictCount: number;
  totalBaseUnits: number;
  totalRevenue: number;
  eventFingerprint: string;
  planFingerprint: string;
};

export type SalesEventSyncStatus = {
  configured: boolean;
  requestId: string | null;
  analysisAsOf: string | null;
  state:
    | "IDLE"
    | "QUEUED"
    | "RUNNING"
    | "BLOCKED"
    | "STORAGE_NOT_READY"
    | "READY_CANARY"
    | "READY_FULL"
    | "COMPLETED"
    | "FAILED";
  stage: string;
  message: string;
  completedRanges: number;
  totalRanges: number;
  progress: number;
  report: SalesEventSyncReport | null;
  canaryVerified: boolean;
  blockerCount: number;
  error: string | null;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function safeMessage(error: unknown) {
  const message = error instanceof Error ? error.message : text(error);
  return message
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[A-Za-z0-9+/=_-]{48,}/g, "[redacted]")
    .slice(0, 1000);
}

function requestCorrelationId(requestId: string) {
  return `product-master-sales-events:${requestId}`;
}

function rangeKey(range: ShoplingDateRange) {
  return `${range.start}:${range.end}`;
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

function productMasterConnection() {
  const secret = process.env.PRODUCT_MASTER_INTEGRATION_SECRET?.trim();
  if (!secret) throw new Error("PRODUCT_MASTER_INTEGRATION_SECRET_REQUIRED");
  const baseUrl = (
    process.env.PRODUCT_MASTER_BASE_URL?.trim() || DEFAULT_PRODUCT_MASTER_URL
  ).replace(/\/$/, "");
  if (!/^https:\/\//.test(baseUrl)) throw new Error("PRODUCT_MASTER_BASE_URL_INVALID");
  return { baseUrl, secret };
}

function supabaseConnection() {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const secret = (
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  )?.trim();
  if (!baseUrl || !secret) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  return { baseUrl, secret };
}

export function productMasterShoplingSalesEventSyncConfigured() {
  try {
    shoplingReadConfigFromEnv(shoplingEnvironment());
    productMasterConnection();
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
          source: "ops-center-canonical-sales-events",
          source_event_id: input.sourceEventId,
          correlation_id: input.correlationId,
          actor_type: input.operationType === SALES_EVENT_REQUEST ? "OPS_OPERATOR" : "OPS_WORKER",
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
    throw new Error(`SALES_EVENT_OPERATION_STORE_FAILED:${response.status}:${body.slice(0, 300)}`);
  }
  const rows = body ? (JSON.parse(body) as unknown) : [];
  return { duplicate: Array.isArray(rows) && rows.length === 0 };
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
    .select(
      "id,operation_type,source_event_id,correlation_id,status,input_snapshot,result_snapshot,error_message,started_at",
    )
    .eq("operation_type", operationType);
  if (correlationId) query = query.eq("correlation_id", correlationId);
  const result = await query.order("started_at", { ascending: false }).limit(limit);
  if (result.error) throw new Error(result.error.message);
  return (Array.isArray(result.data) ? result.data : []).filter(
    (row): row is OperationRow => Boolean(row && typeof row === "object"),
  );
}

function requestFromRow(row: OperationRow): SalesEventSyncRequest | null {
  const value = object(row.input_snapshot);
  const requestId = text(value.requestId);
  const analysisAsOf = iso(value.analysisAsOf);
  const planningGeneratedAt = iso(value.planningGeneratedAt);
  const planningContentFingerprint = text(value.planningContentFingerprint);
  const storedChunkDays = Math.round(number(value.chunkDays));
  const chunkDays = [2, SALES_EVENT_SOURCE_RANGE_DAYS, LEGACY_SALES_EVENT_SOURCE_RANGE_DAYS].includes(
    storedChunkDays,
  )
    ? storedChunkDays
    : LEGACY_SALES_EVENT_SOURCE_RANGE_DAYS;
  const ranges = Array.isArray(value.ranges)
    ? value.ranges
        .map(object)
        .map((range) => ({ start: text(range.start), end: text(range.end) }))
        .filter((range) => range.start && range.end)
    : [];
  if (
    !requestId ||
    !analysisAsOf ||
    !planningGeneratedAt ||
    !/^sha256:[a-f0-9]{64}$/.test(planningContentFingerprint) ||
    !ranges.length
  ) {
    return null;
  }
  return {
    requestId,
    analysisAsOf,
    analysisStartDate: text(value.analysisStartDate),
    analysisEndDate: text(value.analysisEndDate),
    chunkDays,
    planningGeneratedAt,
    planningContentFingerprint,
    ranges,
    createdAt: iso(value.createdAt) || analysisAsOf,
  };
}

function chunkFromRow(row: OperationRow): ProductMasterShoplingSalesEventChunk | null {
  const value = object(row.result_snapshot);
  return Array.isArray(value.events) && value.range
    ? (value as unknown as ProductMasterShoplingSalesEventChunk)
    : null;
}

function reportFromRow(row: OperationRow): SalesEventSyncReport | null {
  const value = object(row.result_snapshot);
  return /^sha256:[a-f0-9]{64}$/.test(text(value.planFingerprint))
    ? (value as unknown as SalesEventSyncReport)
    : null;
}

async function latestRequest() {
  const rows = await readOperations(SALES_EVENT_REQUEST, undefined, 20);
  for (const row of rows) {
    const request = requestFromRow(row);
    if (request) return request;
  }
  return null;
}

async function requestOperations(request: SalesEventSyncRequest) {
  const correlationId = requestCorrelationId(request.requestId);
  const [chunks, reports, canaries, fulls, failures] = await Promise.all([
    readOperations(SALES_EVENT_CHUNK, correlationId),
    readOperations(SALES_EVENT_REPORT, correlationId, 10),
    readOperations(SALES_EVENT_CANARY, correlationId, 10),
    readOperations(SALES_EVENT_FULL, correlationId, 10),
    readOperations(SALES_EVENT_FAILED, correlationId, 10),
  ]);
  return { correlationId, chunks, reports, canaries, fulls, failures };
}

export function createSalesEventSyncRequestPlan(
  requestId: string,
  planning: Awaited<ReturnType<typeof loadProductPlanningSnapshot>>,
  analysisAsOf = new Date().toISOString(),
): SalesEventSyncRequest {
  const asOf = new Date(analysisAsOf);
  if (!Number.isFinite(asOf.valueOf())) throw new Error("SALES_EVENT_AS_OF_INVALID");
  const start = new Date(asOf.valueOf() - ANALYSIS_DAYS * 24 * 60 * 60 * 1000);
  const analysisStartDate = dateOnly(start);
  const analysisEndDate = dateOnly(asOf);
  return {
    requestId,
    analysisAsOf: asOf.toISOString(),
    analysisStartDate,
    analysisEndDate,
    chunkDays: SALES_EVENT_SOURCE_RANGE_DAYS,
    planningGeneratedAt: planning.generatedAt,
    planningContentFingerprint: planning.contentFingerprint,
    ranges: splitShoplingDateRange(
      analysisStartDate,
      analysisEndDate,
      SALES_EVENT_SOURCE_RANGE_DAYS,
    ),
    createdAt: new Date().toISOString(),
  };
}

const ACTIVE_SALES_EVENT_STATES = new Set([
  "QUEUED", "RUNNING", "READY_CANARY", "READY_FULL", "STORAGE_NOT_READY",
]);

// Called only while the shared mutation guard is held. Every new analysis gets
// its own request/lineage; old chunks or approval evidence are never relabelled.
async function appendSalesEventSyncRequest(
  provenance: Record<string, unknown> = {},
  resetMs?: number,
) {
  shoplingReadConfigFromEnv(shoplingEnvironment());
  const planning = await loadProductPlanningSnapshot();
  const request = createSalesEventSyncRequestPlan(crypto.randomUUID(), planning);
  const createdAnalysisMs = Date.parse(request.analysisAsOf);
  if (resetMs !== undefined && (!Number.isFinite(createdAnalysisMs) || createdAnalysisMs < resetMs)) {
    throw new SalesEventActionError("CANONICAL_SALES_REFRESH_ANALYSIS_BEFORE_RESET", 409, "새 판매 분석시점이 재고 기준시점보다 이릅니다. 저장하지 않고 보류합니다.");
  }
  await storeOperation({
    operationType: SALES_EVENT_REQUEST,
    sourceEventId: `sales-event-request:${request.requestId}`,
    correlationId: requestCorrelationId(request.requestId),
    inputSnapshot: { ...request, ...provenance },
    resultSnapshot: {
      accepted: true,
      state: "QUEUED",
      canonicalWritesEnabled: false,
      sourceWritesEnabled: false,
      message: "최근 360일 Shopling 주문행을 정확한 timestamp 판매 이벤트로 읽습니다.",
    },
    occurredAt: request.createdAt,
  });
  const persisted = await latestRequest();
  if (persisted?.requestId !== request.requestId || persisted.analysisAsOf !== request.analysisAsOf) {
    throw new SalesEventActionError("SALES_EVENT_REQUEST_READBACK_FAILED", 503, "재수집 저장 결과가 확인되지 않았습니다. 재접수하지 말고 상태를 다시 조회하세요.");
  }
  return persisted;
}

export async function createProductMasterShoplingSalesEventSyncRequest(refresh?: SalesEventRefreshInput) {
  return withSalesEventMutationGuard(async () => {
    // Ordinary starts never supersede an active candidate. Explicit UI refresh
    // retains its exact candidate/confirmation checks and cannot act as a reset.
    const current = await loadProductMasterShoplingSalesEventSyncStatus();
    if (refresh) {
      assertSalesEventRefreshAllowed(current, refresh);
    } else if (ACTIVE_SALES_EVENT_STATES.has(current.state)) {
      throw new SalesEventActionError("SALES_EVENT_REQUEST_ALREADY_ACTIVE", 409, "기존 판매 후보가 진행 중입니다. 화면을 새로고침하세요.");
    }
    return appendSalesEventSyncRequest(refresh ? {
      refreshesRequestId: refresh.expectedRequestId,
      previousPlanFingerprint: refresh.expectedPlanFingerprint,
      refreshReason: "EXPLICIT_LATEST_CANDIDATE",
    } : {});
  });
}

// Server-only inventory caller supplies a persisted reset/stocktake gap, not an
// arbitrary client refresh flag. Re-read coverage UNDER the same lock used by
// creators, recovery and gate-through-publication. A concurrent newer candidate
// is reused rather than overwritten or reported as a newly accepted request.
export async function ensureProductMasterShoplingSalesEventCoverageRequest(resetAt: string) {
  return withSalesEventMutationGuard(async () => {
    const resetMs = typeof resetAt === "string" ? Date.parse(resetAt) : Number.NaN;
    if (!Number.isFinite(resetMs) || resetMs > Date.now()) {
      throw new SalesEventActionError("CANONICAL_SALES_REFRESH_RESET_AT_INVALID", 400, "현재 시점까지의 유효한 재고 기준시점이 필요합니다.");
    }
    const current = await loadProductMasterShoplingSalesEventSyncStatus();
    if (!current.configured) {
      throw new SalesEventActionError("SALES_EVENT_REFRESH_NOT_CONFIGURED", 503, "판매 수집 연결 설정을 먼저 확인해야 합니다.");
    }
    const analysisMs = Date.parse(current.analysisAsOf ?? "");
    const staleRequestWasActive = ACTIVE_SALES_EVENT_STATES.has(current.state);
    if (current.requestId && Number.isFinite(analysisMs) && analysisMs >= resetMs) {
      return {
        accepted: false, alreadyCovered: true, alreadyActive: staleRequestWasActive,
        supersededStaleRequest: false, previousRequestId: null,
        requestId: current.requestId, analysisAsOf: current.analysisAsOf,
        state: current.state, followupRequired: current.state === "FAILED",
        message: current.state === "FAILED"
          ? "수집 요청의 분석시점은 기준점을 포함하지만 실패한 작업의 복구가 필요합니다. 판매근거 확인 완료가 아닙니다."
          : "기존 수집 요청의 분석시점이 재고 기준시점을 포함하므로 중복 접수하지 않습니다. 판매근거 확인 완료 여부는 별도 검증합니다.",
      };
    }
    const created = await appendSalesEventSyncRequest({
      refreshReason: "INVENTORY_RESET_COVERAGE",
      coverageResetAt: new Date(resetMs).toISOString(),
      refreshesRequestId: current.requestId,
      previousPlanFingerprint: current.report?.planFingerprint ?? null,
    }, resetMs);
    return {
      accepted: true, alreadyCovered: false, alreadyActive: staleRequestWasActive,
      supersededStaleRequest: staleRequestWasActive, previousRequestId: current.requestId,
      requestId: created.requestId, analysisAsOf: created.analysisAsOf,
      state: "QUEUED" as const, followupRequired: false,
      message: staleRequestWasActive
        ? "기존 분석시점이 재고 기준점보다 오래되어 최신 시점의 새 수집 요청을 접수했습니다. 이전 기록은 보존하고 공식 반영 검증은 새로 진행합니다."
        : "재고 기준시점 이후까지 확인하도록 판매 이벤트 최신화를 접수했습니다. 공식 반영·발주·결제는 실행하지 않았습니다.",
    };
  });
}

async function verifiedPlanning(request: SalesEventSyncRequest) {
  const planning = await loadProductPlanningSnapshot();
  if (planning.contentFingerprint !== request.planningContentFingerprint) {
    throw new Error("SALES_EVENT_PLANNING_CHANGED");
  }
  return planning;
}

function operationRangeKey(row: OperationRow) {
  const input = object(row.input_snapshot);
  const range = object(input.range);
  return range.start && range.end
    ? `${text(range.start)}:${text(range.end)}`
    : text(input.rangeKey);
}

function eventFingerprint(events: ProductMasterSalesEventRow[]) {
  const normalized = events.map((row) => ({
    externalId: row.externalId,
    barcode: row.barcode,
    occurredAt: row.occurredAt,
    quantity: row.quantity,
    revenue: row.revenue,
    validSale: row.validSale,
  }));
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(normalized))
    .digest("hex")}`;
}

function planFingerprint(
  request: SalesEventSyncRequest,
  eventHash: string,
) {
  return `sha256:${createHash("sha256")
    .update(
      JSON.stringify({
        planningContentFingerprint: request.planningContentFingerprint,
        analysisAsOf: request.analysisAsOf,
        eventFingerprint: eventHash,
      }),
    )
    .digest("hex")}`;
}

function buildReport(
  request: SalesEventSyncRequest,
  chunks: ProductMasterShoplingSalesEventChunk[],
): { report: SalesEventSyncReport; events: ProductMasterSalesEventRow[] } {
  const combined = combineProductMasterShoplingSalesEventChunks(chunks);
  const eventHash = eventFingerprint(combined.events);
  return {
    report: {
      generatedAt: new Date().toISOString(),
      sourceEventCount: combined.eventRows,
      validEventCount: combined.validRows,
      tombstoneCount: combined.tombstoneRows,
      fetchedRows: combined.fetchedRows,
      ignoredRows: combined.ignoredRows,
      unmappedRows: combined.unmappedRows,
      duplicateRows: combined.duplicateRows,
      identityConflictCount: combined.conflictExternalIds.length,
      totalBaseUnits: combined.totalBaseUnits,
      totalRevenue: combined.totalRevenue,
      eventFingerprint: eventHash,
      planFingerprint: planFingerprint(request, eventHash),
    },
    events: combined.events,
  };
}

async function storeFailure(request: SalesEventSyncRequest, stage: string, error: unknown) {
  const message = safeMessage(error);
  await storeOperation({
    operationType: SALES_EVENT_FAILED,
    sourceEventId: `sales-event-failed:${request.requestId}:${encodeURIComponent(stage)}`,
    correlationId: requestCorrelationId(request.requestId),
    status: "FAILED",
    inputSnapshot: { requestId: request.requestId, stage },
    resultSnapshot: { requestId: request.requestId, stage, message },
    errorMessage: message,
  });
  return message;
}

export async function runProductMasterShoplingSalesEventSyncStep() {
  const request = await latestRequest();
  if (!request) return { processed: false, state: "IDLE" as const };
  const operations = await requestOperations(request);
  if (operations.fulls.length) return { processed: false, state: "COMPLETED" as const, requestId: request.requestId };
  if (operations.failures.length) return { processed: false, state: "FAILED" as const, requestId: request.requestId };
  if (operations.reports.length) return { processed: false, state: "READY" as const, requestId: request.requestId };

  let planning;
  try {
    planning = await verifiedPlanning(request);
  } catch (error) {
    const message = await storeFailure(request, "planning", error);
    return { processed: true, state: "FAILED" as const, requestId: request.requestId, message };
  }

  const completed = new Set(operations.chunks.map(operationRangeKey));
  const nextRange = request.ranges.find((range) => !completed.has(rangeKey(range)));
  if (nextRange) {
    try {
      const config = shoplingReadConfigFromEnv(shoplingEnvironment());
      const raw = await new ShoplingReadClient(config).read("orders", nextRange);
      const summary = aggregateProductMasterShoplingSalesEventChunk(
        raw,
        planning,
        nextRange,
        { analysisAsOf: request.analysisAsOf },
      );
      await storeOperation({
        operationType: SALES_EVENT_CHUNK,
        sourceEventId: `sales-event-chunk:${request.requestId}:${rangeKey(nextRange)}`,
        correlationId: requestCorrelationId(request.requestId),
        inputSnapshot: {
          requestId: request.requestId,
          range: nextRange,
          rangeKey: rangeKey(nextRange),
          planningContentFingerprint: request.planningContentFingerprint,
        },
        resultSnapshot: summary,
      });
      return {
        processed: true,
        state: "RUNNING" as const,
        requestId: request.requestId,
        range: nextRange,
        fetchedRows: summary.fetchedRows,
        eventRows: summary.eventRows,
        unmappedRows: summary.unmappedRows,
      };
    } catch (error) {
      const message = await storeFailure(request, `orders:${rangeKey(nextRange)}`, error);
      return { processed: true, state: "FAILED" as const, requestId: request.requestId, message };
    }
  }

  const chunks = operations.chunks.map(chunkFromRow).filter(Boolean) as ProductMasterShoplingSalesEventChunk[];
  const { report } = buildReport(request, chunks);
  await storeOperation({
    operationType: SALES_EVENT_REPORT,
    sourceEventId: `sales-event-report:${request.requestId}`,
    correlationId: requestCorrelationId(request.requestId),
    inputSnapshot: {
      requestId: request.requestId,
      analysisAsOf: request.analysisAsOf,
      planningContentFingerprint: request.planningContentFingerprint,
    },
    resultSnapshot: report,
  });
  return {
    processed: true,
    state: report.unmappedRows || report.identityConflictCount ? "BLOCKED" as const : "READY_CANARY" as const,
    requestId: request.requestId,
    report,
  };
}

async function productMasterSnapshot(request: SalesEventSyncRequest) {
  const { baseUrl, secret } = productMasterConnection();
  const response = await fetch(
    `${baseUrl}/api/integrations/sales-events?analysisAsOf=${encodeURIComponent(request.analysisAsOf)}`,
    {
      headers: {
        accept: "application/json",
        "x-commerce-os-integration-secret": secret,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    },
  );
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (response.status === 503 && payload.error === "SKU_SALES_EVENTS_STORAGE_NOT_READY") {
    return { ready: false as const, payload };
  }
  if (!response.ok || payload.ok !== true) {
    throw new Error(text(payload.message) || `SALES_EVENT_SNAPSHOT_FAILED:${response.status}`);
  }
  return { ready: true as const, payload };
}

async function postProductMasterEvents(events: ProductMasterSalesEventRow[]) {
  const { baseUrl, secret } = productMasterConnection();
  const response = await fetch(`${baseUrl}/api/integrations/sales-events`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-commerce-os-integration-secret": secret,
    },
    body: JSON.stringify({
      format: PRODUCT_MASTER_SALES_EVENT_FORMAT,
      source: PRODUCT_MASTER_SALES_EVENT_SOURCE,
      rows: events,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(120_000),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || payload.ok !== true) {
    throw new Error(text(payload.message) || `SALES_EVENT_IMPORT_FAILED:${response.status}`);
  }
  return payload;
}

function verifiedWriteResult(payload: Record<string, unknown>, expected: number) {
  const rows = Math.round(number(payload.rows));
  const verifiedRows = Math.round(number(payload.verifiedRows));
  return rows === expected && verifiedRows === expected;
}

export async function applyProductMasterShoplingSalesEvents(
  mode: "canary" | "full",
  expectedPlanFingerprint: string,
) {
  const request = await latestRequest();
  if (!request) throw new Error("SALES_EVENT_REQUEST_REQUIRED");
  const operations = await requestOperations(request);
  const report = operations.reports.map(reportFromRow).find(Boolean);
  if (!report) throw new Error("SALES_EVENT_REPORT_REQUIRED");
  if (report.planFingerprint !== expectedPlanFingerprint) {
    throw new Error("SALES_EVENT_PLAN_CHANGED");
  }
  if (report.unmappedRows || report.identityConflictCount) {
    throw new Error("SALES_EVENT_BACKFILL_BLOCKED");
  }
  if (mode === "full" && !operations.canaries.length) {
    throw new Error("SALES_EVENT_CANARY_REQUIRED");
  }
  const chunks = operations.chunks.map(chunkFromRow).filter(Boolean) as ProductMasterShoplingSalesEventChunk[];
  const rebuilt = buildReport(request, chunks);
  if (rebuilt.report.planFingerprint !== expectedPlanFingerprint) {
    throw new Error("SALES_EVENT_PLAN_REBUILD_CHANGED");
  }
  const storage = await productMasterSnapshot(request);
  if (!storage.ready) {
    return {
      ok: false as const,
      storageReady: false as const,
      migration: text(storage.payload.migration),
      message: text(storage.payload.message),
    };
  }

  const selected = mode === "canary" ? rebuilt.events.slice(0, 1) : rebuilt.events;
  let written = 0;
  for (let index = 0; index < selected.length; index += APPLY_BATCH_SIZE) {
    const batch = selected.slice(index, index + APPLY_BATCH_SIZE);
    const result = await postProductMasterEvents(batch);
    if (!verifiedWriteResult(result, batch.length)) {
      throw new Error(`SALES_EVENT_WRITE_VERIFY_FAILED:${index}:${batch.length}`);
    }
    written += batch.length;
  }

  const operationType = mode === "canary" ? SALES_EVENT_CANARY : SALES_EVENT_FULL;
  await storeOperation({
    operationType,
    sourceEventId: `sales-event-${mode}:${request.requestId}:${expectedPlanFingerprint}`,
    correlationId: requestCorrelationId(request.requestId),
    inputSnapshot: {
      requestId: request.requestId,
      mode,
      selected: selected.length,
      planFingerprint: expectedPlanFingerprint,
    },
    resultSnapshot: {
      verified: written === selected.length,
      written,
      planFingerprint: expectedPlanFingerprint,
      sourceWritesEnabled: false,
      businessWritesEnabled: true,
    },
  });
  const snapshot = await productMasterSnapshot(request);
  return {
    ok: true as const,
    storageReady: true as const,
    mode,
    selected: selected.length,
    written,
    planFingerprint: expectedPlanFingerprint,
    snapshot: snapshot.ready ? snapshot.payload : null,
  };
}

export async function loadProductMasterShoplingSalesEventSyncStatus(): Promise<SalesEventSyncStatus> {
  const configured = productMasterShoplingSalesEventSyncConfigured();
  const request = await latestRequest();
  const empty: SalesEventSyncStatus = {
    configured,
    requestId: null,
    analysisAsOf: null,
    state: "IDLE",
    stage: "대기",
    message: "정확한 30일 구간용 주문행 판매 이벤트 원장을 아직 수집하지 않았습니다.",
    completedRanges: 0,
    totalRanges: 0,
    progress: 0,
    report: null,
    canaryVerified: false,
    blockerCount: 0,
    error: null,
  };
  if (!request) return empty;
  const operations = await requestOperations(request);
  const completedRanges = new Set(operations.chunks.map(operationRangeKey)).size;
  const report = operations.reports.map(reportFromRow).find(Boolean) ?? null;
  const common = {
    ...empty,
    requestId: request.requestId,
    analysisAsOf: request.analysisAsOf,
    completedRanges,
    totalRanges: request.ranges.length,
    progress: Math.min(100, Math.round((completedRanges / request.ranges.length) * 100)),
    report,
    canaryVerified: operations.canaries.length > 0,
  };
  if (operations.failures.length) {
    const error = safeMessage(operations.failures[0].error_message || object(operations.failures[0].result_snapshot).message);
    return { ...common, state: "FAILED", stage: "수집 실패", message: error, error };
  }
  if (operations.fulls.length) {
    return { ...common, state: "COMPLETED", stage: "판매 이벤트 원장 완료", message: "최근 360일 주문행 판매 이벤트가 Product Master에 적재·검증되었습니다.", progress: 100 };
  }
  if (!report) {
    return {
      ...common,
      state: completedRanges ? "RUNNING" : "QUEUED",
      stage: completedRanges ? "Shopling 주문행 수집 중" : "Worker 대기",
      message: `${completedRanges}/${request.ranges.length}개 기간을 읽었습니다.`,
    };
  }
  const blockers = report.unmappedRows + report.identityConflictCount;
  if (blockers) {
    return { ...common, state: "BLOCKED", stage: "연결 검토 필요", message: `미연결/identity 충돌 ${blockers}건으로 적재를 차단했습니다.`, blockerCount: blockers, progress: 100 };
  }
  try {
    const storage = await productMasterSnapshot(request);
    if (!storage.ready) {
      return { ...common, state: "STORAGE_NOT_READY", stage: "Product Master migration 필요", message: text(storage.payload.message) || "sku_sales_events migration 적용이 필요합니다.", progress: 100 };
    }
  } catch (error) {
    const message = safeMessage(error);
    return { ...common, state: "FAILED", stage: "Product Master 확인 실패", message, error: message, progress: 100 };
  }
  return {
    ...common,
    state: operations.canaries.length ? "READY_FULL" : "READY_CANARY",
    stage: operations.canaries.length ? "전수 적재 준비" : "카나리 적재 준비",
    message: operations.canaries.length
      ? `카나리 검증 완료. 주문행 ${report.sourceEventCount}건 전수 적재 준비 상태입니다.`
      : `주문행 ${report.sourceEventCount}건을 먼저 1건 카나리로 검증합니다.`,
    progress: 100,
  };
}
