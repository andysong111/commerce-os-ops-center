import { openChinaOrderCommitmentsByBarcode } from "@/lib/chinaOrderLedger";
import type { ProductDecisionSnapshot } from "@/lib/productDecisionSnapshot";
import {
  aggregateShoplingClaimChunk,
  aggregateShoplingOrderChunk,
  buildLiveProductDecisionSnapshot,
  combineShoplingLiveChunks,
  type ProductPlanningSnapshot,
  type ShoplingClaimChunkSummary,
  type ShoplingOrderChunkSummary,
  type ShoplingOrderReference,
} from "@/lib/shopling/shoplingLiveAggregation";
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

export const PRODUCT_DECISION_LIVE_REQUEST =
  "PRODUCT_DECISION_LIVE_REFRESH_REQUEST";
export const PRODUCT_DECISION_LIVE_ORDER_CHUNK =
  "PRODUCT_DECISION_LIVE_ORDER_CHUNK";
export const PRODUCT_DECISION_LIVE_CLAIM_CHUNK =
  "PRODUCT_DECISION_LIVE_CLAIM_CHUNK";
export const PRODUCT_DECISION_LIVE_STEP_FAILURE =
  "PRODUCT_DECISION_LIVE_STEP_FAILURE";
export const PRODUCT_DECISION_LIVE_FAILED =
  "PRODUCT_DECISION_LIVE_FAILED";
export const PRODUCT_DECISION_LIVE_SHADOW =
  "PRODUCT_DECISION_LIVE_SHADOW";

const BASELINE_OPERATION = "PRODUCT_DECISION_SNAPSHOT_IMPORT";
const DEFAULT_PRODUCT_MASTER_URL =
  "https://commerce-os-product-master.vercel.app";
const ANALYSIS_DAYS = 360;
const MAX_STEP_ATTEMPTS = 3;
const OPERATION_LIMIT = 500;

export type ProductDecisionLiveRequest = {
  requestId: string;
  analysisAsOf: string;
  analysisStartDate: string;
  analysisEndDate: string;
  planningGeneratedAt: string;
  planningContentFingerprint: string;
  planningProductCount: number;
  orderRanges: ShoplingDateRange[];
  claimRanges: ShoplingDateRange[];
  createdAt: string;
};

export type ProductDecisionLiveComparison = {
  baselineRunId: string | null;
  baselineGeneratedAt: string | null;
  baselineProductCount: number;
  liveProductCount: number;
  sharedProductCount: number;
  statusChangedCount: number;
  quantityChangedCount: number;
  baselineExpectedSpend: number;
  liveExpectedSpend: number;
  expectedSpendDelta: number;
};

export type ProductDecisionLiveStatus = {
  configured: boolean;
  requestId: string | null;
  state:
    | "IDLE"
    | "QUEUED"
    | "RUNNING"
    | "COMPLETED"
    | "FAILED";
  stage: string;
  message: string;
  analysisAsOf: string | null;
  planningGeneratedAt: string | null;
  orderCompleted: number;
  orderTotal: number;
  claimCompleted: number;
  claimTotal: number;
  progress: number;
  finalSnapshot: ProductDecisionSnapshot | null;
  comparison: ProductDecisionLiveComparison | null;
  error: string | null;
};

type OperationRow = {
  id?: unknown;
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
  source: string;
  actorType: string;
  inputSnapshot: unknown;
  resultSnapshot: unknown;
  errorMessage?: string | null;
  occurredAt?: string;
};

type PlanningPayload = {
  ok?: boolean;
  generatedAt?: string;
  contentFingerprint?: string;
  productCount?: number;
  products?: ProductPlanningSnapshot["products"];
  message?: string;
  error?: string;
};

type VersionedProductPlanningSnapshot = ProductPlanningSnapshot & {
  contentFingerprint: string;
};

