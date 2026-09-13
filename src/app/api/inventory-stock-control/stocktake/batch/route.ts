import { storeInventoryOperationBatch } from "@/lib/inventoryStockBulkStore";
import {
  INVENTORY_STOCKTAKE_BASELINE_OPERATION_TYPE,
  normalizeInventoryStocktakeBaselineInput,
} from "@/lib/inventoryStocktakeBaselines";
import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";
import {
  loadProductMasterInventoryIdentities,
  normalizeInventoryBarcode,
} from "@/lib/productMasterInventoryIdentity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

function unauthorized() {
  return Response.json(
    {
      ok: false,
      code: "INVENTORY_STOCKTAKE_BATCH_UNAUTHORIZED",
      message: "실사 재고 기준점을 관리할 권한이 필요합니다.",
    },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
}

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

type RawItem = {
  barcode?: unknown;
  baselineQuantity?: unknown;
};

export async function POST(request: Request) {
  if (!isSameOriginOpsRequest(request)) return unauthorized();
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const batchId = text(body.batchId).slice(0, 160);
    const rawItems = Array.isArray(body.items) ? (body.items as RawItem[]) : [];
    if (!batchId) throw new Error("INVENTORY_STOCKTAKE_BATCH_ID_REQUIRED");
    if (!rawItems.length || rawItems.length > 50) {
      throw new Error("INVENTORY_STOCKTAKE_BATCH_SIZE_INVALID");
    }

    const parsed = rawItems.map((item) => ({
      barcode: normalizeInventoryBarcode(item?.barcode),
      baselineQuantity: Number(item?.baselineQuantity),
    }));
    const invalid = parsed.filter(
      (item) =>
        !item.barcode ||
        !Number.isInteger(item.baselineQuantity) ||
        item.baselineQuantity < 1 ||
        item.baselineQuantity > 1_000_000,
    );
    if (invalid.length) {
      return Response.json(
        {
          ok: false,
          code: "INVENTORY_STOCKTAKE_BATCH_INPUT_INVALID",
          message: "B코드 또는 재고수량 형식이 잘못된 행이 있어 저장하지 않았습니다.",
        },
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    }
    if (new Set(parsed.map((item) => item.barcode)).size !== parsed.length) {
      return Response.json(
        {
          ok: false,
          code: "INVENTORY_STOCKTAKE_BATCH_BARCODE_DUPLICATE",
          message: "같은 B코드를 한 번의 재고확정에 두 번 입력할 수 없습니다.",
        },
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    }

    const identities = await loadProductMasterInventoryIdentities(
      parsed.map((item) => item.barcode),
    );
    const blocked = identities.filter(
      (identity) => identity.state !== "READY" || !identity.productKind,
    );
    if (blocked.length) {
      return Response.json(
        {
          ok: false,
          code: "INVENTORY_STOCKTAKE_BATCH_IDENTITY_BLOCKED",
          blocked,
          message:
            "Product Master에서 정확히 식별되지 않는 B코드가 있어 전체 저장을 중단했습니다.",
        },
        { status: 409, headers: { "cache-control": "no-store" } },
      );
    }

    const identityByBarcode = new Map(
      identities.map((identity) => [identity.barcode, identity] as const),
    );
    const occurredAt = text(body.occurredAt) || new Date().toISOString();
    const events = parsed.map((item) => {
      const identity = identityByBarcode.get(item.barcode);
      if (!identity || !identity.productKind) {
        throw new Error(`INVENTORY_STOCKTAKE_IDENTITY_MISSING:${item.barcode}`);
      }
      return normalizeInventoryStocktakeBaselineInput({
        eventId: `stocktake-batch:${batchId}:${item.barcode}`,
        barcode: item.barcode,
        productKind: identity.productKind,
        modelNo: identity.modelNo,
        baselineQuantity: item.baselineQuantity,
        occurredAt,
        note: "창고 실물수량 일괄 재확인",
      });
    });
    const storage = await storeInventoryOperationBatch(
      events.map((event) => ({
        operationType: INVENTORY_STOCKTAKE_BASELINE_OPERATION_TYPE,
        sourceEventId: `inventory-stocktake:${encodeURIComponent(event.eventId)}`,
        correlationId: `inventory-stock:${event.barcode}`,
        snapshot: event,
      })),
    );

    return Response.json(
      {
        ok: true,
        batchId,
        savedCount: events.length,
        identities,
        events,
        storage,
        message: `현재 재고 기준점 ${events.length}건을 저장했습니다. 이후 판매·입고를 새 기준점부터 자동 반영합니다.`,
      },
      {
        status: storage.insertedCount > 0 ? 201 : 200,
        headers: { "cache-control": "no-store" },
      },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "INVENTORY_STOCKTAKE_BATCH_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "현재 재고 기준점을 일괄 저장하지 못했습니다.",
      },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
}
