import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  parseInventoryStockoutBulkText,
  parseInventoryStocktakeBulkText,
} from "../src/lib/inventoryStockBulkInput.ts";

test("품절 입력은 B코드만 여러 건 정규화하고 중복을 제거한다", () => {
  const parsed = parseInventoryStockoutBulkText(" bcb2-1\nBBB8-1, bcb2-1\nBAB3–1 ");
  assert.deepEqual(parsed.barcodes, ["BCB2-1", "BBB8-1", "BAB3-1"]);
  assert.deepEqual(parsed.errors, []);
});

test("품절 입력은 잘못된 B코드를 저장 대상에서 제외하고 오류를 표시한다", () => {
  const parsed = parseInventoryStockoutBulkText("BCB2-1\nAAA001\nBBB8-1");
  assert.deepEqual(parsed.barcodes, ["BCB2-1", "BBB8-1"]);
  assert.equal(parsed.errors.length, 1);
  assert.match(parsed.errors[0], /AAA001/);
});

test("재고확정 입력은 한 줄의 B코드와 수량을 여러 건 해석한다", () => {
  const parsed = parseInventoryStocktakeBulkText("BCB2-1 50\nBBB8-1,10\nBAB3-1=200");
  assert.deepEqual(parsed.items, [
    { barcode: "BCB2-1", baselineQuantity: 50 },
    { barcode: "BBB8-1", baselineQuantity: 10 },
    { barcode: "BAB3-1", baselineQuantity: 200 },
  ]);
  assert.deepEqual(parsed.errors, []);
});

test("재고확정 입력은 같은 B코드 중복과 잘못된 수량을 차단한다", () => {
  const parsed = parseInventoryStocktakeBulkText("BCB2-1 50\nBCB2-1 60\nBBB8-1 0");
  assert.deepEqual(parsed.items, [{ barcode: "BCB2-1", baselineQuantity: 50 }]);
  assert.equal(parsed.errors.length, 2);
  assert.match(parsed.errors.join(" "), /중복 B코드/);
  assert.match(parsed.errors.join(" "), /수량/);
});

test("operator UI no longer asks operators to type product kind or model number", async () => {
  const [stockout, stocktake] = await Promise.all([
    readFile("src/components/china-order-manager/InventoryStockoutOperatorPanel.tsx", "utf8"),
    readFile("src/components/china-order-manager/InventoryStocktakeOperatorPanel.tsx", "utf8"),
  ]);
  for (const source of [stockout, stocktake]) {
    assert.doesNotMatch(source, /setProductKind|productKind\s*,\s*setProductKind|<select/);
    assert.doesNotMatch(source, /setModelNo|modelNo\s*,\s*setModelNo|name=["']modelNo/);
    assert.match(source, /Product Master/);
  }
  assert.match(stockout, /\/api\/inventory-stock-control\/batch/);
  assert.match(stocktake, /\/api\/inventory-stock-control\/stocktake\/batch/);
});

test("batch APIs resolve every B-code before one bulk persistence call", async () => {
  const [stockoutRoute, stocktakeRoute, store, identity] = await Promise.all([
    readFile("src/app/api/inventory-stock-control/batch/route.ts", "utf8"),
    readFile("src/app/api/inventory-stock-control/stocktake/batch/route.ts", "utf8"),
    readFile("src/lib/inventoryStockBulkStore.ts", "utf8"),
    readFile("src/lib/productMasterInventoryIdentity.ts", "utf8"),
  ]);
  for (const route of [stockoutRoute, stocktakeRoute]) {
    assert.match(route, /loadProductMasterInventoryIdentities/);
    assert.match(route, /identity\.state !== "READY"/);
    assert.match(route, /storeInventoryOperationBatch/);
  }
  assert.match(identity, /\/api\/integrations\/inventory-identities/);
  assert.match(identity, /PRODUCT_MASTER_INTEGRATION_SECRET/);
  assert.match(store, /\.upsert\(rows/);
  assert.match(store, /\.in\("source_event_id", sourceIds\)/);
  assert.match(store, /INVENTORY_BATCH_PERSISTENCE_NOT_VISIBLE/);
});
