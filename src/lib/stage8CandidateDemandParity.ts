import { createHash } from "node:crypto";
import {
  combineProductMasterShoplingSalesEventChunks,
  type ProductMasterSalesEventRow,
  type ProductMasterShoplingSalesEventChunk,
} from "@/lib/productMasterShoplingSalesEventEngine";
import {
  SALES_EVENT_CHUNK,
  SALES_EVENT_REPORT,
  SALES_EVENT_REQUEST,
  type SalesEventSyncReport,
  type SalesEventSyncRequest,
} from "@/lib/productMasterShoplingSalesEventSync";
import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import {
  aggregateShoplingOrderChunk,
  combineShoplingLiveChunks,
  type ProductPlanningSnapshot,
  type ShoplingOrderChunkSummary,
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

export const CANDIDATE_PARITY_REQUEST = "STAGE8_CANDIDATE_DEMAND_PARITY_REQUEST";
export const CANDIDATE_PARITY_ORDER_CHUNK = "STAGE8_CANDIDATE_DEMAND_PARITY_ORDER_CHUNK";
export const CANDIDATE_PARITY_STEP_FAILURE = "STAGE8_CANDIDATE_DEMAND_PARITY_STEP_FAILURE";
export const CANDIDATE_PARITY_FAILED = "STAGE8_CANDIDATE_DEMAND_PARITY_FAILED";
export const CANDIDATE_PARITY_REPORT = "STAGE8_CANDIDATE_DEMAND_PARITY_REPORT";

const DAY_MS = 24 * 60 * 60 * 1000;
const BUCKET_DAYS = 30;
const BUCKET_COUNT = 12;
const RANGE_DAYS = 7;
const MAX_STEP_ATTEMPTS = 3;
const OPERATION_LIMIT = 500;
const MAX_MISMATCH_SAMPLES = 50;
const MANAGED_BARCODE = /^B[A-Z]{2}\d+-\d+$/;

export type CandidateRollingSalesRow = {
  barcode: string;
  monthlyUnits: number[];
  monthlyRevenue: number[];
  validEventCount: number;
};

export type CandidateSalesSnapshot = {
  salesRequestId: string;
  analysisAsOf: string;
  planningContentFingerprint: string;
  eventFingerprint: string;
  planFingerprint: string;
  report: SalesEventSyncReport;
  events: ProductMasterSalesEventRow[];
};

export type CandidateDemandParityRequest = {
  requestId: string;
  candidateSalesRequestId: string;
  analysisAsOf: string;
  analysisStartDate: string;
  analysisEndDate: string;
  planningGeneratedAt: string;
  planningContentFingerprint: string;
  candidateEventFingerprint: string;
  candidatePlanFingerprint: string;
  ranges: ShoplingDateRange[];
  createdAt: string;
};

export type CandidateDemandParityMismatch = {
  barcode: string;
  unitBuckets: number[];
  revenueBuckets: number[];
  candidateUnits: number[];
  directUnits: number[];
  candidateRevenue: number[];
  directRevenue: number[];
};

export type CandidateDemandParityReport = {
  generatedAt: string;
  analysisAsOf: string;
  candidateSalesRequestId: string;
  planningContentFingerprint: string;
  candidateEventFingerprint: string;
  candidatePlanFingerprint: string;
  candidateRowCount: number;
  directManagedRowCount: number;
  sharedRowCount: number;
  exactRowCount: number;
  unitMismatchCount: number;
  revenueMismatchCount: number;
  missingDirectCount: number;
  directOnlyManagedCount: number;
  directFetchedRows: number;
  directAcceptedRows: number;
  directUnmappedRows: number;
  candidateManagedUnits: number;
  directManagedUnits: number;
  candidateManagedRevenue: number;
  directManagedRevenue: number;
  candidateMinusDirectUnits: number;
  candidateMinusDirectRevenue: number;
  mismatchSamples: CandidateDemandParityMismatch[];
  missingDirectBarcodes: string[];
  directOnlyManagedBarcodes: string[];
  blockerCount: number;
  parityFingerprint: string;
};

export type CandidateDemandParityStatus = {
  configured: boolean;
  requestId: string | null;
  candidateSalesRequestId?: string | null;
  analysisAsOf?: string | null;
  planningContentFingerprint?: string | null;
  candidateEventFingerprint?: string | null;
  candidatePlanFingerprint?: string | null;
  state: "IDLE" | "QUEUED" | "RUNNING" | "MATCH" | "MISMATCH" | "FAILED";
  stage: string;
  message: string;
  completedRanges: number;
  totalRanges: number;
  progress: number;
  report: CandidateDemandParityReport | null;
  blockerCount: number;
  error: string | null;
};

type OperationRow = {
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

type FailureSnapshot = {
  stageKey?: unknown;
  attempt?: unknown;
  message?: unknown;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function numeric(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function integer(value: unknown) {
  return Math.max(0, Math.round(numeric(value)));
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

function rangeKey(range: ShoplingDateRange) {
  return `${range.start}:${range.end}`;
}

function salesCorrelationId(requestId: string) {
  return `product-master-sales-events:${requestId}`;
}

function parityCorrelationId(requestId: string) {
  return `stage8-candidate-demand-parity:${requestId}`;
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

export function candidateDemandParityConfigured() {
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
          source: "stage8-candidate-demand-parity",
          source_event_id: input.sourceEventId,
          correlation_id: input.correlationId,
          actor_type:
            input.operationType === CANDIDATE_PARITY_REQUEST
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
      `CANDIDATE_DEMAND_PARITY_STORE_FAILED:${response.status}:${body.slice(0, 400)}`,
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
    .select(
      "source_event_id,correlation_id,status,input_snapshot,result_snapshot,error_message,started_at",
    )
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

function salesRequestFromRow(row: OperationRow): SalesEventSyncRequest | null {
  const value = object(row.input_snapshot);
  const requestId = text(value.requestId);
  const analysisAsOf = iso(value.analysisAsOf);
  const planningGeneratedAt = iso(value.planningGeneratedAt);
  const planningContentFingerprint = text(value.planningContentFingerprint);
  const ranges = parseRanges(value.ranges);
  if (
    !requestId ||
    !analysisAsOf ||
    !planningGeneratedAt ||
    !/^sha256:[a-f0-9]{64}$/.test(planningContentFingerprint) ||
    !ranges.length
  ) return null;
  return {
    requestId,
    analysisAsOf,
    analysisStartDate: text(value.analysisStartDate),
    analysisEndDate: text(value.analysisEndDate),
    planningGeneratedAt,
    planningContentFingerprint,
    ranges,
    createdAt: iso(value.createdAt) || analysisAsOf,
  };
}

function salesChunkFromRow(row: OperationRow): ProductMasterShoplingSalesEventChunk | null {
  const value = object(row.result_snapshot);
  return value.range && Array.isArray(value.events)
    ? (value as unknown as ProductMasterShoplingSalesEventChunk)
    : null;
}

function salesReportFromRow(row: OperationRow): SalesEventSyncReport | null {
  const value = object(row.result_snapshot);
  return /^sha256:[a-f0-9]{64}$/.test(text(value.planFingerprint))
    ? (value as unknown as SalesEventSyncReport)
    : null;
}

function candidateEventFingerprint(events: ProductMasterSalesEventRow[]) {
  const normalized = events.map((row) => ({
    externalId: row.externalId,
    barcode: row.barcode,
    occurredAt: row.occurredAt,
    quantity: row.quantity,
    revenue: row.revenue,
    validSale: row.validSale,
  }));
  return `sha256:${createHash("sha256").update(JSON.stringify(normalized)).digest("hex")}`;
}

function candidatePlanFingerprint(
  request: SalesEventSyncRequest,
  eventFingerprint: string,
) {
  return `sha256:${createHash("sha256")
    .update(
      JSON.stringify({
        planningContentFingerprint: request.planningContentFingerprint,
        analysisAsOf: request.analysisAsOf,
        eventFingerprint,
      }),
    )
    .digest("hex")}`;
}

export async function loadLatestCandidateSalesSnapshot(): Promise<CandidateSalesSnapshot> {
  const requestRows = await readOperations(SALES_EVENT_REQUEST, undefined, 20);
  let request: SalesEventSyncRequest | null = null;
  for (const row of requestRows) {
    request = salesRequestFromRow(row);
    if (request) break;
  }
  if (!request) throw new Error("CANDIDATE_SALES_REQUEST_REQUIRED");

  const correlationId = salesCorrelationId(request.requestId);
  const [chunkRows, reportRows] = await Promise.all([
    readOperations(SALES_EVENT_CHUNK, correlationId),
    readOperations(SALES_EVENT_REPORT, correlationId, 10),
  ]);
  const chunks = chunkRows.map(salesChunkFromRow).filter(Boolean) as ProductMasterShoplingSalesEventChunk[];
  const completed = new Set(chunks.map((chunk) => rangeKey(chunk.range))).size;
  if (completed !== request.ranges.length) {
    throw new Error(`CANDIDATE_SALES_COLLECTION_INCOMPLETE:${completed}:${request.ranges.length}`);
  }
  const storedReport = reportRows.map(salesReportFromRow).find(Boolean);
  if (!storedReport) throw new Error("CANDIDATE_SALES_REPORT_REQUIRED");
  if (storedReport.unmappedRows || storedReport.identityConflictCount) {
    throw new Error(
      `CANDIDATE_SALES_BLOCKED:${storedReport.unmappedRows}:${storedReport.identityConflictCount}`,
    );
  }

  const combined = combineProductMasterShoplingSalesEventChunks(chunks);
  const eventFingerprint = candidateEventFingerprint(combined.events);
  const planFingerprint = candidatePlanFingerprint(request, eventFingerprint);
  if (
    eventFingerprint !== storedReport.eventFingerprint ||
    planFingerprint !== storedReport.planFingerprint ||
    combined.eventRows !== storedReport.sourceEventCount ||
    combined.validRows !== storedReport.validEventCount ||
    combined.tombstoneRows !== storedReport.tombstoneCount
  ) {
    throw new Error("CANDIDATE_SALES_REPORT_REBUILD_MISMATCH");
  }
  return {
    salesRequestId: request.requestId,
    analysisAsOf: request.analysisAsOf,
    planningContentFingerprint: request.planningContentFingerprint,
    eventFingerprint,
    planFingerprint,
    report: storedReport,
    events: combined.events,
  };
}

function parityRequestFromRow(row: OperationRow): CandidateDemandParityRequest | null {
  const value = object(row.input_snapshot);
  const requestId = text(value.requestId);
  const candidateSalesRequestId = text(value.candidateSalesRequestId);
  const analysisAsOf = iso(value.analysisAsOf);
  const planningGeneratedAt = iso(value.planningGeneratedAt);
  const planningContentFingerprint = text(value.planningContentFingerprint);
  const candidateEventFingerprint = text(value.candidateEventFingerprint);
  const candidatePlanFingerprint = text(value.candidatePlanFingerprint);
  const ranges = parseRanges(value.ranges);
  if (
    !requestId ||
    !candidateSalesRequestId ||
    !analysisAsOf ||
    !planningGeneratedAt ||
    !/^sha256:[a-f0-9]{64}$/.test(planningContentFingerprint) ||
    !/^sha256:[a-f0-9]{64}$/.test(candidateEventFingerprint) ||
    !/^sha256:[a-f0-9]{64}$/.test(candidatePlanFingerprint) ||
    !ranges.length
  ) return null;
  return {
    requestId,
    candidateSalesRequestId,
    analysisAsOf,
    analysisStartDate: text(value.analysisStartDate),
    analysisEndDate: text(value.analysisEndDate),
    planningGeneratedAt,
    planningContentFingerprint,
    candidateEventFingerprint,
    candidatePlanFingerprint,
    ranges,
    createdAt: iso(value.createdAt) || analysisAsOf,
  };
}

function orderChunkFromRow(row: OperationRow): ShoplingOrderChunkSummary | null {
  const value = object(row.result_snapshot);
  return value.range && Array.isArray(value.products)
    ? (value as unknown as ShoplingOrderChunkSummary)
    : null;
}

function parityReportFromRow(row: OperationRow): CandidateDemandParityReport | null {
  const value = object(row.result_snapshot);
  return /^sha256:[a-f0-9]{64}$/.test(text(value.parityFingerprint))
    ? (value as unknown as CandidateDemandParityReport)
    : null;
}

async function latestParityRequest() {
  const rows = await readOperations(CANDIDATE_PARITY_REQUEST, undefined, 20);
  for (const row of rows) {
    const request = parityRequestFromRow(row);
    if (request) return request;
  }
  return null;
}

async function parityOperations(request: CandidateDemandParityRequest) {
  const correlationId = parityCorrelationId(request.requestId);
  const [orders, failures, terminals, reports] = await Promise.all([
    readOperations(CANDIDATE_PARITY_ORDER_CHUNK, correlationId),
    readOperations(CANDIDATE_PARITY_STEP_FAILURE, correlationId),
    readOperations(CANDIDATE_PARITY_FAILED, correlationId, 10),
    readOperations(CANDIDATE_PARITY_REPORT, correlationId, 10),
  ]);
  return { correlationId, orders, failures, terminals, reports };
}

function operationRangeKey(row: OperationRow) {
  const input = object(row.input_snapshot);
  const range = object(input.range);
  return range.start && range.end
    ? `${text(range.start)}:${text(range.end)}`
    : text(input.rangeKey);
}

function stageFailureCount(rows: OperationRow[], stageKey: string) {
  return rows.filter((row) => {
    const value = object(row.result_snapshot) as FailureSnapshot;
    return text(value.stageKey) === stageKey;
  }).length;
}

async function storeStepFailure(
  request: CandidateDemandParityRequest,
  stageKey: string,
  attempt: number,
  error: unknown,
) {
  const message = safeMessage(error);
  await storeOperation({
    operationType: CANDIDATE_PARITY_STEP_FAILURE,
    sourceEventId: `candidate-demand-parity-step-failure:${request.requestId}:${encodeURIComponent(stageKey)}:${attempt}`,
    correlationId: parityCorrelationId(request.requestId),
    status: "FAILED",
    inputSnapshot: { requestId: request.requestId, stageKey, attempt },
    resultSnapshot: { requestId: request.requestId, stageKey, attempt, message },
    errorMessage: message,
  });
  return message;
}

async function storeTerminalFailure(
  request: CandidateDemandParityRequest,
  stageKey: string,
  message: string,
) {
  await storeOperation({
    operationType: CANDIDATE_PARITY_FAILED,
    sourceEventId: `candidate-demand-parity-failed:${request.requestId}`,
    correlationId: parityCorrelationId(request.requestId),
    status: "FAILED",
    inputSnapshot: { requestId: request.requestId, stageKey },
    resultSnapshot: { requestId: request.requestId, stageKey, message },
    errorMessage: message,
  });
}

function emptyBuckets() {
  return Array.from({ length: BUCKET_COUNT }, () => 0);
}

function bucketIndex(occurredAt: string, analysisAsOf: string) {
  const timestamp = Date.parse(occurredAt);
  const end = Date.parse(analysisAsOf);
  if (!Number.isFinite(timestamp) || !Number.isFinite(end)) return -1;
  const age = end - timestamp;
  const span = BUCKET_COUNT * BUCKET_DAYS * DAY_MS;
  if (age < 0 || age >= span) return -1;
  return Math.floor(age / (BUCKET_DAYS * DAY_MS));
}

export function buildCandidateRollingRows(
  planning: ProductPlanningSnapshot,
  events: ProductMasterSalesEventRow[],
  analysisAsOf: string,
) {
  const byBarcode = new Map<string, CandidateRollingSalesRow>();
  for (const product of planning.products ?? []) {
    const barcode = text(product.barcode).toUpperCase();
    if (!MANAGED_BARCODE.test(barcode) || product.skuActive === false) continue;
    if (byBarcode.has(barcode)) {
      byBarcode.delete(barcode);
      continue;
    }
    byBarcode.set(barcode, {
      barcode,
      monthlyUnits: emptyBuckets(),
      monthlyRevenue: emptyBuckets(),
      validEventCount: 0,
    });
  }
  for (const event of events) {
    if (!event.validSale) continue;
    const row = byBarcode.get(text(event.barcode).toUpperCase());
    if (!row) continue;
    const bucket = bucketIndex(event.occurredAt, analysisAsOf);
    if (bucket < 0) continue;
    row.monthlyUnits[bucket] += integer(event.quantity);
    row.monthlyRevenue[bucket] += integer(event.revenue);
    row.validEventCount += 1;
  }
  return [...byBarcode.values()].sort((left, right) =>
    left.barcode.localeCompare(right.barcode),
  );
}

function arraysEqual(left: number[], right: number[]) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => integer(value) === integer(right[index]));
}

function differingBuckets(left: number[], right: number[]) {
  const output: number[] = [];
  for (let index = 0; index < BUCKET_COUNT; index += 1) {
    if (integer(left[index]) !== integer(right[index])) output.push(index);
  }
  return output;
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + integer(value), 0);
}

function parityFingerprint(report: Omit<CandidateDemandParityReport, "parityFingerprint">) {
  const stable = {
    analysisAsOf: report.analysisAsOf,
    candidateSalesRequestId: report.candidateSalesRequestId,
    planningContentFingerprint: report.planningContentFingerprint,
    candidateEventFingerprint: report.candidateEventFingerprint,
    candidatePlanFingerprint: report.candidatePlanFingerprint,
    candidateRowCount: report.candidateRowCount,
    directManagedRowCount: report.directManagedRowCount,
    exactRowCount: report.exactRowCount,
    unitMismatchCount: report.unitMismatchCount,
    revenueMismatchCount: report.revenueMismatchCount,
    missingDirectBarcodes: report.missingDirectBarcodes,
    directOnlyManagedBarcodes: report.directOnlyManagedBarcodes,
    candidateManagedUnits: report.candidateManagedUnits,
    directManagedUnits: report.directManagedUnits,
    candidateManagedRevenue: report.candidateManagedRevenue,
    directManagedRevenue: report.directManagedRevenue,
    mismatchSamples: report.mismatchSamples,
  };
  return `sha256:${createHash("sha256").update(JSON.stringify(stable)).digest("hex")}`;
}

export function compareCandidateDemandWithDirectShopling(
  request: CandidateDemandParityRequest,
  planning: ProductPlanningSnapshot,
  candidateEvents: ProductMasterSalesEventRow[],
  orderChunks: ShoplingOrderChunkSummary[],
): CandidateDemandParityReport {
  const candidateRows = buildCandidateRollingRows(
    planning,
    candidateEvents,
    request.analysisAsOf,
  );
  const direct = combineShoplingLiveChunks(
    planning,
    orderChunks,
    [],
    request.analysisAsOf,
  );
  const directManaged = direct.products.filter((row) =>
    MANAGED_BARCODE.test(text(row.planning.barcode).toUpperCase()),
  );
  const directByBarcode = new Map(
    directManaged.map((row) => [text(row.planning.barcode).toUpperCase(), row]),
  );
  const candidateByBarcode = new Map(
    candidateRows.map((row) => [row.barcode, row]),
  );

  let sharedRowCount = 0;
  let exactRowCount = 0;
  let unitMismatchCount = 0;
  let revenueMismatchCount = 0;
  const missingDirectBarcodes: string[] = [];
  const mismatchSamples: CandidateDemandParityMismatch[] = [];

  for (const candidateRow of candidateRows) {
    const directRow = directByBarcode.get(candidateRow.barcode);
    if (!directRow) {
      missingDirectBarcodes.push(candidateRow.barcode);
      continue;
    }
    sharedRowCount += 1;
    const unitMatch = arraysEqual(candidateRow.monthlyUnits, directRow.units);
    const revenueMatch = arraysEqual(candidateRow.monthlyRevenue, directRow.revenue);
    if (!unitMatch) unitMismatchCount += 1;
    if (!revenueMatch) revenueMismatchCount += 1;
    if (unitMatch && revenueMatch) {
      exactRowCount += 1;
      continue;
    }
    if (mismatchSamples.length < MAX_MISMATCH_SAMPLES) {
      mismatchSamples.push({
        barcode: candidateRow.barcode,
        unitBuckets: differingBuckets(candidateRow.monthlyUnits, directRow.units),
        revenueBuckets: differingBuckets(candidateRow.monthlyRevenue, directRow.revenue),
        candidateUnits: candidateRow.monthlyUnits.map(integer),
        directUnits: directRow.units.map(integer),
        candidateRevenue: candidateRow.monthlyRevenue.map(integer),
        directRevenue: directRow.revenue.map(integer),
      });
    }
  }

  const directOnlyManagedBarcodes = [...directByBarcode.keys()]
    .filter((barcode) => !candidateByBarcode.has(barcode))
    .sort();
  const candidateManagedUnits = candidateRows.reduce(
    (total, row) => total + sum(row.monthlyUnits),
    0,
  );
  const candidateManagedRevenue = candidateRows.reduce(
    (total, row) => total + sum(row.monthlyRevenue),
    0,
  );
  const directManagedUnits = directManaged.reduce(
    (total, row) => total + sum(row.units),
    0,
  );
  const directManagedRevenue = directManaged.reduce(
    (total, row) => total + sum(row.revenue),
    0,
  );
  const directFetchedRows = orderChunks.reduce(
    (total, chunk) => total + integer(chunk.fetchedRows),
    0,
  );
  const directAcceptedRows = orderChunks.reduce(
    (total, chunk) => total + integer(chunk.acceptedRows),
    0,
  );
  const directUnmappedRows = orderChunks.reduce(
    (total, chunk) => total + integer(chunk.unmappedRows),
    0,
  );
  const blockerCount =
    unitMismatchCount +
    revenueMismatchCount +
    missingDirectBarcodes.length +
    directOnlyManagedBarcodes.length;

  const base: Omit<CandidateDemandParityReport, "parityFingerprint"> = {
    generatedAt: new Date().toISOString(),
    analysisAsOf: request.analysisAsOf,
    candidateSalesRequestId: request.candidateSalesRequestId,
    planningContentFingerprint: request.planningContentFingerprint,
    candidateEventFingerprint: request.candidateEventFingerprint,
    candidatePlanFingerprint: request.candidatePlanFingerprint,
    candidateRowCount: candidateRows.length,
    directManagedRowCount: directManaged.length,
    sharedRowCount,
    exactRowCount,
    unitMismatchCount,
    revenueMismatchCount,
    missingDirectCount: missingDirectBarcodes.length,
    directOnlyManagedCount: directOnlyManagedBarcodes.length,
    directFetchedRows,
    directAcceptedRows,
    directUnmappedRows,
    candidateManagedUnits,
    directManagedUnits,
    candidateManagedRevenue,
    directManagedRevenue,
    candidateMinusDirectUnits: candidateManagedUnits - directManagedUnits,
    candidateMinusDirectRevenue: candidateManagedRevenue - directManagedRevenue,
    mismatchSamples,
    missingDirectBarcodes,
    directOnlyManagedBarcodes,
    blockerCount,
  };
  return { ...base, parityFingerprint: parityFingerprint(base) };
}

async function verifiedPlanning(request: CandidateDemandParityRequest) {
  const planning = await loadProductPlanningSnapshot();
  if (planning.contentFingerprint !== request.planningContentFingerprint) {
    throw new Error("CANDIDATE_DEMAND_PARITY_PLANNING_CHANGED");
  }
  return planning;
}

async function verifiedCandidate(request: CandidateDemandParityRequest) {
  const candidate = await loadLatestCandidateSalesSnapshot();
  if (candidate.salesRequestId !== request.candidateSalesRequestId) {
    throw new Error("CANDIDATE_DEMAND_PARITY_SALES_REQUEST_CHANGED");
  }
  if (candidate.analysisAsOf !== request.analysisAsOf) {
    throw new Error("CANDIDATE_DEMAND_PARITY_ANALYSIS_TIME_CHANGED");
  }
  if (
    candidate.eventFingerprint !== request.candidateEventFingerprint ||
    candidate.planFingerprint !== request.candidatePlanFingerprint
  ) {
    throw new Error("CANDIDATE_DEMAND_PARITY_CANDIDATE_CHANGED");
  }
  return candidate;
}

export async function createCandidateDemandParityRequest() {
  shoplingReadConfigFromEnv(shoplingEnvironment());
  const [planning, candidate] = await Promise.all([
    loadProductPlanningSnapshot(),
    loadLatestCandidateSalesSnapshot(),
  ]);
  if (planning.contentFingerprint !== candidate.planningContentFingerprint) {
    throw new Error("CANDIDATE_DEMAND_PARITY_PLANNING_CHANGED");
  }
  const asOf = new Date(candidate.analysisAsOf);
  const start = new Date(asOf.valueOf() - BUCKET_COUNT * BUCKET_DAYS * DAY_MS);
  const request: CandidateDemandParityRequest = {
    requestId: crypto.randomUUID(),
    candidateSalesRequestId: candidate.salesRequestId,
    analysisAsOf: asOf.toISOString(),
    analysisStartDate: dateOnly(start),
    analysisEndDate: dateOnly(asOf),
    planningGeneratedAt: planning.generatedAt,
    planningContentFingerprint: planning.contentFingerprint,
    candidateEventFingerprint: candidate.eventFingerprint,
    candidatePlanFingerprint: candidate.planFingerprint,
    ranges: splitShoplingDateRange(dateOnly(start), dateOnly(asOf), RANGE_DAYS),
    createdAt: new Date().toISOString(),
  };
  await storeOperation({
    operationType: CANDIDATE_PARITY_REQUEST,
    sourceEventId: `candidate-demand-parity-request:${request.requestId}`,
    correlationId: parityCorrelationId(request.requestId),
    inputSnapshot: request,
    resultSnapshot: {
      accepted: true,
      state: "QUEUED",
      message:
        "Product Master에 쓰기 전 canonical 후보 판매 이벤트와 같은 시점 Shopling 직접 집계를 비교합니다.",
    },
    occurredAt: request.createdAt,
  });
  return request;
}

export async function runCandidateDemandParityStep() {
  const request = await latestParityRequest();
  if (!request) return { processed: false, state: "IDLE" as const };
  const operations = await parityOperations(request);
  const priorReport = operations.reports.map(parityReportFromRow).find(Boolean) ?? null;
  if (priorReport) {
    return {
      processed: false,
      state: priorReport.blockerCount ? ("MISMATCH" as const) : ("MATCH" as const),
      requestId: request.requestId,
    };
  }
  if (operations.terminals.length) {
    return {
      processed: false,
      state: "FAILED" as const,
      requestId: request.requestId,
      message: safeMessage(
        operations.terminals[0].error_message ||
          object(operations.terminals[0].result_snapshot).message,
      ),
    };
  }

  let planning: ProductPlanningSnapshot;
  try {
    planning = await verifiedPlanning(request);
  } catch (error) {
    const message = await storeStepFailure(request, "planning", 1, error);
    await storeTerminalFailure(request, "planning", message);
    return { processed: true, state: "FAILED" as const, requestId: request.requestId, message };
  }

  const completed = new Set(operations.orders.map(operationRangeKey));
  const nextRange = request.ranges.find((range) => !completed.has(rangeKey(range)));
  if (nextRange) {
    const stageKey = `orders:${rangeKey(nextRange)}`;
    const attempt = stageFailureCount(operations.failures, stageKey) + 1;
    if (attempt > MAX_STEP_ATTEMPTS) {
      const message = `CANDIDATE_DEMAND_PARITY_RETRY_EXHAUSTED:${rangeKey(nextRange)}`;
      await storeTerminalFailure(request, stageKey, message);
      return { processed: true, state: "FAILED" as const, requestId: request.requestId, message };
    }
    try {
      const raw = await new ShoplingReadClient(
        shoplingReadConfigFromEnv(shoplingEnvironment()),
      ).read("orders", nextRange);
      const summary = aggregateShoplingOrderChunk(
        raw,
        planning,
        request.analysisAsOf,
        nextRange,
      );
      await storeOperation({
        operationType: CANDIDATE_PARITY_ORDER_CHUNK,
        sourceEventId: `candidate-demand-parity-order:${request.requestId}:${rangeKey(nextRange)}`,
        correlationId: parityCorrelationId(request.requestId),
        inputSnapshot: {
          requestId: request.requestId,
          range: nextRange,
          rangeKey: rangeKey(nextRange),
          analysisAsOf: request.analysisAsOf,
          planningContentFingerprint: request.planningContentFingerprint,
          candidateEventFingerprint: request.candidateEventFingerprint,
        },
        resultSnapshot: summary,
      });
      return {
        processed: true,
        state: "RUNNING" as const,
        requestId: request.requestId,
        range: nextRange,
        fetchedRows: summary.fetchedRows,
        acceptedRows: summary.acceptedRows,
        unmappedRows: summary.unmappedRows,
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

  try {
    const candidate = await verifiedCandidate(request);
    const chunks = operations.orders
      .map(orderChunkFromRow)
      .filter(Boolean) as ShoplingOrderChunkSummary[];
    const report = compareCandidateDemandWithDirectShopling(
      request,
      planning,
      candidate.events,
      chunks,
    );
    await storeOperation({
      operationType: CANDIDATE_PARITY_REPORT,
      sourceEventId: `candidate-demand-parity-report:${request.requestId}`,
      correlationId: parityCorrelationId(request.requestId),
      inputSnapshot: {
        requestId: request.requestId,
        candidateSalesRequestId: request.candidateSalesRequestId,
        analysisAsOf: request.analysisAsOf,
        candidateEventFingerprint: request.candidateEventFingerprint,
        candidatePlanFingerprint: request.candidatePlanFingerprint,
      },
      resultSnapshot: report,
    });
    return {
      processed: true,
      state: report.blockerCount ? ("MISMATCH" as const) : ("MATCH" as const),
      requestId: request.requestId,
      report,
    };
  } catch (error) {
    const message = await storeStepFailure(request, "final", 1, error);
    await storeTerminalFailure(request, "final", message);
    return { processed: true, state: "FAILED" as const, requestId: request.requestId, message };
  }
}

export async function loadCandidateDemandParityStatus(): Promise<CandidateDemandParityStatus> {
  const configured = candidateDemandParityConfigured();
  const request = await latestParityRequest();
  const empty: CandidateDemandParityStatus = {
    configured,
    requestId: null,
    state: "IDLE",
    stage: "대기",
    message: "아직 Product Master 쓰기 전 canonical 후보 수요 비교를 시작하지 않았습니다.",
    completedRanges: 0,
    totalRanges: 0,
    progress: 0,
    report: null,
    blockerCount: 0,
    error: null,
  };
  if (!request) return empty;
  const operations = await parityOperations(request);
  const completedRanges = new Set(operations.orders.map(operationRangeKey)).size;
  const report = operations.reports.map(parityReportFromRow).find(Boolean) ?? null;
  const common = {
    ...empty,
    requestId: request.requestId,
    candidateSalesRequestId: request.candidateSalesRequestId,
    analysisAsOf: request.analysisAsOf,
    planningContentFingerprint: request.planningContentFingerprint,
    candidateEventFingerprint: request.candidateEventFingerprint,
    candidatePlanFingerprint: request.candidatePlanFingerprint,
    completedRanges,
    totalRanges: request.ranges.length,
    progress: Math.min(100, Math.round((completedRanges / request.ranges.length) * 100)),
    report,
  };
  if (operations.terminals.length) {
    const error = safeMessage(
      operations.terminals[0].error_message ||
        object(operations.terminals[0].result_snapshot).message,
    );
    return { ...common, state: "FAILED", stage: "후보 수요 비교 실패", message: error, error };
  }
  if (report) {
    const match = report.blockerCount === 0;
    return {
      ...common,
      state: match ? "MATCH" : "MISMATCH",
      stage: match ? "쓰기 전 후보수요 완전일치" : "쓰기 전 후보수요 차이 검토",
      message: match
        ? `활성 관리 SKU ${report.exactRowCount}개의 12×30일 수량·매출이 같은 시점 Shopling 직접 집계와 완전히 일치합니다.`
        : `쓰기 전 후보에서 ${report.blockerCount}개 차단 신호가 남았습니다. Product Master에 쓰지 않고 차이를 검토합니다.`,
      progress: 100,
      blockerCount: report.blockerCount,
    };
  }
  return {
    ...common,
    state: completedRanges ? "RUNNING" : "QUEUED",
    stage: completedRanges ? "동일시점 Shopling 재집계" : "Worker 대기",
    message: `${completedRanges}/${request.ranges.length}개 구간을 읽었습니다. Product Master 판매원장은 변경하지 않습니다.`,
  };
}
