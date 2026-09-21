import {
  SHOPLING_STOCK_STATUS_SYNC_OPERATION_TYPE,
  loadInventoryStockControlReport,
  normalizeShoplingStockSyncInput,
  storeInventoryOperation,
  type ExactInventoryAfterReset,
  type InventoryStockControlReport,
} from "@/lib/inventoryStockControl";
import { overlayInventoryStockControlReportWithResetCorrections } from "@/lib/inventoryStockResetCorrections";
import {
  loadLatestInventoryStockSalesTailSnapshots,
  overlayInventoryStockControlReportWithTail,
} from "@/lib/inventoryStockSalesTail";
import { ensureExactInventoryStockSalesTailCoverage } from "@/lib/inventoryStockSalesTailCoverage";
import { normalizeRetryableShoplingSyncReportWithEvidence } from "@/lib/inventoryStockSyncResolution";
import { overlayInventoryStockControlReportWithStocktakeBaselines } from "@/lib/inventoryStocktakeBaselines";
import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";
import { loadProductMasterVerifiedZeroResetEvents } from "@/lib/productMasterVerifiedInventoryBaselines";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { withInventoryReadGuard } from "@/lib/inventoryStockReadGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const SHOPLING_STOCK_CANARY_PREPARATION_OPERATION_TYPE =
  "SHOPLING_STOCK_CANARY_PREPARATION";
const CANONICAL_COVERAGE_BLOCK_REASON =
  "품절 초기화 이후의 Canonical 판매 범위를 완전히 확인하지 못했습니다.";
const INVENTORY_QUEUE_MODE_HEADER = "x-commerce-os-inventory-queue-mode";

type QueueMode = "observe" | "execute";

