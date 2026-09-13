import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const routePath = new URL("../src/app/api/shopling-market-group-canary/v0335/download/route.ts", import.meta.url);

test("v0.3.35 explicitly checks filtered Shopling mall ID rows", async () => {
  const source = await readFile(routePath, "utf8");
  assert.match(source, /const VERSION = "0\.3\.35"/);
  assert.match(source, /function mallIdCheckboxes\(\)/);
  assert.match(source, /function ensureMallIdsChecked\(\)/);
  assert.match(source, /checkbox\.click\(\)/);
  assert.match(source, /checkbox\.checked = true/);
  assert.match(source, /selectedCount !== evidence\.totalCheckboxCount/);
  assert.match(source, /mall_id_checkbox_selection_failed/);
  assert.match(source, /필터된 쇼핑몰 ID .*개 직접 체크 검증 완료/);
});

test("v0.3.35 distinguishes the bottom confirmation button from other Select controls", async () => {
  const source = await readFile(routePath, "utf8");
  assert.match(source, /function mallIdConfirmButton\(\)/);
  assert.match(source, /button, input\[type=\\"button\\"\], input\[type=\\"submit\\"\]/);
  assert.match(source, /sort\(\(a, b\) => b\.getBoundingClientRect\(\)\.top - a\.getBoundingClientRect\(\)\.top\)/);
  assert.match(source, /mall_id_confirm_button_missing/);
  assert.match(source, /click\(confirmButton\)/);
});

test("v0.3.35 keeps fresh runtime keys and fail-closed submit boundary", async () => {
  const source = await readFile(routePath, "utf8");
  assert.match(source, /commerceOsShoplingParallelRunV0335/);
  assert.match(source, /commerceOsShoplingParallelWorkerV0335/);
  assert.match(source, /commerceOsShoplingParallelWorkerMetaV0335/);
  assert.match(source, /commerce-os-shopling-selected-market-start-v0335/);
  assert.match(source, /getV0334Package/);
  assert.doesNotMatch(source, /상품명 분산.*자동전송/);
});
