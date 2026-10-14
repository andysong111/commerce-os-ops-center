import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workspace = await readFile(
  new URL(
    "../src/components/china-order-manager/InternalChinaPurchaseDraftWorkspaceV2.tsx",
    import.meta.url,
  ),
  "utf8",
);
const page = await readFile(
  new URL("../src/app/china-order-manager/drafts/[draftId]/page.tsx", import.meta.url),
  "utf8",
);
const quantityRoute = await readFile(
  new URL(
    "../src/app/api/china-order-manager/drafts/[draftId]/quantity/route.ts",
    import.meta.url,
  ),
  "utf8",
);

test("China draft quantity controls are rendered natively in every order row", () => {
  assert.match(workspace, /function NativeQuantityControl/);
  assert.match(workspace, /data-native-draft-quantity=\{barcode\}/);
  assert.match(workspace, /aria-label=\{`\$\{barcode\} 주문수량`\}/);
  assert.match(workspace, /재계산 대기/);
  assert.match(workspace, /<NativeQuantityControl/);
  assert.match(workspace, /수량 · 계산 대기/);
  assert.doesNotMatch(workspace, /createPortal/);
  assert.doesNotMatch(workspace, /findQuantityTargets/);
});

test("native quantity changes remain local until the single recalculation action", () => {
  assert.match(workspace, /function stageQuantity/);
  assert.match(workspace, /setEditedQuantities/);
  assert.match(workspace, /targetQuantity/);
  assert.match(workspace, /변경사항 모아 발주안 재계산/);
  assert.doesNotMatch(workspace, /fetch\([\s\S]{0,120}\/quantity`/);
  assert.doesNotMatch(workspace, /window\.location\.reload/);

  const postRoute = quantityRoute.slice(
    quantityRoute.indexOf("export async function POST"),
  );
  assert.match(postRoute, /saveInternalChinaQuantityOverride/);
  assert.doesNotMatch(postRoute, /loadInternalChinaQuantityOverrides/);
  assert.doesNotMatch(postRoute, /applyInternalChinaQuantityOverrides/);
});

test("draft table can freeze every column through an operator-selected last column", () => {
  assert.match(workspace, /const TABLE_COLUMNS/);
  assert.match(workspace, /freezeThrough/);
  assert.match(workspace, /function stickyCellStyle/);
  assert.match(workspace, /고정할 마지막 열/);
  assert.match(workspace, /선택한 열까지 왼쪽에 고정/);
  assert.match(workspace, /position: "sticky"/);
});

test("zero domestic China freight is visible and same-link SKUs can be grouped automatically", () => {
  assert.match(workspace, /showZero/);
  assert.match(workspace, /value=\{showZero \? value : value \|\| ""\}/);
  assert.match(workspace, /같은 1688 링크 자동 합배송/);
  assert.match(workspace, /function autoGroupSameSupplierLinks/);
  assert.match(workspace, /function supplierPageKey/);
  assert.match(workspace, /그룹 총운임/);
  assert.match(workspace, /그룹 공유/);
  assert.match(workspace, /무료배송은 0/);
  assert.match(workspace, /updateGroupFreight/);
});

test("CNY price and freight inputs support two decimal places", () => {
  assert.match(workspace, /maximumFractionDigits: 2/);
  assert.match(workspace, /function cnyCent/);
  assert.match(workspace, /step="0\.01"/);
  assert.match(workspace, /inputMode="decimal"/);
  assert.match(workspace, /cnyCent\(event\.target\.value\)/);
});

test("optionless 1688 products can be marked as single item with one click", () => {
  assert.match(workspace, /chinaOption: "단품"/);
  assert.match(workspace, />단품<\/button>/);
  assert.match(workspace, /옵션 없음은 `단품`/);
});

test("draft products can be selected in bulk and regenerated with next-priority budget refill", () => {
  assert.match(workspace, /발주초안 상품 전체 선택/);
  assert.match(workspace, /발주초안에서 제외 선택/);
  assert.match(workspace, /변경사항 모아 발주안 재계산/);
  assert.match(workspace, /buildPurchaseDraftBatchRecalculationHref/);
  assert.match(workspace, /남은 예산은 다음 우선순위 상품에 배정/);
  assert.doesNotMatch(workspace, /targetQuantity: 0/);
  assert.match(page, /regenerationHref=/);
  assert.match(page, /regenerationParams\.set\("cash", String\(budgetAudit\.grossCogsBudgetKrw\)\)/);
});

test("draft page no longer mounts the DOM quantity bridge", () => {
  assert.doesNotMatch(page, /InternalChinaDraftInlineQuantityBridge/);
  assert.doesNotMatch(page, /InternalChinaDraftQuantityEditor/);
  assert.match(page, /수량 변경·상품 제외·상품 추가/);
  assert.match(page, /변경사항 모아 발주안 재계산/);
});
