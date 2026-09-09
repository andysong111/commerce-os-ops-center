import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const file = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("HF22 ports actual price-extension result discovery and deterministic managed close", async () => {
  const background = await file("public/shopling-stock-state-sync/background-v063.js");
  assert.match(background, /importScripts\("background-v062\.js"\)/);
  assert.match(background, /commerceStockWorkspaceV030/);
  assert.match(background, /createdTabsV063/);
  assert.match(background, /about:blank\|javascript:\|blob:/);
  assert.match(background, /Accessibility\.getFullAXTree/);
  assert.match(background, /Runtime\.evaluate/);
  assert.match(background, /window\.scrollTo\(0, Math\.max/);
  assert.match(background, /상품\\s\*상태\\s\*변경\\s\*전송이\\s\*완료되었습니다/);
  assert.match(background, /continueNextGoodsKey\(/);
  assert.match(background, /closeResultWindowV063/);
  assert.match(background, /closeOwnedWorkspaceWindowsV063/);
  assert.match(background, /chrome\.windows\.remove\(windowId\)/);
  assert.match(background, /onCreatedNavigationTarget/);
});

test("HF22 download isolates the page channel and keeps HF19 A6\/A21 behavior", async () => {
  const route = await file("src/app/api/shopling-stock-state-sync/download-hf22/route.ts");
  assert.match(route, /HF22_PRICE_V044_ACTUAL_RESULT_LIFECYCLE/);
  assert.match(route, /COMMERCE_OS_SHOPLING_STOCK_SYNC_START_HF22/);
  assert.match(route, /background-v063\.js/);
  assert.match(route, /hf19A6MaxPaginationPreserved: true/);
  assert.match(route, /hf19A21Output200Preserved: true/);
  assert.match(route, /referenceImplementation: "shopling-a21-price-option-resend v0\.4\.4 background-v044 \+ background-v020 closeManaged"/);
  assert.match(route, /RESULT.*WINDOW_REMOVE|DETERMINISTIC_WINDOW_REMOVE_THEN_TAB_FALLBACK/i);
});
