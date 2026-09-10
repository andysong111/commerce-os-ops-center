import {
  INVENTORY_STOCKOUT_RESET_OPERATION_TYPE,
  loadInventoryStockControlReport,
  normalizeStockoutResetInput,
  storeInventoryOperation,
} from "@/lib/inventoryStockControl";
import { overlayInventoryStockControlReportWithResetCorrections } from "@/lib/inventoryStockResetCorrections";
import { validateInventoryStockoutResetIdentity } from "@/lib/inventoryStockResetIdentity";
import { overlayInventoryStockControlReportWithTail } from "@/lib/inventoryStockSalesTail";
import { ensureExactInventoryStockSalesTailCoverage } from "@/lib/inventoryStockSalesTailCoverage";
import { normalizeRetryableShoplingSyncReportWithEvidence } from "@/lib/inventoryStockSyncResolution";
import { overlayInventoryStockControlReportWithStocktakeBaselines } from "@/lib/inventoryStocktakeBaselines";
import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";
import { wakeOpsDispatchTask } from "@/lib/opsAdaptiveDispatcher";
import {
  createProductMasterShoplingSalesEventSyncRequest,
  loadProductMasterShoplingSalesEventSyncStatus,
} from "@/lib/productMasterShoplingSalesEventSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const ACTIVE_SALES_EVENT_STATES = new Set([
  "QUEUED",
  "RUNNING",
  "READY_CANARY",
  "READY_FULL",
  "STORAGE_NOT_READY",
]);
const WORKER_RUNNABLE_SALES_EVENT_STATES = new Set(["QUEUED", "RUNNING"]);

