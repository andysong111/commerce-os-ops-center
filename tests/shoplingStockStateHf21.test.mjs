import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("HF21 scrolls result frames and requires exact Shopling product-state footer before close", async () => {
  const source = await readFile("public/shopling-stock-state-sync/background-v062.js", "utf8");
  assert.match(source, /importScripts\("background-v061\.js"\)/);
  assert.match(source, /상품\\s\*상태\\s\*변경\\s\*전송이\\s\*완료되었습니다/);
  assert.match(source, /window\.scrollTo\(0, bottom\)/);
  assert.match(source, /element\.scrollTop = element\.scrollHeight/);
  assert.match(source, /row\.exactFooter && !row\.processing && row\.readyState === "complete"/);
  assert.match(source, /STABLE_MS_V062 = 1_800/);
  assert.match(source, /continueNextGoodsKey/);
  assert.match(source, /chrome\.windows\.remove\(tab\.windowId\)/);
  assert.match(source, /chrome\.tabs\.remove\(tabId\)/);
});

test("HF21 package preserves A6 max pagination and A21 200 from HF19", async () => {
  const route = await readFile("src/app/api/shopling-stock-state-sync/download-hf21/route.ts", "utf8");
  assert.match(route, /getHf20Download/);
  assert.match(route, /hf19A6MaxPaginationPreserved: true/);
  assert.match(route, /hf19A21Output200Preserved: true/);
  assert.match(route, /pageChannel: "HF21_ONLY"/);
  assert.match(route, /singleCompletionPrimary: "EXACT_FOOTER_상품상태_변경_전송이_완료되었습니다"/);
});
