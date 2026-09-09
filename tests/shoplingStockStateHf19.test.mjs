import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routePath = "src/app/api/shopling-stock-state-sync/download-hf19/route.ts";
const backgroundPath = "public/shopling-stock-state-sync/background-v060.js";

test("HF19 fixes A6 max-output pagination and A21 200-row stock sends", async () => {
  const route = await readFile(routePath, "utf8");
  assert.match(route, /HF19_A6_MAX_PAGINATION_A21_200_ACK_BEFORE_AUTOCLOSE/);
  assert.match(route, /a6Output: "MAX_AVAILABLE"/);
  assert.match(route, /SAME_ORIGIN_FETCH_ALL_PAGES_FAIL_CLOSED/);
  assert.match(route, /A6_PAGINATION_DUPLICATE_PAGE/);
  assert.match(route, /a21Output: 200/);
  assert.match(route, /const MAX_VISIBLE_RESULTS = 200/);
  assert.match(route, /A21_PAGE_SIZE_200_SET_FAILED/);
  assert.match(route, /A21_SINGLE_KEY_OVER_200_ROWS/);
  assert.match(route, /SOLD_OUT_AND_ON_SALE_AND_OPTION_RESEND_LIST/);
});

test("HF19 accepts the terminal result tab, ACKs first, then closes the managed result", async () => {
  const background = await readFile(backgroundPath, "utf8");
  assert.match(background, /HF19_SINGLE_RESULT_COUNTS_ACK_THEN_AUTOCLOSE/);
  assert.match(background, /ackBeforeClose: true/);
  assert.match(background, /active\.singlePopupTabId = tabId/);
  const ack = background.indexOf("const advanced = await continueNextGoodsKey");
  const close = background.indexOf("const closeResult = await closeManagedResultV060");
  assert.ok(ack >= 0 && close > ack, "result must be acknowledged before the result tab/window is closed");
});