function unauthorized() {
  return Response.json(
    {
      ok: false,
      code: "INVENTORY_STOCK_CONTROL_UNAUTHORIZED",
      message: "재고 기준점과 Shopling 상태를 관리할 권한이 필요합니다.",
    },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
}

async function loadResolvedInventoryStockControlReport() {
  const seeded = await overlayInventoryStockControlReportWithStocktakeBaselines(
    await loadInventoryStockControlReport(),
  );
  const tailed = await overlayInventoryStockControlReportWithTail(seeded);
  const corrected =
    await overlayInventoryStockControlReportWithResetCorrections(tailed);
  const finalized =
    await overlayInventoryStockControlReportWithStocktakeBaselines(corrected);
  return normalizeRetryableShoplingSyncReportWithEvidence(finalized);
}

async function loadStableInventoryStockControlReport() {
  const first = await loadResolvedInventoryStockControlReport();
  if (first.state !== "READY" || first.resetCount > 0) return first;
  const second = await loadResolvedInventoryStockControlReport();
  return second.resetCount >= first.resetCount ? second : first;
}

function latestCanonicalCoverageGapResetAt(
  report: Awaited<ReturnType<typeof loadStableInventoryStockControlReport>>,
) {
  const candidates = report.rows
    .filter((row) => !row.salesCoverageReady)
    .map((row) => row.resetAt)
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort((left, right) => Date.parse(left) - Date.parse(right));
  return candidates.at(-1) ?? null;
}

async function createCanonicalSalesCoverageRequest(resetMs: number) {
  const created = await createProductMasterShoplingSalesEventSyncRequest();
  const createdAnalysisMs = Date.parse(created.analysisAsOf);
  if (!Number.isFinite(createdAnalysisMs) || createdAnalysisMs < resetMs) {
    throw new Error(
      "CANONICAL_SALES_REFRESH_ANALYSIS_BEFORE_RESET: 새 판매 이벤트 분석시점이 재고 기준시점보다 이릅니다.",
    );
  }
  const wakeRequested = await wakeOpsDispatchTask(
    "product-master-shopling-sales-events",
    0,
  );
  return { created, wakeRequested };
}

async function ensureCanonicalSalesCoverageAfterReset(resetAt: string) {
  try {
    const current = await loadProductMasterShoplingSalesEventSyncStatus();
    const resetMs = Date.parse(resetAt);
    if (!Number.isFinite(resetMs)) {
      throw new Error("CANONICAL_SALES_REFRESH_RESET_AT_INVALID");
    }
    const analysisMs = current.analysisAsOf
      ? Date.parse(current.analysisAsOf)
      : Number.NaN;
    const coversReset = Number.isFinite(analysisMs) && analysisMs >= resetMs;

    if (coversReset) {
      const wakeRequested = WORKER_RUNNABLE_SALES_EVENT_STATES.has(current.state)
        ? await wakeOpsDispatchTask("product-master-shopling-sales-events", 0)
        : false;
      return {
        accepted: false,
        alreadyCovered: true,
        alreadyActive: ACTIVE_SALES_EVENT_STATES.has(current.state),
        supersededStaleRequest: false,
        previousRequestId: null,
        requestId: current.requestId,
        analysisAsOf: current.analysisAsOf,
        state: current.state,
        wakeRequested,
        followupRequired: false,
        message: "Canonical 판매 이벤트 범위가 재고 기준시점을 이미 포함합니다.",
      };
    }

    const previousRequestId = current.requestId;
    const staleRequestWasActive = ACTIVE_SALES_EVENT_STATES.has(current.state);
    const { created, wakeRequested } =
      await createCanonicalSalesCoverageRequest(resetMs);
    return {
      accepted: true,
      alreadyCovered: false,
      alreadyActive: staleRequestWasActive,
      supersededStaleRequest: staleRequestWasActive,
      previousRequestId,
      requestId: created.requestId,
      analysisAsOf: created.analysisAsOf,
      state: "QUEUED",
      wakeRequested,
      followupRequired: false,
      message: staleRequestWasActive
        ? "기존 Canonical 판매 이벤트 분석시점이 재고 기준시점보다 오래되어, 최신 분석시점의 새 요청으로 자동 교체했습니다."
        : "재고 기준시점 이후까지 확인하도록 Canonical 판매 이벤트 최신화를 접수했습니다.",
    };
  } catch (error) {
    return {
      accepted: false,
      alreadyCovered: false,
      alreadyActive: false,
      supersededStaleRequest: false,
      previousRequestId: null,
      requestId: null,
      analysisAsOf: null,
      state: "REFRESH_QUEUE_FAILED",
      wakeRequested: false,
      followupRequired: true,
      message:
        error instanceof Error
          ? error.message
          : "Canonical 판매 이벤트 최신화를 접수하지 못했습니다.",
    };
  }
}

export async function GET(request: Request) {
  if (!isSameOriginOpsRequest(request)) return unauthorized();

  let report = await loadStableInventoryStockControlReport();
  const tailSalesRefresh =
    report.state === "READY"
      ? await ensureExactInventoryStockSalesTailCoverage(report)
      : null;
  if (tailSalesRefresh?.refreshed) {
    report = await loadStableInventoryStockControlReport();
  }

  const coverageGapResetAt =
    report.state === "READY" ? latestCanonicalCoverageGapResetAt(report) : null;
  const canonicalSalesRefresh = coverageGapResetAt
    ? await ensureCanonicalSalesCoverageAfterReset(coverageGapResetAt)
    : null;

  return Response.json(
    {
      ok: report.state === "READY",
      report,
      tailSalesRefresh,
      canonicalSalesRefresh,
    },
    {
      status: report.state === "READY" ? 200 : 503,
      headers: { "cache-control": "no-store" },
    },
  );
}

export async function POST(request: Request) {
  if (!isSameOriginOpsRequest(request)) return unauthorized();
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (String(body.action ?? "").toUpperCase() !== "RESET_ZERO") {
      return Response.json(
        {
          ok: false,
          code: "INVENTORY_STOCK_CONTROL_ACTION_INVALID",
          message: "지원하지 않는 재고 기준점 작업입니다.",
        },
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    }
    const normalizedEvent = normalizeStockoutResetInput({
      eventId: body.eventId,
      barcode: body.barcode,
      productKind: body.productKind,
      modelNo: body.modelNo,
      occurredAt: body.occurredAt,
      note: body.note,
    });
    const event = await validateInventoryStockoutResetIdentity(normalizedEvent);
    const stored = await storeInventoryOperation({
      operationType: INVENTORY_STOCKOUT_RESET_OPERATION_TYPE,
      sourceEventId: `inventory-stockout-reset:${encodeURIComponent(event.eventId)}`,
      correlationId: `inventory-stock:${event.barcode}`,
      snapshot: event,
    });

    const persistenceReport = await loadStableInventoryStockControlReport();
    const persistedReset = persistenceReport.rows.some(
      (row) => row.barcode === event.barcode && row.resetEventId === event.eventId,
    );
    if (!persistedReset) {
      return Response.json(
        {
          ok: false,
          code: "INVENTORY_STOCKOUT_RESET_PERSISTENCE_NOT_VISIBLE",
          event,
          report: persistenceReport,
          message:
            "재고 0 기준점 저장 직후 재조회 검증에 실패했습니다. 저장 성공으로 처리하지 않았으며, 원장 가시성을 확인한 뒤 다시 시도해야 합니다.",
        },
        { status: 503, headers: { "cache-control": "no-store" } },
      );
    }

    const tailSalesRefresh =
      await ensureExactInventoryStockSalesTailCoverage(persistenceReport);
    let report = tailSalesRefresh.refreshed
      ? await loadStableInventoryStockControlReport()
      : persistenceReport;
    const coverageGapResetAt = latestCanonicalCoverageGapResetAt(report);
    const canonicalSalesRefresh = coverageGapResetAt
      ? await ensureCanonicalSalesCoverageAfterReset(coverageGapResetAt)
      : null;
    if (canonicalSalesRefresh?.accepted) {
      report = await loadStableInventoryStockControlReport();
    }

    const stillVisible = report.rows.some(
      (row) => row.barcode === event.barcode && row.resetEventId === event.eventId,
    );
    if (!stillVisible) {
      return Response.json(
        {
          ok: false,
          code: "INVENTORY_STOCKOUT_RESET_PERSISTENCE_LOST_AFTER_REFRESH",
          event,
          tailSalesRefresh,
          canonicalSalesRefresh,
          report,
          message:
            "판매범위 최신화 이후 기준점 재조회 검증에 실패했습니다. 기준점을 0건으로 간주하지 않고 작업을 차단했습니다.",
        },
        { status: 503, headers: { "cache-control": "no-store" } },
      );
    }

    const coverageMessage = tailSalesRefresh.ok
      ? tailSalesRefresh.message
      : canonicalSalesRefresh?.message ?? tailSalesRefresh.message;
    return Response.json(
      {
        ok: true,
        duplicate: stored.duplicate,
        event,
        tailSalesRefresh,
        canonicalSalesRefresh,
        report,
        message: stored.duplicate
          ? `이미 저장한 품절 기준점입니다. 저장·재조회 일치를 확인했습니다. ${coverageMessage}`
          : `B코드 재고를 0으로 초기화했고 저장·재조회 일치를 검증했습니다. ${coverageMessage}`,
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
        code: "INVENTORY_STOCKOUT_RESET_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "품절 기준점을 저장하지 못했습니다.",
      },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
}
