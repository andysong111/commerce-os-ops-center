import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("HF17 SINGLE popup uses exact semantic locators instead of broad ancestor text", async () => {
  const popup = await readFile("public/shopling-stock-state-sync/content-stock-single-popup-v012.js", "utf8");
  assert.match(popup, /STOCK_SINGLE_POPUP_CLAIM_V012/);
  assert.match(popup, /exactTextNodes\("상품판매상태송신"\)/);
  assert.match(popup, /function statusRadio\(label\)/);
  assert.match(popup, /statusRadio\(targetLabel\)/);
  assert.match(popup, /V012_EXACT_MODE_CELL_AND_STATUS_ROW/);
  assert.doesNotMatch(popup, /localText\(element\)/);
  assert.doesNotMatch(popup, /depth < 3/);
});

test("HF17 popup claim does not depend on mutable canonical stage", async () => {
  const background = await readFile("public/shopling-stock-state-sync/background-v059.js", "utf8");
  assert.match(background, /importScripts\("background-v058\.js"\)/);
  assert.match(background, /STOCK_SINGLE_POPUP_CLAIM_V012/);
  assert.match(background, /\["A21_LIST", "A21_POPUP"\]\.includes/);
  assert.doesNotMatch(background, /singleA21CanonicalStage !== "POPUP_OPENING"/);
  assert.match(background, /STOCK_SINGLE_SALE_STATUS_V012_EXACT_LOCATOR/);
});

test("HF17 package isolates the page channel and replaces the v011 popup content script", async () => {
  const route = await readFile("src/app/api/shopling-stock-state-sync/download-hf17/route.ts", "utf8");
  assert.match(route, /HF17_SINGLE_EXACT_SALE_STATUS_POPUP_LOCATORS/);
  assert.match(route, /content-stock-single-popup-v012\.js/);
  assert.match(route, /manifest\.background\.service_worker = BACKGROUND_FILE/);
  assert.match(route, /HF17_ONLY/);
  assert.match(route, /COMMERCE_OS_SHOPLING_STOCK_SYNC_START_HF17/);
  assert.match(route, /singleA4Used: false/);
  assert.match(route, /optionFlow: "HF10_UNCHANGED"/);
});