function unauthorized() {
  return Response.json(
    {
      ok: false,
      code: "SHOPLING_STOCK_SYNC_UNAUTHORIZED",
      message: "Shopling 재고상태 동기화 기록 권한이 필요합니다.",
    },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function normalizedBarcode(value: unknown) {
  return text(value)
    .toUpperCase()
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/\s+/g, "");
}

function numericGoodsKey(value: unknown) {
  const normalized = text(value);
  return /^\d+$/.test(normalized) ? normalized : "";
}

function truthy(value: unknown) {
  return value === true || text(value).toLowerCase() === "true";
}

function queueMode(request: Request): QueueMode {
  const requested = text(
    request.headers.get(INVENTORY_QUEUE_MODE_HEADER) ||
      new URL(request.url).searchParams.get("mode"),
  ).toLowerCase();
  return requested === "observe" ? "observe" : "execute";
}

function confirmedPreparationEvidence(
  input: Record<string, unknown>,
  output: Record<string, unknown>,
) {
  return Boolean(
    truthy(input.preparationOnly) &&
      text(output.state).toUpperCase() === "A6_UNIQUENESS_CONFIRMED" &&
      Number(output.a6SearchResultCount) === 1 &&
      text(output.externalBarcodeCollisionCheck).toUpperCase() ===
        "EXACT_ONE_ROW_CONFIRMED",
  );
}

async function loadPreparedGoodsKeysByBarcode() {
  const result = new Map<string, Set<string>>();
  const admin = await createSupabaseAdminClient();
  if (!admin) return result;
  const response = await admin
    .from("commerce_operation_runs")
    .select("status,input_snapshot,result_snapshot,started_at")
    .eq("operation_type", SHOPLING_STOCK_CANARY_PREPARATION_OPERATION_TYPE)
    .order("started_at", { ascending: true })
    .limit(2_000);
  if (response.error) return result;

  const preparedRows = Array.isArray(response.data)
    ? (response.data as Array<Record<string, unknown>>)
    : [];
  for (const row of preparedRows) {
    const input = object(row.input_snapshot);
    const outputRoot = object(row.result_snapshot);
    const nestedOutput = object(outputRoot.snapshot);
    const output = Object.keys(nestedOutput).length ? nestedOutput : outputRoot;
    if (!confirmedPreparationEvidence(input, output)) continue;

    const barcode = normalizedBarcode(input.barcode || output.barcode);
    if (!barcode) continue;
    const candidates = [
      input.goodsKey,
      input.shoplingGoodsKey,
      input.shoplingProductId,
      output.goodsKey,
      output.shoplingGoodsKey,
      output.shoplingProductId,
      output.a6MatchedShoplingProductId,
    ]
      .map(numericGoodsKey)
      .filter(Boolean);
    if (!candidates.length) continue;
    const values = result.get(barcode) ?? new Set<string>();
    for (const candidate of candidates) values.add(candidate);
    result.set(barcode, values);
  }
  return result;
}

async function loadCorrectedReport() {
  // The purchase-cycle status and the operational Shopling queue must consume
  // the same user-backed physical-zero evidence. Product Master contributes
  // only strict VERIFIED SOLD_OUT_RESET=0 events, and its helper fails soft to
  // an empty list. The canonical inventory ledger then recomputes receipts and
  // sales from that reset before any Shopling job can become executable.
  const supplementalResetEvents =
    await loadProductMasterVerifiedZeroResetEvents();
  const seeded = await overlayInventoryStockControlReportWithStocktakeBaselines(
    await loadInventoryStockControlReport({ supplementalResetEvents }),
  );
  const tailed = await overlayInventoryStockControlReportWithTail(seeded);
  const corrected =
    await overlayInventoryStockControlReportWithResetCorrections(tailed);
  return overlayInventoryStockControlReportWithStocktakeBaselines(corrected);
}

async function loadRetryableReport({
  refreshTail = false,
}: {
  refreshTail?: boolean;
} = {}) {
  let report = await loadCorrectedReport();
  let tailSalesRefresh: Awaited<
    ReturnType<typeof ensureExactInventoryStockSalesTailCoverage>
  > | null = null;

  // The operational queue polls this GET endpoint every 30 seconds. Polling must
  // remain read-only; otherwise every stale check appends a Tail snapshot to the
  // operation ledger. Refresh Tail coverage only after a real state-changing POST
  // or through the explicit overview preflight used by an execution read.
  if (refreshTail) {
    tailSalesRefresh = await ensureExactInventoryStockSalesTailCoverage(report);
    if (tailSalesRefresh.refreshed) {
      report = await loadCorrectedReport();
    }
  }

  return {
    report: await normalizeRetryableShoplingSyncReportWithEvidence(report),
    tailSalesRefresh,
  };
}

async function loadObserveRevalidationBarcodes(
  report: InventoryStockControlReport,
) {
  const candidates = report.rows.filter(
    (row) =>
      row.syncNeeded &&
      row.syncBlocked &&
      row.syncBlockReason === CANONICAL_COVERAGE_BLOCK_REASON,
  );
  if (!candidates.length) return new Set<string>();

  // Observe mode may keep a previously verified approval candidate visible after
  // the short Tail presentation TTL expires. This evidence is NEVER executable:
  // the browser uses a separate fresh execute read immediately before Shopling send.
  const snapshots = await loadLatestInventoryStockSalesTailSnapshots().catch(
    () => new Map(),
  );
  const eligible = new Set<string>();
  for (const row of candidates) {
    const snapshot = snapshots.get(row.resetEventId);
    if (
      !snapshot ||
      snapshot.barcode !== row.barcode ||
      snapshot.resetAt !== row.resetAt
    ) {
      continue;
    }
    const resetMs = Date.parse(row.resetAt);
    const startMs = Date.parse(snapshot.coverageStartAt);
    const endMs = Date.parse(snapshot.coverageEndAt);
    if (
      Number.isFinite(resetMs) &&
      Number.isFinite(startMs) &&
      Number.isFinite(endMs) &&
      startMs <= resetMs &&
      endMs >= resetMs
    ) {
      eligible.add(row.barcode);
    }
  }
  return eligible;
}

function observePresentationReport(
  report: InventoryStockControlReport,
  revalidationBarcodes: Set<string>,
): InventoryStockControlReport {
  if (!revalidationBarcodes.size) return report;
  const rows = report.rows.map((row) => {
    const visibleForApproval =
      revalidationBarcodes.has(row.barcode) &&
      row.syncNeeded &&
      row.syncBlocked &&
      row.syncBlockReason === CANONICAL_COVERAGE_BLOCK_REASON;
    return visibleForApproval
      ? { ...row, syncBlocked: false, syncBlockReason: null }
      : row;
  });
  return {
    ...report,
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

function queueJob(
  row: ExactInventoryAfterReset,
  preparedGoodsKeysByBarcode: Map<string, Set<string>>,
) {
  const goodsKeys = [
    ...new Set([
      ...row.goodsKeys,
      ...(preparedGoodsKeysByBarcode.get(row.barcode) ?? []),
    ]),
  ].sort((left, right) => Number(left) - Number(right));
  return {
    jobId: `stock-sync:${row.barcode}:${row.desiredStatus}:${row.desiredSince}`,
    barcode: row.barcode,
    productName: row.productName,
    productKind: row.productKind,
    modelNo: row.modelNo,
    goodsKeys,
    desiredStatus: row.desiredStatus,
    desiredSince: row.desiredSince,
    exactInventoryQuantity: row.exactInventoryQuantity,
    resetAt: row.resetAt,
    route:
      row.productKind === "OPTION"
        ? ["SHOPLING_API_OPTION_STATUS", "A21_GOODS_KEY_OPTION_SEND"]
        : ["A4_PRODUCT_STATUS", "A21_GOODS_KEY_PRODUCT_SALE_STATUS"],
  };
}

export async function GET(request: Request) {
  if (!isSameOriginOpsRequest(request)) return unauthorized();
  return withInventoryReadGuard("queue", async () => {
    const mode = queueMode(request);
    const [{ report: authoritativeReport, tailSalesRefresh }, preparedGoodsKeysByBarcode] =
      await Promise.all([loadRetryableReport(), loadPreparedGoodsKeysByBarcode()]);
    const revalidationBarcodes =
      mode === "observe" && authoritativeReport.state === "READY"
        ? await loadObserveRevalidationBarcodes(authoritativeReport)
        : new Set<string>();
    const report =
      mode === "observe"
        ? observePresentationReport(authoritativeReport, revalidationBarcodes)
        : authoritativeReport;

    // Execute mode is fail-closed and only returns currently authoritative jobs.
    // Observe mode may additionally show a stale-Tail approval candidate, but the
    // client never sends it directly: pressing auto-process performs a fresh
    // overview/Tail preflight and then calls this endpoint in execute mode again.
    const queueRows = authoritativeReport.rows.filter(
      (row) =>
        row.syncNeeded &&
        (!row.syncBlocked ||
          (mode === "observe" && revalidationBarcodes.has(row.barcode))),
    );
    const jobs = [
      ...new Map(
        queueRows.map((row) => {
          const job = queueJob(row, preparedGoodsKeysByBarcode);
          return [job.jobId, job] as const;
        }),
      ).values(),
    ];

    return Response.json(
      {
        ok: report.state === "READY",
        report,
        tailSalesRefresh,
        jobs,
        queueMode: mode,
        executionRevalidationRequiredCount:
          mode === "observe" ? revalidationBarcodes.size : 0,
      },
      {
        status: report.state === "READY" ? 200 : 503,
        headers: { "cache-control": "no-store" },
      },
    );
  });
}

export async function POST(request: Request) {
  if (!isSameOriginOpsRequest(request)) return unauthorized();
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const event = normalizeShoplingStockSyncInput({
      eventId: body.eventId,
      jobId: body.jobId,
      barcode: body.barcode,
      productKind: body.productKind,
      modelNo: body.modelNo,
      desiredStatus: body.desiredStatus,
      outcome: body.outcome,
      occurredAt: body.occurredAt,
      message: body.message,
      evidence: body.evidence,
    });
    const stored = await storeInventoryOperation({
      operationType: SHOPLING_STOCK_STATUS_SYNC_OPERATION_TYPE,
      sourceEventId: `shopling-stock-sync:${encodeURIComponent(event.eventId)}`,
      correlationId: `shopling-stock:${event.barcode}`,
      snapshot: event,
    });
    return Response.json(
      {
        ok: true,
        duplicate: stored.duplicate,
        event,
        message: stored.duplicate
          ? "이미 기록한 Shopling 동기화 결과입니다."
          : "Shopling 재고상태 동기화 결과를 저장했습니다.",
      },
      {
        status: stored.duplicate ? 200 : 201,
        headers: { "cache-control": "no-store" },
      },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "SHOPLING_STOCK_SYNC_EVENT_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Shopling 재고상태 동기화 결과를 저장하지 못했습니다.",
      },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
}
