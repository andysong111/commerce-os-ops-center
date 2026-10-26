import { storeInventoryOperationBatch } from "@/lib/inventoryStockBulkStore";
import {
  INVENTORY_MANUAL_ON_SALE_OPERATION_TYPE,
  normalizeInventoryManualOnSaleInput,
} from "@/lib/inventoryManualOnSale";
import {
  INVENTORY_STOCKOUT_RESET_OPERATION_TYPE,
  SHOPLING_STOCK_STATUS_SYNC_OPERATION_TYPE,
  normalizeShoplingStockSyncInput,
  normalizeStockoutResetInput,
  storeInventoryOperation,
} from "@/lib/inventoryStockControl";
import { loadProductMasterInventoryIdentities } from "@/lib/productMasterInventoryIdentity";
import { applyShoplingOptionStatus } from "@/lib/shopling/shoplingOptionStatus";
import type {
  WarehouseExecuteProof,
  WarehousePrepareProof,
} from "@/lib/warehouseStockCommandProof";

export async function prepareWarehouseStockStatus(proof: WarehousePrepareProof) {
  const [identity] = await loadProductMasterInventoryIdentities([proof.barcode]);
  if (!identity || identity.state !== "READY" || !identity.productKind) {
    throw new Error("WAREHOUSE_STOCK_IDENTITY_BLOCKED");
  }
  const event =
    proof.desiredStatus === "SOLD_OUT"
      ? normalizeStockoutResetInput({
          eventId: `stockout-batch:warehouse-${proof.requestId}:${proof.barcode}`,
          barcode: proof.barcode,
          productKind: identity.productKind,
          modelNo: identity.modelNo,
          occurredAt: proof.occurredAt,
          note: "창고지도 위치 버튼 · 실물 품절 확인",
        })
      : normalizeInventoryManualOnSaleInput({
          eventId: `manual-on-sale:warehouse-${proof.requestId}:${proof.barcode}`,
          barcode: proof.barcode,
          productKind: identity.productKind,
          modelNo: identity.modelNo,
          occurredAt: proof.occurredAt,
          note: "창고지도 위치 버튼 · 재고수량 미확정 판매중 전환",
        });
  const soldOut = proof.desiredStatus === "SOLD_OUT";
  const sourcePrefix = soldOut
    ? "inventory-stockout-reset"
    : "inventory-manual-on-sale";
  const storage = await storeInventoryOperationBatch([
    {
      operationType: soldOut
        ? INVENTORY_STOCKOUT_RESET_OPERATION_TYPE
        : INVENTORY_MANUAL_ON_SALE_OPERATION_TYPE,
      sourceEventId: `${sourcePrefix}:${encodeURIComponent(event.eventId)}`,
      correlationId: `inventory-stock:${proof.barcode}`,
      snapshot: event,
      actorType: "COMMERCE_OS_SERVICE",
    },
  ]);
  const job = {
    jobId: `stock-sync:${proof.barcode}:${proof.desiredStatus}:${event.occurredAt}`,
    barcode: proof.barcode,
    productName: identity.productName || identity.optionName || proof.barcode,
    productKind: identity.productKind,
    modelNo: identity.modelNo,
    goodsKeys: [] as string[],
    desiredStatus: proof.desiredStatus,
    desiredSince: event.occurredAt,
    exactInventoryQuantity: 0,
    inventoryQuantityKnown: soldOut,
    manualStatusOnly: !soldOut,
    resetAt: event.occurredAt,
    route:
      identity.productKind === "OPTION"
        ? ["SHOPLING_API_OPTION_STATUS", "A21_GOODS_KEY_OPTION_SEND"]
        : ["A6_READ_ONLY_GOODS_KEY_RESOLVE", "A21_GOODS_KEY_PRODUCT_SALE_STATUS"],
    directOperatorCommand: true as const,
  };
  return {
    ok: true,
    savedCount: 1,
    jobs: [job],
    storage,
    message: soldOut
      ? `${proof.barcode} 품절 기준점을 저장했고 Shopling 품절 전송 작업을 준비했습니다.`
      : `${proof.barcode} 판매중 전환을 저장했고 Shopling 판매중 전송 작업을 준비했습니다. 재고수량은 변경하지 않습니다.`,
    status: storage.insertedCount > 0 ? 201 : 200,
  };
}

export async function applyWarehouseOptionStatus(
  proof: WarehouseExecuteProof,
  goodsKeysInput: unknown,
) {
  if (proof.job.productKind !== "OPTION") {
    throw new Error("WAREHOUSE_STOCK_OPTION_COMMAND_REQUIRED");
  }
  const goodsKeys = Array.isArray(goodsKeysInput)
    ? [...new Set(goodsKeysInput.map(String).map((value) => value.trim()).filter((value) => /^\d+$/.test(value)))]
    : [];
  if (!goodsKeys.length || goodsKeys.length > 20) {
    throw new Error("WAREHOUSE_STOCK_GOODS_KEYS_INVALID");
  }
  const result = await applyShoplingOptionStatus({
    barcode: proof.job.barcode,
    desiredStatus: proof.job.desiredStatus,
    goodsKeys,
  });
  return { ok: true, result, status: 200 };
}

export async function recordWarehouseStockResult(
  proof: WarehouseExecuteProof,
  body: Record<string, unknown>,
) {
  const event = normalizeShoplingStockSyncInput({
    eventId: body.eventId,
    jobId: proof.job.jobId,
    barcode: proof.job.barcode,
    productKind: proof.job.productKind,
    modelNo: proof.job.modelNo,
    desiredStatus: proof.job.desiredStatus,
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
    actorType: "COMMERCE_OS_SERVICE",
  });
  return {
    ok: true,
    duplicate: stored.duplicate,
    event,
    status: stored.duplicate ? 200 : 201,
  };
}

export function safeWarehouseStockError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  if (raw.startsWith("WAREHOUSE_STOCK_IDENTITY_BLOCKED")) {
    return "Product Master에서 정확히 식별되지 않는 B코드라 중단했습니다.";
  }
  if (raw.startsWith("SHOPLING_OPTION_EXACT_MATCH_REQUIRED")) {
    return "B코드와 정확히 일치하는 Shopling 옵션을 1건으로 확인하지 못해 변경하지 않았습니다.";
  }
  if (raw.startsWith("SHOPLING_OPTION_READBACK")) {
    return "Shopling 수정 후 재조회 검증이 일치하지 않아 A21 전송을 차단했습니다.";
  }
  return /^[A-Z0-9_:.-]+$/.test(raw)
    ? raw.slice(0, 500)
    : "창고지도 판매상태 작업을 완료하지 못했습니다.";
}
