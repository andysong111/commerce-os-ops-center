import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("unified API validates all four inputs before one durable batch write", async () => {
  const source = await readFile(
    "src/app/api/inventory-stock-control/unified-batch/route.ts",
    "utf8",
  );
  assert.match(source, /stockoutBarcodes/);
  assert.match(source, /onSaleBarcodes/);
  assert.match(source, /stocktakeItems/);
  assert.match(source, /stockEstimateItems/);
  assert.match(source, /INVENTORY_STOCK_ESTIMATE_BASELINE_OPERATION_TYPE/);
  assert.match(source, /INVENTORY_UNIFIED_BATCH_BARCODE_CONFLICT/);
  assert.match(source, /allBarcodes\.length > 50/);
  assert.match(source, /loadProductMasterInventoryIdentities\(allBarcodes\)/);
  assert.match(source, /identity\.state !== "READY"/);
  assert.match(source, /const storage = await storeInventoryOperationBatch\(\[/);
  assert.match(source, /INVENTORY_STOCKOUT_RESET_OPERATION_TYPE/);
  assert.match(source, /INVENTORY_MANUAL_ON_SALE_OPERATION_TYPE/);
  assert.match(source, /INVENTORY_STOCKTAKE_BASELINE_OPERATION_TYPE/);
});

test("unified API creates immediate Shopling jobs only for explicit status changes", async () => {
  const source = await readFile(
    "src/app/api/inventory-stock-control/unified-batch/route.ts",
    "utf8",
  );
  const jobsBlock = source.slice(
    source.indexOf("const jobs = ["),
    source.indexOf("return Response.json", source.indexOf("const jobs = [")),
  );
  assert.match(jobsBlock, /stockoutEvents\.map/);
  assert.match(jobsBlock, /"SOLD_OUT"/);
  assert.match(jobsBlock, /onSaleEvents\.map/);
  assert.match(jobsBlock, /"ON_SALE"/);
  assert.doesNotMatch(jobsBlock, /stocktakeEvents\.map/);
  assert.doesNotMatch(jobsBlock, /stockEstimateEvents\.map/);
});

test("unified UI has four inputs and one wait-until-complete action", async () => {
  const source = await readFile(
    "src/components/china-order-manager/InventoryStockoutOperatorPanel.tsx",
    "utf8",
  );
  assert.match(source, /stockoutInput/);
  assert.match(source, /onSaleInput/);
  assert.match(source, /stocktakeInput/);
  assert.match(source, /stockEstimateInput/);
  assert.match(source, /inventory-stock-control\/unified-batch/);
  assert.match(source, /전체 \$\{totalCount\}건 저장·적용 시작/);
  assert.match(source, /Shopling 자동 처리 중 · 기다려 주세요/);
  assert.match(source, /conflictingBarcodes/);
  assert.match(source, /planShoplingStockLaunch/);
  assert.match(source, /supportsAllDateStockSync/);
  assert.match(source, /enableAllDateSearch is not defined/);
  assert.match(source, /Shopling에는 이미 반영됐을 수 있으므로 같은 B코드를 다시 실행하지 말고/);
  assert.match(source, /Shopling 자동화 업데이트 필요/);
  assert.doesNotMatch(source, /window\.location\.reload/);
});

test("stock-control page publishes the HF41 install path and one unified operator", async () => {
  const source = await readFile(
    "src/app/china-order-manager/stock-control/page.tsx",
    "utf8",
  );
  assert.match(source, /download-hf41/);
  assert.match(source, /chrome:\/\/extensions/);
  assert.match(source, /<InventoryStockoutOperatorPanel/);
  assert.match(source, /focusedBarcodes=\{focusedCorrection\.barcodes\}/);
  assert.match(source, /!isFocusedCorrection \? <InventoryStockOverviewPanel \/>/);
  assert.doesNotMatch(source, /InventoryManualOnSaleOperatorPanel/);
  assert.doesNotMatch(source, /InventoryStocktakeOperatorPanel/);
});
