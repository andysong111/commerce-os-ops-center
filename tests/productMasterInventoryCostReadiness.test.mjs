import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const loader = await readFile(
  "src/lib/productMasterInventoryCostReadiness.ts",
  "utf8",
);
const page = await readFile(
  "src/app/product-master/inventory-cost-readiness/page.tsx",
  "utf8",
);

test("inventory and cost readiness uses the authenticated Product Master snapshot only", () => {
  assert.match(loader, /PRODUCT_MASTER_INTEGRATION_SECRET/);
  assert.match(loader, /inventory-cost-ledger-snapshot/);
  assert.match(loader, /x-commerce-os-integration-secret/);
  assert.match(loader, /method: "GET"/);
  assert.doesNotMatch(loader, /method: "POST"|ShoplingReadClient|barcode-ledgers/);
});

test("readiness page keeps unverified zero distinct from confirmed inventory and surfaces receipt coverage", () => {
  assert.match(page, /초기 0·미확인/);
  assert.match(page, /inventoryVerifiedCount/);
  assert.match(page, /inventoryRequiresReview/);
  assert.match(page, /confirmedReceiptCostSkuCount/);
  assert.match(page, /missingConfirmedReceiptCostSkuCount/);
  assert.match(page, /protectedCostKrw/);
  assert.match(loader, /hasVerifiedPurchaseCost\?: unknown/);
  assert.match(loader, /purchaseCostTrustSource\?: unknown/);
  assert.match(loader, /verifiedPurchaseUnitCostKrw\?: unknown/);
  assert.match(loader, /purchaseCostEvidenceCount\?: unknown/);
});