type FailureSnapshot = {
  requestId?: unknown;
  stageKey?: unknown;
  attempt?: unknown;
  message?: unknown;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function integer(value: unknown) {
  return Math.max(0, Math.round(number(value)));
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

function rangeKey(range: ShoplingDateRange) {
  return `${range.start}:${range.end}`;
}

function requestCorrelationId(requestId: string) {
  return `product-decision-live:${requestId}`;
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

export function productDecisionLiveRefreshConfigured() {
  try {
    shoplingReadConfigFromEnv(shoplingEnvironment());
    return Boolean(process.env.PRODUCT_MASTER_INTEGRATION_SECRET?.trim());
  } catch {
    return false;
  }
}

function planningConnection() {
  const secret = process.env.PRODUCT_MASTER_INTEGRATION_SECRET?.trim();
  if (!secret) throw new Error("PRODUCT_MASTER_INTEGRATION_SECRET_REQUIRED");
  const baseUrl = (
    process.env.PRODUCT_MASTER_BASE_URL?.trim() ||
    DEFAULT_PRODUCT_MASTER_URL
  ).replace(/\/$/, "");
  if (!/^https:\/\//.test(baseUrl)) {
    throw new Error("PRODUCT_MASTER_BASE_URL_INVALID");
  }
  return { baseUrl, secret };
}

export async function loadProductPlanningSnapshot(
  options: { requestTimeoutMs?: number } = {},
): Promise<VersionedProductPlanningSnapshot> {
  const { baseUrl, secret } = planningConnection();
  const requestTimeoutMs = Math.max(
    1_000,
    Math.min(30_000, Math.trunc(options.requestTimeoutMs ?? 30_000)),
  );
  const response = await fetch(
    `${baseUrl}/api/integrations/planning-snapshot`,
    {
      method: "GET",
      headers: {
        accept: "application/json",
        "x-commerce-os-integration-secret": secret,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(requestTimeoutMs),
    },
  );
  const payload = (await response.json().catch(() => ({}))) as PlanningPayload;
  if (
    !response.ok ||
    payload.ok !== true ||
    !Array.isArray(payload.products)
  ) {
    throw new Error(
      payload.message ||
        payload.error ||
        `PRODUCT_MASTER_PLANNING_FAILED:${response.status}`,
    );
  }
  const generatedAt = iso(payload.generatedAt);
  if (!generatedAt) throw new Error("PRODUCT_MASTER_PLANNING_TIME_INVALID");
  const contentFingerprint = text(payload.contentFingerprint);
  if (!/^sha256:[a-f0-9]{64}$/.test(contentFingerprint)) {
    throw new Error("PRODUCT_MASTER_PLANNING_FINGERPRINT_INVALID");
  }
  if (!payload.products.length) {
    throw new Error("PRODUCT_MASTER_PLANNING_PRODUCTS_EMPTY");
  }
  return { generatedAt, contentFingerprint, products: payload.products };
}

function supabaseConnection() {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(
    /\/$/,
    "",
  );
  const secret = (
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )?.trim();
  if (!baseUrl || !secret) {
    throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  }
  return { baseUrl, secret };
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
          source: input.source,
          source_event_id: input.sourceEventId,
          correlation_id: input.correlationId,
          actor_type: input.actorType,
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
      `PRODUCT_DECISION_LIVE_STORE_FAILED:${response.status}:${body.slice(0, 500)}`,
    );
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

function requestFromRow(row: OperationRow): ProductDecisionLiveRequest | null {
  const value = object(row.input_snapshot);
  const requestId = text(value.requestId);
  const analysisAsOf = iso(value.analysisAsOf);
  const planningGeneratedAt = iso(value.planningGeneratedAt);
  const planningContentFingerprint = text(value.planningContentFingerprint);
  const orderRanges = Array.isArray(value.orderRanges)
    ? value.orderRanges
        .map(object)
        .map((range) => ({ start: text(range.start), end: text(range.end) }))
        .filter((range) => range.start && range.end)
    : [];
  const claimRanges = Array.isArray(value.claimRanges)
    ? value.claimRanges
        .map(object)
        .map((range) => ({ start: text(range.start), end: text(range.end) }))
        .filter((range) => range.start && range.end)
    : [];
  if (
    !requestId ||
    !analysisAsOf ||
    !planningGeneratedAt ||
    !/^sha256:[a-f0-9]{64}$/.test(planningContentFingerprint) ||
    !orderRanges.length ||
    !claimRanges.length
  ) {
    return null;
  }
  return {
    requestId,
    analysisAsOf,
    analysisStartDate: text(value.analysisStartDate),
    analysisEndDate: text(value.analysisEndDate),
    planningGeneratedAt,
    planningContentFingerprint,
    planningProductCount: integer(value.planningProductCount),
    orderRanges,
    claimRanges,
    createdAt: iso(value.createdAt) || analysisAsOf,
  };
}

export function createProductDecisionLiveRequestPlan(
  requestId: string,
  planning: VersionedProductPlanningSnapshot,
  analysisAsOf = new Date().toISOString(),
): ProductDecisionLiveRequest {
  const asOf = new Date(analysisAsOf);
  if (!Number.isFinite(asOf.valueOf())) {
    throw new Error("PRODUCT_DECISION_LIVE_AS_OF_INVALID");
  }
  const start = new Date(asOf.valueOf() - ANALYSIS_DAYS * 24 * 60 * 60 * 1000);
  const analysisStartDate = dateOnly(start);
  const analysisEndDate = dateOnly(asOf);
  return {
    requestId,
    analysisAsOf: asOf.toISOString(),
    analysisStartDate,
    analysisEndDate,
    planningGeneratedAt: planning.generatedAt,
    planningContentFingerprint: planning.contentFingerprint,
    planningProductCount: planning.products.length,
    orderRanges: splitShoplingDateRange(
      analysisStartDate,
      analysisEndDate,
      7,
    ),
    claimRanges: splitShoplingDateRange(
      analysisStartDate,
      analysisEndDate,
      90,
    ),
    createdAt: new Date().toISOString(),
  };
}

export async function createProductDecisionLiveRefreshRequest() {
  shoplingReadConfigFromEnv(shoplingEnvironment());
  const planning = await loadProductPlanningSnapshot();
  const request = createProductDecisionLiveRequestPlan(
    crypto.randomUUID(),
    planning,
  );
  await storeOperation({
    operationType: PRODUCT_DECISION_LIVE_REQUEST,
    sourceEventId: `product-decision-live-request:${request.requestId}`,
    correlationId: requestCorrelationId(request.requestId),
    source: "ops-center-product-decision-live",
    actorType: "OPS_OPERATOR",
    inputSnapshot: request,
    resultSnapshot: {
      accepted: true,
      state: "QUEUED",
      message:
        "Shopling 주문·클레임을 구간별로 읽어 Ops Center 자체 발주안을 그림자 생성합니다.",
    },
    occurredAt: request.createdAt,
  });
  return request;
}

async function latestRequest() {
  const requests = await readOperations(PRODUCT_DECISION_LIVE_REQUEST, undefined, 20);
  for (const row of requests) {
    const request = requestFromRow(row);
    if (request) return request;
  }
  return null;
}

function operationRangeKey(row: OperationRow) {
  const input = object(row.input_snapshot);
  const range = object(input.range);
  return range.start && range.end
    ? `${text(range.start)}:${text(range.end)}`
    : text(input.rangeKey);
}

function orderSummary(row: OperationRow): ShoplingOrderChunkSummary | null {
  const value = object(row.result_snapshot);
  return Array.isArray(value.products) && Array.isArray(value.references)
    ? (value as unknown as ShoplingOrderChunkSummary)
    : null;
}

function claimSummary(row: OperationRow): ShoplingClaimChunkSummary | null {
  const value = object(row.result_snapshot);
  return Array.isArray(value.products)
    ? (value as unknown as ShoplingClaimChunkSummary)
    : null;
}

function finalPayload(row: OperationRow) {
  const value = object(row.result_snapshot);
  const snapshot = value.snapshot;
  return snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
    ? {
        snapshot: snapshot as ProductDecisionSnapshot,
        comparison:
          value.comparison &&
          typeof value.comparison === "object" &&
          !Array.isArray(value.comparison)
            ? (value.comparison as ProductDecisionLiveComparison)
            : null,
      }
    : null;
}

async function requestOperations(request: ProductDecisionLiveRequest) {
  const correlationId = requestCorrelationId(request.requestId);
  const [orders, claims, failures, terminals, finals] = await Promise.all([
    readOperations(PRODUCT_DECISION_LIVE_ORDER_CHUNK, correlationId),
    readOperations(PRODUCT_DECISION_LIVE_CLAIM_CHUNK, correlationId),
    readOperations(PRODUCT_DECISION_LIVE_STEP_FAILURE, correlationId),
    readOperations(PRODUCT_DECISION_LIVE_FAILED, correlationId),
    readOperations(PRODUCT_DECISION_LIVE_SHADOW, correlationId),
  ]);
  return { correlationId, orders, claims, failures, terminals, finals };
}

function stageFailureCount(rows: OperationRow[], stageKey: string) {
  return rows.filter((row) => {
    const result = object(row.result_snapshot) as FailureSnapshot;
    return text(result.stageKey) === stageKey;
  }).length;
}

async function storeStepFailure(
  request: ProductDecisionLiveRequest,
  stageKey: string,
  attempt: number,
  error: unknown,
) {
  const message =
    error instanceof Error ? error.message : "PRODUCT_DECISION_LIVE_STEP_FAILED";
  await storeOperation({
    operationType: PRODUCT_DECISION_LIVE_STEP_FAILURE,
    sourceEventId:
      `product-decision-live-step-failure:${request.requestId}:` +
      `${encodeURIComponent(stageKey)}:${attempt}`,
    correlationId: requestCorrelationId(request.requestId),
    status: "FAILED",
    source: "ops-center-product-decision-live",
    actorType: "OPS_WORKER",
    inputSnapshot: { requestId: request.requestId, stageKey, attempt },
    resultSnapshot: { requestId: request.requestId, stageKey, attempt, message },
    errorMessage: message,
  });
  return message;
}

async function storeTerminalFailure(
  request: ProductDecisionLiveRequest,
  stageKey: string,
  message: string,
) {
  await storeOperation({
    operationType: PRODUCT_DECISION_LIVE_FAILED,
    sourceEventId: `product-decision-live-failed:${request.requestId}`,
    correlationId: requestCorrelationId(request.requestId),
    status: "FAILED",
    source: "ops-center-product-decision-live",
    actorType: "OPS_WORKER",
    inputSnapshot: { requestId: request.requestId, stageKey },
    resultSnapshot: { requestId: request.requestId, stageKey, message },
    errorMessage: message,
  });
}

async function verifiedPlanning(request: ProductDecisionLiveRequest) {
  const planning = await loadProductPlanningSnapshot();
  if (planning.contentFingerprint !== request.planningContentFingerprint) {
    throw new Error(
      `PRODUCT_MASTER_PLANNING_CHANGED:${request.planningContentFingerprint}:${planning.contentFingerprint}`,
    );
  }
  if (planning.products.length !== request.planningProductCount) {
    throw new Error(
      `PRODUCT_MASTER_PLANNING_COUNT_CHANGED:${request.planningProductCount}:${planning.products.length}`,
    );
  }
  return planning;
}

async function baselineSnapshot() {
  const rows = await readOperations(BASELINE_OPERATION, undefined, 1);
  const value = object(rows[0]?.result_snapshot);
  return Array.isArray(value.products)
    ? (value as unknown as ProductDecisionSnapshot)
    : null;
}

export function compareLiveProductDecision(
  baseline: ProductDecisionSnapshot | null,
  live: ProductDecisionSnapshot,
): ProductDecisionLiveComparison {
  const baselineProducts = new Map(
    (baseline?.products ?? []).map((row) => [text(row.barcode), row]),
  );
  let sharedProductCount = 0;
  let statusChangedCount = 0;
  let quantityChangedCount = 0;
  for (const row of live.products ?? []) {
    const matched = baselineProducts.get(text(row.barcode));
    if (!matched) continue;
    sharedProductCount += 1;
    if (text(matched.status) !== text(row.status)) statusChangedCount += 1;
    if (integer(matched.recommendedQty) !== integer(row.recommendedQty)) {
      quantityChangedCount += 1;
    }
  }
  const baselineExpectedSpend = integer(baseline?.expectedSpend);
  const liveExpectedSpend = integer(live.expectedSpend);
  return {
    baselineRunId: text(baseline?.runId) || null,
    baselineGeneratedAt: iso(baseline?.generatedAt),
    baselineProductCount: baseline?.products?.length ?? 0,
    liveProductCount: live.products?.length ?? 0,
    sharedProductCount,
    statusChangedCount,
    quantityChangedCount,
    baselineExpectedSpend,
    liveExpectedSpend,
    expectedSpendDelta: liveExpectedSpend - baselineExpectedSpend,
  };
}

async function executeOrderStep(
  request: ProductDecisionLiveRequest,
  range: ShoplingDateRange,
  planning: ProductPlanningSnapshot,
) {
  const config = shoplingReadConfigFromEnv(shoplingEnvironment());
  const rows = await new ShoplingReadClient(config).read("orders", range);
  const summary = aggregateShoplingOrderChunk(
    rows,
    planning,
    request.analysisAsOf,
    range,
  );
  await storeOperation({
    operationType: PRODUCT_DECISION_LIVE_ORDER_CHUNK,
    sourceEventId:
      `product-decision-live-order:${request.requestId}:` +
      `${range.start}:${range.end}`,
    correlationId: requestCorrelationId(request.requestId),
    source: "shopling-read-api",
    actorType: "OPS_WORKER",
    inputSnapshot: {
      requestId: request.requestId,
      range,
      rangeKey: rangeKey(range),
      planningGeneratedAt: request.planningGeneratedAt,
      planningContentFingerprint: request.planningContentFingerprint,
    },
    resultSnapshot: summary,
  });
  return summary;
}

async function executeClaimStep(
  request: ProductDecisionLiveRequest,
  range: ShoplingDateRange,
  planning: ProductPlanningSnapshot,
  references: ShoplingOrderReference[],
) {
  const config = shoplingReadConfigFromEnv(shoplingEnvironment());
  const rows = await new ShoplingReadClient(config).read("claims", range);
  const summary = aggregateShoplingClaimChunk(
    rows,
    planning,
    references,
    request.analysisAsOf,
    range,
  );
  await storeOperation({
    operationType: PRODUCT_DECISION_LIVE_CLAIM_CHUNK,
    sourceEventId:
      `product-decision-live-claim:${request.requestId}:` +
      `${range.start}:${range.end}`,
    correlationId: requestCorrelationId(request.requestId),
    source: "shopling-read-api",
    actorType: "OPS_WORKER",
    inputSnapshot: {
      requestId: request.requestId,
      range,
      rangeKey: rangeKey(range),
      planningGeneratedAt: request.planningGeneratedAt,
      planningContentFingerprint: request.planningContentFingerprint,
    },
    resultSnapshot: summary,
  });
  return summary;
}

async function executeFinalStep(
  request: ProductDecisionLiveRequest,
  planning: ProductPlanningSnapshot,
  orderRows: OperationRow[],
  claimRows: OperationRow[],
) {
  const orderChunks = orderRows.map(orderSummary).filter(Boolean) as ShoplingOrderChunkSummary[];
  const claimChunks = claimRows.map(claimSummary).filter(Boolean) as ShoplingClaimChunkSummary[];
  const aggregate = combineShoplingLiveChunks(
    planning,
    orderChunks,
    claimChunks,
    request.analysisAsOf,
  );
  const commitments = await openChinaOrderCommitmentsByBarcode();
  if (commitments.error) {
    throw new Error(`CHINA_ORDER_COMMITMENT_READ_FAILED:${commitments.error}`);
  }
  const snapshot = buildLiveProductDecisionSnapshot(
    request.requestId,
    aggregate,
    commitments.commitments,
  );
  const comparison = compareLiveProductDecision(
    await baselineSnapshot(),
    snapshot,
  );
  await storeOperation({
    operationType: PRODUCT_DECISION_LIVE_SHADOW,
    sourceEventId: `product-decision-live-shadow:${request.requestId}`,
    correlationId: requestCorrelationId(request.requestId),
    source: "ops-center-product-decision-engine",
    actorType: "OPS_WORKER",
    inputSnapshot: {
      request,
      orderChunkCount: orderChunks.length,
      claimChunkCount: claimChunks.length,
      commitmentBarcodeCount: commitments.commitments.size,
    },
    resultSnapshot: { snapshot, comparison },
  });
  return { snapshot, comparison };
}

export async function runProductDecisionLiveRefreshStep() {
  const request = await latestRequest();
  if (!request) {
    return { processed: false, state: "IDLE", message: "대기 중인 실시간 발주 계산이 없습니다." };
  }
  const operations = await requestOperations(request);
  if (operations.finals.length) {
    return { processed: false, state: "COMPLETED", requestId: request.requestId, message: "실시간 발주 그림자 계산이 이미 완료됐습니다." };
  }
  if (operations.terminals.length) {
    return { processed: false, state: "FAILED", requestId: request.requestId, message: text(operations.terminals[0].error_message) || "실시간 발주 계산이 실패 종료됐습니다." };
  }

  let planning: ProductPlanningSnapshot;
  try {
    planning = await verifiedPlanning(request);
  } catch (error) {
    const message = await storeStepFailure(request, "planning", 1, error);
    await storeTerminalFailure(request, "planning", message);
    return { processed: true, state: "FAILED", requestId: request.requestId, stage: "planning", message };
  }

  const completedOrderKeys = new Set(operations.orders.map(operationRangeKey));
  const nextOrder = request.orderRanges.find(
    (range) => !completedOrderKeys.has(rangeKey(range)),
  );
  if (nextOrder) {
    const stageKey = `order:${rangeKey(nextOrder)}`;
    const attempt = stageFailureCount(operations.failures, stageKey) + 1;
    if (attempt > MAX_STEP_ATTEMPTS) {
      const message = `SHOPLING_ORDER_CHUNK_RETRY_EXHAUSTED:${rangeKey(nextOrder)}`;
      await storeTerminalFailure(request, stageKey, message);
      return { processed: true, state: "FAILED", requestId: request.requestId, stage: stageKey, message };
    }
    try {
      const summary = await executeOrderStep(request, nextOrder, planning);
      return {
        processed: true,
        state: "RUNNING",
        requestId: request.requestId,
        stage: stageKey,
        message: `Shopling 주문 ${nextOrder.start}~${nextOrder.end} 조회 완료`,
        fetchedRows: summary.fetchedRows,
        acceptedRows: summary.acceptedRows,
      };
    } catch (error) {
      const message = await storeStepFailure(request, stageKey, attempt, error);
      if (attempt >= MAX_STEP_ATTEMPTS) {
        await storeTerminalFailure(request, stageKey, message);
      }
      return { processed: true, state: attempt >= MAX_STEP_ATTEMPTS ? "FAILED" : "RUNNING", requestId: request.requestId, stage: stageKey, attempt, message };
    }
  }

  const orderChunks = operations.orders.map(orderSummary).filter(Boolean) as ShoplingOrderChunkSummary[];
  const references = orderChunks.flatMap((chunk) => chunk.references);
  const completedClaimKeys = new Set(operations.claims.map(operationRangeKey));
  const nextClaim = request.claimRanges.find(
    (range) => !completedClaimKeys.has(rangeKey(range)),
  );
  if (nextClaim) {
    const stageKey = `claim:${rangeKey(nextClaim)}`;
    const attempt = stageFailureCount(operations.failures, stageKey) + 1;
    if (attempt > MAX_STEP_ATTEMPTS) {
      const message = `SHOPLING_CLAIM_CHUNK_RETRY_EXHAUSTED:${rangeKey(nextClaim)}`;
      await storeTerminalFailure(request, stageKey, message);
      return { processed: true, state: "FAILED", requestId: request.requestId, stage: stageKey, message };
    }
    try {
      const summary = await executeClaimStep(
        request,
        nextClaim,
        planning,
        references,
      );
      return {
        processed: true,
        state: "RUNNING",
        requestId: request.requestId,
        stage: stageKey,
        message: `Shopling 클레임 ${nextClaim.start}~${nextClaim.end} 조회 완료`,
        fetchedRows: summary.fetchedRows,
        acceptedRows: summary.acceptedRows,
      };
    } catch (error) {
      const message = await storeStepFailure(request, stageKey, attempt, error);
      if (attempt >= MAX_STEP_ATTEMPTS) {
        await storeTerminalFailure(request, stageKey, message);
      }
      return { processed: true, state: attempt >= MAX_STEP_ATTEMPTS ? "FAILED" : "RUNNING", requestId: request.requestId, stage: stageKey, attempt, message };
    }
  }

  try {
    const final = await executeFinalStep(
      request,
      planning,
      operations.orders,
      operations.claims,
    );
    return {
      processed: true,
      state: "COMPLETED",
      requestId: request.requestId,
      stage: "final",
      message: "Ops Center 자체 실시간 발주안 그림자 계산을 완료했습니다.",
      productCount: final.snapshot.products?.length ?? 0,
      expectedSpend: final.snapshot.expectedSpend ?? 0,
    };
  } catch (error) {
    const stageKey = "final";
    const attempt = stageFailureCount(operations.failures, stageKey) + 1;
    const message = await storeStepFailure(request, stageKey, attempt, error);
    if (attempt >= MAX_STEP_ATTEMPTS) {
      await storeTerminalFailure(request, stageKey, message);
    }
    return { processed: true, state: attempt >= MAX_STEP_ATTEMPTS ? "FAILED" : "RUNNING", requestId: request.requestId, stage: stageKey, attempt, message };
  }
}

export async function loadProductDecisionLiveStatus(
  requestedId?: string | null,
): Promise<ProductDecisionLiveStatus> {
  const request = requestedId
    ? requestFromRow(
        (await readOperations(
          PRODUCT_DECISION_LIVE_REQUEST,
          requestCorrelationId(requestedId),
          1,
        ))[0] ?? {},
      )
    : await latestRequest();
  if (!request) {
    return {
      configured: productDecisionLiveRefreshConfigured(),
      requestId: null,
      state: "IDLE",
      stage: "idle",
      message: "아직 실시간 판매 발주 계산을 실행하지 않았습니다.",
      analysisAsOf: null,
      planningGeneratedAt: null,
      orderCompleted: 0,
      orderTotal: 0,
      claimCompleted: 0,
      claimTotal: 0,
      progress: 0,
      finalSnapshot: null,
      comparison: null,
      error: null,
    };
  }
  const operations = await requestOperations(request);
  const final = finalPayload(operations.finals[0] ?? {});
  const terminal = operations.terminals[0];
  const orderCompleted = new Set(operations.orders.map(operationRangeKey)).size;
  const claimCompleted = new Set(operations.claims.map(operationRangeKey)).size;
  const totalSteps = request.orderRanges.length + request.claimRanges.length + 1;
  const completedSteps = orderCompleted + claimCompleted + (final ? 1 : 0);
  const state = final
    ? "COMPLETED"
    : terminal
      ? "FAILED"
      : completedSteps > 0
        ? "RUNNING"
        : "QUEUED";
  const currentStage = final
    ? "final"
    : terminal
      ? text(object(terminal.result_snapshot).stageKey) || "failed"
      : orderCompleted < request.orderRanges.length
        ? "orders"
        : claimCompleted < request.claimRanges.length
          ? "claims"
          : "final";
  return {
    configured: productDecisionLiveRefreshConfigured(),
    requestId: request.requestId,
    state,
    stage: currentStage,
    message: final
      ? "실시간 판매 발주안 그림자 계산이 완료됐습니다. 운영 전환 전 비교 검증 중입니다."
      : terminal
        ? text(terminal.error_message) || "실시간 판매 발주안 계산이 실패했습니다."
        : `주문 ${orderCompleted}/${request.orderRanges.length} · 클레임 ${claimCompleted}/${request.claimRanges.length}`,
    analysisAsOf: request.analysisAsOf,
    planningGeneratedAt: request.planningGeneratedAt,
    orderCompleted,
    orderTotal: request.orderRanges.length,
    claimCompleted,
    claimTotal: request.claimRanges.length,
    progress: Math.min(100, Math.round((completedSteps / totalSteps) * 100)),
    finalSnapshot: final?.snapshot ?? null,
    comparison: final?.comparison ?? null,
    error: terminal ? text(terminal.error_message) || null : null,
  };
}
