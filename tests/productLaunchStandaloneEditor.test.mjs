import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("상품 상세 기본 클릭은 독립 편집기로 라우팅하고 shift 클릭은 legacy fallback을 남긴다", async () => {
  const link = await source("public/product-launch-tracker-app/standalone-detail-editor-link.js");
  const gate = await source("public/product-launch-tracker-app/workflow-ui-gate.js");
  assert.match(link, /button\[data-action='detail'\]/);
  assert.match(link, /\/product-launch-editor\?itemId=/);
  assert.match(link, /event\.shiftKey/);
  assert.match(link, /stopImmediatePropagation/);
  assert.match(gate, /standalone-detail-editor-link\.js/);
});

test("독립 편집기는 normalized 단건 조회와 item-scoped patch만 사용한다", async () => {
  const editor = await source("src/app/product-launch-editor/ProductLaunchStandaloneEditor.tsx");
  assert.match(editor, /\/api\/product-launch-tracker\/normalized-optimized/);
  assert.match(editor, /mode: "item"/);
  assert.match(editor, /operation: "patch_item"/);
  assert.match(editor, /itemId: item\.id/);
  assert.doesNotMatch(editor, /state_payload/);
  assert.doesNotMatch(editor, /operation: "replace_item"/);
});

test("독립 편집기 저장은 기준판매가와 원가를 서버 재조회로 검증한다", async () => {
  const editor = await source("src/app/product-launch-editor/ProductLaunchStandaloneEditor.tsx");
  assert.match(editor, /baseSalePriceKrw/);
  assert.match(editor, /unitCostKrw/);
  assert.match(editor, /verifySaved/);
  assert.match(editor, /기준판매가 저장 확인 실패/);
  assert.match(editor, /원가 저장 확인 실패/);
  assert.match(editor, /저장 완료 · 기준판매가\/원가/);
});

test("원가 입력 시 기준판매가는 x2 후 10원 올림되고 기준판매가는 수동 수정 가능하다", async () => {
  const editor = await source("src/app/product-launch-editor/ProductLaunchStandaloneEditor.tsx");
  assert.match(editor, /function salePriceFromUnitCost\(value: unknown\)/);
  assert.match(editor, /return productLaunchSalePriceFromUnitCostKrw\(value\)/);
  assert.match(editor, /baseSalePriceKrw: salePriceFromUnitCost\(unitCostKrw\)/);
  assert.match(editor, /onChange=\{\(event\) => updateUnitCost\(index, event\.target\.value\)\}/);
  assert.match(editor, /onChange=\{\(event\) => updateOption\(index, \{ baseSalePriceKrw:/);
  assert.match(editor, /직접 입력한 가격도 저장할 때 같은 기준이 적용됩니다/);
});
