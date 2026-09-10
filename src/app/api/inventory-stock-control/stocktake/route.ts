import {
  storeInventoryOperation,
} from "@/lib/inventoryStockControl";
import { validateInventoryStockoutResetIdentity } from "@/lib/inventoryStockResetIdentity";
import {
  INVENTORY_STOCKTAKE_BASELINE_OPERATION_TYPE,
  loadLatestInventoryStocktakeBaselines,
  normalizeInventoryStocktakeBaselineInput,
} from "@/lib/inventoryStocktakeBaselines";
import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function unauthorized() {
  return Response.json(
    {
      ok: false,
      code: "INVENTORY_STOCKTAKE_UNAUTHORIZED",
      message: "실사 재고 기준점을 관리할 권한이 필요합니다.",
    },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  if (!isSameOriginOpsRequest(request)) return unauthorized();
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const normalized = normalizeInventoryStocktakeBaselineInput({
      eventId: body.eventId,
      barcode: body.barcode,
      productKind: body.productKind,
      modelNo: body.modelNo,
      baselineQuantity: body.baselineQuantity,
      occurredAt: body.occurredAt,
      note: body.note,
    });
    const identity = await validateInventoryStockoutResetIdentity(normalized);
    const event = {
      ...normalized,
      modelNo: identity.modelNo,
    };
    const stored = await storeInventoryOperation({
      operationType: INVENTORY_STOCKTAKE_BASELINE_OPERATION_TYPE,
      sourceEventId: `inventory-stocktake:${encodeURIComponent(event.eventId)}`,
      correlationId: `inventory-stock:${event.barcode}`,
      snapshot: event,
    });

    const latest = await loadLatestInventoryStocktakeBaselines();
    const visible = latest.get(event.barcode);
    if (!visible || visible.eventId !== event.eventId) {
      return Response.json(
        {
          ok: false,
          code: "INVENTORY_STOCKTAKE_PERSISTENCE_NOT_VISIBLE",
          event,
          message:
            "실사 재고 기준점 저장 직후 재조회 검증에 실패했습니다. 저장 성공으로 처리하지 않았습니다.",
        },
        { status: 503, headers: { "cache-control": "no-store" } },
      );
    }

    return Response.json(
      {
        ok: true,
        duplicate: stored.duplicate,
        event,
        message: stored.duplicate
          ? "이미 저장한 실사 재고 기준점입니다."
          : `실물재고 ${event.baselineQuantity}개를 새 기준점으로 저장했습니다. RECEIVED 입고기록은 만들지 않았습니다.`,
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
        code: "INVENTORY_STOCKTAKE_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "실사 재고 기준점을 저장하지 못했습니다.",
      },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
}
