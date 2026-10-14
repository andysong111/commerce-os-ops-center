import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [workspace, batchEditor, page, route, writer] = await Promise.all([
  readFile(
    "src/components/china-order-manager/InternalChinaPurchaseDraftWorkspaceV2.tsx",
    "utf8",
  ),
  readFile(
    "src/components/china-order-manager/InternalChinaDraftBatchEditor.tsx",
    "utf8",
  ),
  readFile("src/app/china-order-manager/drafts/[draftId]/page.tsx", "utf8"),
  readFile(
    "src/app/api/china-order-manager/drafts/[draftId]/purchase-metadata/route.ts",
    "utf8",
  ),
  readFile("src/lib/productLaunchDraftPurchaseMetadataBatchWrite.ts", "utf8"),
]);

test("draft page uses the inline bidirectional workspace", () => {
  assert.match(page, /InternalChinaDraftBatchEditor/);
  assert.match(batchEditor, /InternalChinaPurchaseDraftWorkspaceV2/);
  assert.doesNotMatch(page, /InternalChinaSupplierLinkEditor/);
  assert.match(workspace, /링크·중국옵션을 확인/);
});

test("wide draft table exposes synchronized top and bottom horizontal scrolling", () => {
  assert.match(workspace, /topScrollRef/);
  assert.match(workspace, /tableScrollRef/);
  assert.match(workspace, /ResizeObserver/);
  assert.match(workspace, /표 좌우 스크롤/);
  assert.match(workspace, /← 왼쪽/);
  assert.match(workspace, /오른쪽 →/);
  assert.match(workspace, /overflow-x-auto overscroll-x-contain/);
  assert.match(workspace, /style=\{\{ minWidth: TABLE_WIDTH, width: TABLE_WIDTH \}\}/);
});

test("supplier link and China option are editable inline and included in save payload", () => {
  assert.match(workspace, /updateModelSupplierLink/);
  assert.match(workspace, /supplierLink: line\.supplierLink/);
  assert.match(workspace, /chinaOption: line\.chinaOption/);
  assert.match(workspace, /상품출시 1번 링크로 역저장/);
  assert.match(workspace, /해당 B-code로 상품출시·상품마스터에 역저장/);
  assert.match(workspace, /\/purchase-metadata/);
  assert.doesNotMatch(workspace, /상품출시진행관리에서 이 모델의 1번 중국 상품링크를 입력하세요/);
});

test("purchase metadata endpoint locks input to the current draft and uses same-origin auth", () => {
  assert.match(route, /isSameOriginOpsRequest/);
  assert.match(route, /loadInternalChinaPurchaseDraft/);
  assert.match(route, /currentByBarcode/);
  assert.match(route, /INTERNAL_CHINA_DRAFT_MODEL_LOCKED/);
  assert.match(route, /syncDraftPurchaseMetadataToProductLaunch/);
  assert.match(route, /externalOrderExecuted: false/);
});

test("batch reverse sync updates product launch and the Product Master latest ledger without ordering", () => {
  assert.match(writer, /chinaProductLinks/);
  assert.match(writer, /primaryChinaProductLink/);
  assert.match(writer, /orderOptions/);
  assert.match(writer, /chinaOption/);
  assert.match(writer, /conditionalWriteProductLaunchState/);
  assert.match(writer, /pushCanonicalProductMasterSnapshotFromTrackerState/);
  assert.doesNotMatch(writer, /placeOrder|payOrder|checkout|fetch\([^)]*1688/i);
});
