import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  workspace,
  draftPage,
  draftRoute,
  writeBridge,
  productLaunchSyncRoute,
  productLaunchLoader,
  productLaunchSyncUi,
  productLaunchPage,
] = await Promise.all([
  readFile(
    "src/components/china-order-manager/InternalChinaPurchaseDraftWorkspaceV2.tsx",
    "utf8",
  ),
  readFile("src/app/china-order-manager/drafts/[draftId]/page.tsx", "utf8"),
  readFile(
    "src/app/api/china-order-manager/drafts/[draftId]/route.ts",
    "utf8",
  ),
  readFile("src/lib/productLaunchPurchaseMetadataWrite.ts", "utf8"),
  readFile(
    "src/app/api/product-launch-tracker/item-product-master-sync/route.ts",
    "utf8",
  ),
  readFile("public/product-launch-tracker-app/app.js", "utf8"),
  readFile(
    "public/product-launch-tracker-app/purchase-metadata-auto-sync.js",
    "utf8",
  ),
  readFile("src/app/product-launch-tracker/page.tsx", "utf8"),
]);

test("Draft page exposes a model-level supplier link editor without changing reserved quantity", () => {
  assert.match(draftPage, /InternalChinaDraftBatchEditor/);
  assert.match(workspace, /updateModelSupplierLink/);
  assert.match(workspace, /모델 고정 1번 1688 링크/);
  assert.match(workspace, /상품마스터 최신 원장/);
  assert.match(workspace, /supplierLink: line\.supplierLink/);
});

test("Draft link writeback updates product launch fixed first link and Product Master latest ledger", () => {
  assert.match(draftRoute, /export async function PATCH/);
  assert.match(draftRoute, /updateModelFixedSupplierLink/);
  assert.match(draftRoute, /source: "CHINA_ORDER_DRAFT"/);
  assert.match(writeBridge, /chinaProductLinks/);
  assert.match(writeBridge, /primaryChinaProductLink/);
  assert.match(writeBridge, /detailPageSource/);
  assert.match(writeBridge, /pinnedIndex: 0/);
  assert.match(writeBridge, /purchaseMetadataLastWrite/);
  assert.match(writeBridge, /pushCanonicalProductMasterSnapshotFromTrackerState/);
  assert.match(writeBridge, /updated_at: `eq\.\$\{expectedUpdatedAt\}`/);
});

test("Product launch detail saves auto-sync purchase metadata to Product Master", () => {
  assert.match(productLaunchLoader, /purchase-metadata-auto-sync\.js/);
  assert.match(productLaunchSyncUi, /item-product-master-sync/);
  assert.match(productLaunchSyncUi, /product-launch-tracker:external-state/);
  assert.match(productLaunchSyncRoute, /syncProductLaunchItemPurchaseMetadataToProductMaster/);
  assert.match(productLaunchPage, /20260815-bidirectional-purchase-metadata-v1/);
});

test("supplier metadata bridge never calls 1688 ordering or payment APIs", () => {
  for (const source of [workspace, draftRoute, writeBridge, productLaunchSyncRoute]) {
    assert.doesNotMatch(source, /placeOrder|payOrder|checkout|fetch\([^)]*1688/i);
  }
  assert.match(draftRoute, /externalOrderExecuted: false/);
});
