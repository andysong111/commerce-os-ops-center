import {
  INVENTORY_STOCKOUT_RESET_OPERATION_TYPE,
  normalizeStockoutResetInput,
} from "@/lib/inventoryStockControl";
import { storeInventoryOperationBatch } from "@/lib/inventoryStockBulkStore";
import {
  INVENTORY_MANUAL_ON_SALE_OPERATION_TYPE,
  normalizeInventoryManualOnSaleInput,
} from "@/lib/inventoryManualOnSale";
import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";
import {
  loadProductMasterInventoryIdentities,
  normalizeInventoryBarcode,
} from "@/lib/productMasterInventoryIdentity";
import {
  INVENTORY_STOCKTAKE_BASELINE_OPERATION_TYPE,
  normalizeInventoryStocktakeBaselineInput,
} from "@/lib/inventoryStocktakeBaselines";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

type RawStocktakeItem = {
  barcode?: unknown;
  baselineQuantity?: unknown;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function unauthorized() {
  return Response.json(
    {
      ok: false,
      code: "INVENTORY_UNIFIED_BATCH_UNAUTHORIZED",
      message: "통합 재고 작업을 실행할 권한이 필요합니다.",
    },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
}

function directJob(
  event: {
    barcode: string;
    productKind: "OPTION" | "SINGLE";
    modelNo: string | null;
    occurredAt: string;
  },
  identity: {
    productName?: string | null;
    optionName?: string | null;
  },
  desiredStatus: "SOLD_OUT" | "ON_SALE",
  manualStatusOnly = false,
) {
  return {
    jobId: `stock-sync:${event.barcode}:${desiredStatus}:${event.occurredAt}`,
    barcode: event.barcode,
    productName:
      identity.productName || identity.optionName || event.barcode,
    productKind: event.productKind,
    modelNo: event.modelNo,
    goodsKeys: [] as string[],
    desiredStatus,
    desiredSince: event.occurredAt,
    exactInventoryQuantity: 0,
    ...(manualStatusOnly
      ? { inventoryQuantityKnown: false as const, manualStatusOnly: true as const }
      : {}),
    resetAt: event.occurredAt,
    route:
      event.productKind === "OPTION"
        ? ["SHOPLING_API_OPTION_STATUS", "A21_GOODS_KEY_OPTION_SEND"]
        : [
            "A6_READ_ONLY_GOODS_KEY_RESOLVE",
            "A21_GOODS_KEY_PRODUCT_SALE_STATUS",
          ],
    directOperatorCommand: true as const,
  };
}

export async function POST(request: Request) {
  if (!isSameOriginOpsRequest(request)) return unauthorized();

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const batchId = text(body.batchId).slice(0, 160);
    const rawStockout = Array.isArray(body.stockoutBarcodes)
      ? body.stockoutBarcodes
      : [];
    const rawOnSale = Array.isArray(body.onSaleBarcodes)
      ? body.onSaleBarcodes
      : [];
    const rawStocktake = Array.isArray(body.stocktakeItems)
      ? (body.stocktakeItems as RawStocktakeItem[])
      : [];
    if (!batchId) throw new Error("INVENTORY_UNIFIED_BATCH_ID_REQUIRED");

    const invalidBarcodes = [...rawStockout, ...rawOnSale].filter(
      (value) => !normalizeInventoryBarcode(value),
    );
    const stockoutBarcodes = rawStockout.map(normalizeInventoryBarcode);
    const onSaleBarcodes = rawOnSale.map(normalizeInventoryBarcode);
    const stocktakeItems = rawStocktake.map((item) => ({
      barcode: normalizeInventoryBarcode(item?.barcode),
      baselineQuantity: Number(item?.baselineQuantity),
    }));
    const invalidStocktake = stocktakeItems.filter(
      (item) =>
        !item.barcode ||
        !Number.isInteger(item.baselineQuantity) ||
        item.baselineQuantity < 1 ||
        item.baselineQuantity > 1_000_000,
    );
    if (invalidBarcodes.length || invalidStocktake.length) {
      return Response.json(
        {
          ok: false,
          code: "INVENTORY_UNIFIED_BATCH_INPUT_INVALID",
          message: "형식이 잘못된 B코드 또는 재고수량이 있어 전체 작업을 시작하지 않았습니다.",
        },
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    }

    const allBarcodes = [
      ...stockoutBarcodes,
      ...onSaleBarcodes,
      ...stocktakeItems.map((item) => item.barcode),
    ];
    if (!allBarcodes.length || allBarcodes.length > 50) {
      throw new Error("INVENTORY_UNIFIED_BATCH_SIZE_INVALID");
    }
    const duplicates = [
      ...new Set(
        allBarcodes.filter(
          (barcode, index) => allBarcodes.indexOf(barcode) !== index,
        ),
      ),
    ];
    if (duplicates.length) {
      return Response.json(
        {
          ok: false,
          code: "INVENTORY_UNIFIED_BATCH_BARCODE_CONFLICT",
          conflicts: duplicates,
          message: `같은 B코드가 둘 이상의 작업에 입력되었습니다: ${duplicates.join(", ")}`,
        },
        { status: 409, headers: { "cache-control": "no-store" } },
      );
    }

    const identities = await loadProductMasterInventoryIdentities(allBarcodes);
    const blocked = identities.filter(
      (identity) => identity.state !== "READY" || !identity.productKind,
    );
    if (blocked.length) {
      return Response.json(
        {
          ok: false,
          code: "INVENTORY_UNIFIED_BATCH_IDENTITY_BLOCKED",
          blocked,
          message:
            "Product Master에서 정확히 식별되지 않는 B코드가 있어 전체 작업을 저장하지 않았습니다.",
        },
        { status: 409, headers: { "cache-control": "no-store" } },
      );
    }

    const identityByBarcode = new Map(
      identities.map((identity) => [identity.barcode, identity] as const),
    );
    const occurredAt = text(body.occurredAt) || new Date().toISOString();
    const stockoutEvents = stockoutBarcodes.map((barcode) => {
      const identity = identityByBarcode.get(barcode);
      if (!identity?.productKind) {
        throw new Error(`INVENTORY_UNIFIED_IDENTITY_MISSING:${barcode}`);
      }
      return normalizeStockoutResetInput({
        eventId: `unified-stockout:${batchId}:${barcode}`,
        barcode,
        productKind: identity.productKind,
        modelNo: identity.modelNo,
        occurredAt,
        note: "통합 입력 · 창고 실물 품절 확인",
      });
    });
    const onSaleEvents = onSaleBarcodes.map((barcode) => {
      const identity = identityByBarcode.get(barcode);
      if (!identity?.productKind) {
        throw new Error(`INVENTORY_UNIFIED_IDENTITY_MISSING:${barcode}`);
      }
      return normalizeInventoryManualOnSaleInput({
        eventId: `unified-on-sale:${batchId}:${barcode}`,
        barcode,
        productKind: identity.productKind,
        modelNo: identity.modelNo,
        occurredAt,
        note: "통합 입력 · 재고수량 미확정 판매중 전환",
      });
    });
    const stocktakeEvents = stocktakeItems.map((item) => {
      const identity = identityByBarcode.get(item.barcode);
      if (!identity?.productKind) {
        throw new Error(`INVENTORY_UNIFIED_IDENTITY_MISSING:${item.barcode}`);
      }
      return normalizeInventoryStocktakeBaselineInput({
        eventId: `unified-stocktake:${batchId}:${item.barcode}`,
        barcode: item.barcode,
        productKind: identity.productKind,
        modelNo: identity.modelNo,
        baselineQuantity: item.baselineQuantity,
        occurredAt,
        note: "통합 입력 · 창고 실물수량 확인",
      });
    });

    const storage = await storeInventoryOperationBatch([
      ...stockoutEvents.map((event) => ({
        operationType: INVENTORY_STOCKOUT_RESET_OPERATION_TYPE,
        sourceEventId: `inventory-stockout-reset:${encodeURIComponent(event.eventId)}`,
        correlationId: `inventory-stock:${event.barcode}`,
        snapshot: event,
      })),
      ...onSaleEvents.map((event) => ({
        operationType: INVENTORY_MANUAL_ON_SALE_OPERATION_TYPE,
        sourceEventId: `inventory-manual-on-sale:${encodeURIComponent(event.eventId)}`,
        correlationId: `inventory-stock:${event.barcode}`,
        snapshot: event,
      })),
      ...stocktakeEvents.map((event) => ({
        operationType: INVENTORY_STOCKTAKE_BASELINE_OPERATION_TYPE,
        sourceEventId: `inventory-stocktake:${encodeURIComponent(event.eventId)}`,
        correlationId: `inventory-stock:${event.barcode}`,
        snapshot: event,
      })),
    ]);

    const jobs = [
      ...stockoutEvents.map((event) =>
        directJob(
          event,
          identityByBarcode.get(event.barcode) || {},
          "SOLD_OUT",
        ),
      ),
      ...onSaleEvents.map((event) =>
        directJob(
          event,
          identityByBarcode.get(event.barcode) || {},
          "ON_SALE",
          true,
        ),
      ),
    ];

    return Response.json(
      {
        ok: true,
        batchId,
        savedCount: allBarcodes.length,
        counts: {
          stockout: stockoutEvents.length,
          onSale: onSaleEvents.length,
          stocktake: stocktakeEvents.length,
        },
        identities,
        jobs,
        storage,
        message:
          `통합 재고 작업 ${allBarcodes.length}건을 저장했습니다. ` +
          `품절 ${stockoutEvents.length}건과 판매중 ${onSaleEvents.length}건은 Shopling 즉시 전송하며 ` +
          `재고수량 ${stocktakeEvents.length}건은 새 수량 기준점으로 확정했습니다.`,
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
        code: "INVENTORY_UNIFIED_BATCH_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "통합 재고 작업을 저장하지 못했습니다.",
      },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
}
