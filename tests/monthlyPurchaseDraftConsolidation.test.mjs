import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [lib, route, component, page, metadata, fastActions] = await Promise.all([
  readFile("src/lib/monthlyPurchaseDraftConsolidation.ts", "utf8"),
  readFile(
    "src/app/api/china-order-manager/monthly-finalize/route.ts",
    "utf8",
  ),
  readFile(
    "src/components/china-order-manager/MonthlyDraftConsolidation.tsx",
    "utf8",
  ),
  readFile("src/app/china-order-manager/page.tsx", "utf8"),
  readFile("src/lib/monthlyPurchaseDraftDisplayMetadata.ts", "utf8"),
  readFile(
    "src/components/fast-purchase-mvp/FastPurchaseDraftActions.tsx",
    "utf8",
  ),
]);

test("monthly finalization closes legacy same-month drafts and creates one new RESERVED draft", () => {
  assert.match(lib, /monthlyFinal: true/);
  assert.match(lib, /status: "CANCELLED"/);
  assert.match(lib, /status: "RESERVED"/);
  assert.match(lib, /supersededByDraftId/);
  assert.match(lib, /supersedesDraftIds/);
  assert.match(lib, /externalOrderExecuted: false/);
  assert.match(lib, /resolution=ignore-duplicates/);
});

test("monthly finalization refuses to rewrite drafts that already progressed beyond RESERVED", () => {
  assert.match(lib, /row\.status !== "RESERVED"/);
  assert.match(lib, /row\.orderedQuantity > 0/);
  assert.match(lib, /row\.receivedQuantity > 0/);
  assert.match(lib, /MONTHLY_PURCHASE_FINAL_SOURCE_ALREADY_PROGRESSING/);
});

test("final quantities are operator-controlled but bounded and limited to barcodes in the active monthly drafts", () => {
  assert.match(lib, /MANUAL_QUANTITY_MAX = 9_999/);
  assert.match(lib, /allowedBarcodes\.has\(code\)/);
  assert.match(lib, /MONTHLY_PURCHASE_FINAL_QUANTITY_INVALID/);
  assert.match(component, /기준 밖 추가후보/);
  assert.match(component, /추가 후보/);
  assert.match(component, /최종 수량/);
  assert.match(component, /selected: Boolean\(base\)/);
});

test("monthly consolidation keeps B-code identity metadata available for legacy repair", () => {
  assert.match(page, /loadMonthlyDraftDisplayMetadata/);
  assert.match(page, /metadata\.byBarcode\[line\.barcode\]/);
  assert.match(metadata, /loadProductLaunchPurchaseMetadataByBarcode/);
  assert.match(metadata, /loadShoplingCurrentModelSnapshot/);
  assert.match(metadata, /modelNo:/);
  assert.match(metadata, /modelName:/);
  assert.match(metadata, /saleOption:/);
  assert.match(component, /metadataByBarcode/);
  assert.match(component, /B-code · 모델번호 · 모델명 · 옵션명/);
  assert.match(component, /모델번호/);
  assert.match(component, /모델명/);
  assert.match(component, /옵션명/);
  assert.doesNotMatch(component, /상품명/);
});

test("new operator drafts are on-demand while legacy consolidation stays repair-safe", () => {
  assert.doesNotMatch(fastActions, /monthlyLocked/);
  assert.doesNotMatch(fastActions, /FAST_PURCHASE_MONTHLY_CYCLE_ALREADY_USED/);
  assert.match(fastActions, /같은 달에도 여러/);
  assert.match(fastActions, /이전 발주시작일부터 이번 발주시작일까지/);
  assert.match(page, /selectedDrafts = draftState\.drafts\.filter/);
  assert.doesNotMatch(page, /MonthlyDraftConsolidation/);
  assert.match(component, /선택 수량으로 월간 최종화/);
  assert.match(component, /기존 Draft는 삭제하지 않고 CANCELLED 이력으로 보존/);
});

test("monthly finalization API is same-origin only and never places a 1688 order", () => {
  assert.match(route, /isSameOriginOpsRequest/);
  assert.match(route, /consolidateMonthlyPurchaseDrafts/);
  assert.match(route, /실제 1688 주문·결제는 실행하지 않았습니다/);
  assert.doesNotMatch(route, /placeOrder|payOrder|checkout/i);
});
