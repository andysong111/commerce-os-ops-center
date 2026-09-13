import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const routePath = new URL("../src/app/api/shopling-market-group-canary/v0336/download/route.ts", import.meta.url);

test("v0.3.36 removes the obsolete pre-product saved-profile gate", async () => {
  const source = await readFile(routePath, "utf8");
  assert.match(source, /const VERSION = "0\.3\.36"/);
  assert.match(source, /async function drivePreProd\(state\)/);
  assert.match(source, /const mapping = applyPreProdMapping\(\)/);
  assert.match(source, /과거 실전검증된 연동정보 7개 항목 적용 완료/);
  assert.doesNotMatch(source, /preprod_saved_profile_missing/);
  assert.doesNotMatch(source, /쇼핑몰 연동 정보 화면에서 검색관리/);
});

test("v0.3.36 preserves fail-closed submit locking after proven mapping", async () => {
  const source = await readFile(routePath, "utf8");
  assert.match(source, /mapping_controls_missing/);
  assert.match(source, /submit_button_missing/);
  assert.match(source, /type: ARM_MESSAGE/);
  assert.match(source, /stage: \\"submit_armed\\"/);
  assert.match(source, /submitArmedAt: Date\.now\(\)/);
  assert.match(source, /commerceOsShoplingParallelRunV0336/);
  assert.match(source, /commerceOsShoplingParallelWorkerV0336/);
  assert.match(source, /commerceOsShoplingParallelWorkerMetaV0336/);
});

test("v0.3.36 keeps the historical seven-control mapping contract", async () => {
  const source = await readFile(routePath, "utf8");
  assert.match(source, /쇼핑몰별 판매가\/상품명\/검색어\/옵션명/);
  assert.match(source, /상품설명/);
  assert.match(source, /매핑 카테고리 및 fallback/);
  assert.match(source, /getV0335Package/);
  assert.doesNotMatch(source, /상품명 분산.*자동전송/);
});
