import {
  INVENTORY_STOCKOUT_RESET_OPERATION_TYPE,
  normalizeStockoutResetInput,
} from "@/lib/inventoryStockControl";
import { storeInventoryOperationBatch } from "@/lib/inventoryStockBulkStore";
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
      code: "INVENTORY_STOCKOUT_BATCH_UNAUTHORIZED",
      message: "재고 0 기준점을 관리할 권한이 필요합니다.",
    },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
}

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

export async function POST(request: Request) {
  if (!isSameOriginOpsRequest(request)) return unauthorized();
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const batchId = text(body.batchId).slice(0, 160);
    const rawBarcodes = Array.isArray(body.barcodes) ? body.barcodes : [];
    if (!batchId) throw new Error("INVENTORY_STOCKOUT_BATCH_ID_REQUIRED");
    if (!rawBarcodes.length || rawBarcodes.length > 50) {
      throw new Error("INVENTORY_STOCKOUT_BATCH_SIZE_INVALID");
    }

    const invalidInputs = rawBarcodes.filter((value) => !normalizeInventoryBarcode(value));
    if (invalidInputs.length) {
      return Response.json(
        {
          ok: false,
          code: "INVENTORY_STOCKOUT_BATCH_BARCODE_INVALID",
          invalidInputs: invalidInputs.map(text),
          message: "형식이 잘못된 B코드가 있어 저장하지 않았습니다.",
        },
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    }

    const barcodes = [...new Set(rawBarcodes.map(normalizeInventoryBarcode))];
    const identities = await loadProductMasterInventoryIdentities(barcodes);
    const blocked = identities.filter(
      (identity) => identity.state !== "READY" || !identity.productKind,
    );
    if (blocked.length) {
      return Response.json(
        {
          ok: false,
          code: "INVENTORY_STOCKOUT_BATCH_IDENTITY_BLOCKED",
          blocked,
          message:
            "Product Master에서 정확히 식별되지 않는 B코드가 있어 전체 저장을 중단했습니다.",
        },
        { status: 409, headers: { "cache-control": "no-store" } },
      );
    }

    const occurredAt = text(body.occurredAt) || new Date().toISOString();
    const events = identities.map((identity) =>
      normalizeStockoutResetInput({
        eventId: `stockout-batch:${batchId}:${identity.barcode}`,
        barcode: identity.barcode,
        productKind: identity.productKind,
        modelNo: identity.modelNo,
        occurredAt,
        note: "창고 실물 품절 일괄 확인",
      }),
    );
    const storage = await storeInventoryOperationBatch(
      events.map((event) => ({
        operationType: INVENTORY_STOCKOUT_RESET_OPERATION_TYPE,
        sourceEventId: `inventory-stockout-reset:${encodeURIComponent(event.eventId)}`,
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
        message: `품절 기준점 ${events.length}건을 저장했습니다. 판매·재고 증거는 화면 갱신 시 한 번에 다시 계산합니다.`,
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
        code: "INVENTORY_STOCKOUT_BATCH_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "품절 기준점을 일괄 저장하지 못했습니다.",
      },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
}
