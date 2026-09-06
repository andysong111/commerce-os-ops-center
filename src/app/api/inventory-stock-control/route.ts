import {
  INVENTORY_STOCKOUT_RESET_OPERATION_TYPE,
  loadInventoryStockControlReport,
  normalizeStockoutResetInput,
  storeInventoryOperation,
} from "@/lib/inventoryStockControl";
import { normalizeRetryableShoplingSyncReportWithEvidence } from "@/lib/inventoryStockSyncResolution";
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

async function loadStableInventoryStockControlReport() {
  const first = await normalizeRetryableShoplingSyncReportWithEvidence(
    await loadInventoryStockControlReport(),
  );
  if (first.state !== "READY" || first.resetCount > 0) return first;

  // A reset ledger has no operator delete path, so an unexpected zero can be a
  // transient read. Re-read once before presenting an empty canonical state.
  const second = await normalizeRetryableShoplingSyncReportWithEvidence(
    await loadInventoryStockControlReport(),
  );
  return second.resetCount >= first.resetCount ? second : first;
}

async function ensureCanonicalSalesCoverageAfterReset(resetAt: string) {
  try {
    const current = await loadProductMasterShoplingSalesEventSyncStatus();
    const resetMs = Date.parse(resetAt);
    const analysisMs = current.analysisAsOf
      ? Date.parse(current.analysisAsOf)
      : Number.NaN;
    const coversReset =
      Number.isFinite(resetMs) &&
      Number.isFinite(analysisMs) &&
      analysisMs >= resetMs;

    if (coversReset) {
      const wakeRequested = ACTIVE_SALES_EVENT_STATES.has(current.state)
        ? await wakeOpsDispatchTask("product-master-shopling-sales-events", 0)
        : false;
      return {
        accepted: false,
        alreadyCovered: true,
        alreadyActive: ACTIVE_SALES_EVENT_STATES.has(current.state),
        requestId: current.requestId,
        analysisAsOf: current.analysisAsOf,
        state: current.state,
        wakeRequested,
        followupRequired: false,
        message: "Canonical 판매 이벤트 범위가 품절 기준시점을 이미 포함합니다.",
      };
    }

    if (ACTIVE_SALES_EVENT_STATES.has(current.state)) {
      const wakeRequested = await wakeOpsDispatchTask(
        "product-master-shopling-sales-events",
        0,
      );
      return {
        accepted: false,
        alreadyCovered: false,
        alreadyActive: true,
        requestId: current.requestId,
        analysisAsOf: current.analysisAsOf,
        state: current.state,
        wakeRequested,
        followupRequired: true,
        message:
          "진행 중인 Canonical 판매 이벤트가 품절 기준시점보다 이릅니다. 현재 작업을 우선 완료하고 새 범위가 필요합니다.",
      };
    }

    const created = await createProductMasterShoplingSalesEventSyncRequest();
    const wakeRequested = await wakeOpsDispatchTask(
      "product-master-shopling-sales-events",
      0,
    );
    return {
      accepted: true,
      alreadyCovered: false,
      alreadyActive: false,
      requestId: created.requestId,
      analysisAsOf: created.analysisAsOf,
      state: "QUEUED",
      wakeRequested,
      followupRequired: false,
      message:
        "품절 기준시점 이후까지 확인하도록 Canonical 판매 이벤트 최신화를 접수했습니다.",
    };
  } catch (error) {
    return {
      accepted: false,
      alreadyCovered: false,
      alreadyActive: false,
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
  const report = await loadStableInventoryStockControlReport();
  return Response.json(
    { ok: report.state === "READY", report },
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
    const event = normalizeStockoutResetInput({
      eventId: body.eventId,
      barcode: body.barcode,
      productKind: body.productKind,
      modelNo: body.modelNo,
      occurredAt: body.occurredAt,
      note: body.note,
    });
    const stored = await storeInventoryOperation({
      operationType: INVENTORY_STOCKOUT_RESET_OPERATION_TYPE,
      sourceEventId: `inventory-stockout-reset:${encodeURIComponent(event.eventId)}`,
      correlationId: `inventory-stock:${event.barcode}`,
      snapshot: event,
    });

    // A write is not considered successful until the canonical read path can see
    // the exact reset again. This prevents a transient/permission/cache problem
    // from being presented to the operator as a durable 0 baseline.
    const persistenceReport = await loadStableInventoryStockControlReport();
    const persistedReset = persistenceReport.rows.some(
      (row) =>
        row.barcode === event.barcode && row.resetEventId === event.eventId,
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

    const canonicalSalesRefresh = await ensureCanonicalSalesCoverageAfterReset(
      event.occurredAt,
    );
    const report = await loadStableInventoryStockControlReport();
    const stillVisible = report.rows.some(
      (row) =>
        row.barcode === event.barcode && row.resetEventId === event.eventId,
    );
    if (!stillVisible) {
      return Response.json(
        {
          ok: false,
          code: "INVENTORY_STOCKOUT_RESET_PERSISTENCE_LOST_AFTER_REFRESH",
          event,
          canonicalSalesRefresh,
          report,
          message:
            "Canonical 판매 최신화 이후 기준점 재조회 검증에 실패했습니다. 기준점을 0건으로 간주하지 않고 작업을 차단했습니다.",
        },
        { status: 503, headers: { "cache-control": "no-store" } },
      );
    }

    return Response.json(
      {
        ok: true,
        duplicate: stored.duplicate,
        event,
        canonicalSalesRefresh,
        report,
        message: stored.duplicate
          ? "이미 저장한 품절 기준점입니다. 저장·재조회 일치와 Canonical 판매 범위를 함께 확인했습니다."
          : "B코드 재고를 0으로 초기화했고 저장·재조회 일치를 검증한 뒤, 기준시점 이후까지 확인할 Canonical 판매 최신화를 접수했습니다.",
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
