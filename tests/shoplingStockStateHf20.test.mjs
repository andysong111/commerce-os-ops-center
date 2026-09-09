import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const file = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("HF20 starts SINGLE result completion from RESULT_WAIT without requiring content evidence", async () => {
  const background = await file("public/shopling-stock-state-sync/background-v061.js");
  assert.match(background, /importScripts\("background-v060\.js"\)/);
  assert.match(background, /STOCK_SINGLE_POPUP_STAGE_V011/);
  assert.match(background, /String\(message\?\.stage \|\| ""\) === "RESULT_WAIT"/);
  assert.match(background, /contentHintRequired: false/);
  assert.match(background, /shoplingTabUpdatedComplete/);
});

test("HF20 reuses proven HF10 CDP Runtime plus Accessibility completion and managed close", async () => {
  const background = await file("public/shopling-stock-state-sync/background-v061.js");
  assert.match(background, /Accessibility\.getFullAXTree/);
  assert.match(background, /chrome\.debugger\.sendCommand\(\{ tabId \}, "Runtime\.evaluate"/);
  assert.match(background, /terminalCounts/);
  assert.match(background, /STABLE_MS_V061 = 2_500/);
  assert.match(background, /continueNextGoodsKey\(latest, sender, completionEvidence\)/);
  assert.match(background, /chrome\.windows\.remove\(tab\.windowId\)/);
  assert.match(background, /chrome\.tabs\.remove\(tabId\)/);
  assert.match(background, /ackBeforeClose: true/);
});

test("HF20 package preserves HF19 A6 max output and A21 200 while isolating channel", async () => {
  const route = await file("src/app/api/shopling-stock-state-sync/download-hf20/route.ts");
  assert.match(route, /getHf19Download/);
  assert.match(route, /hf19A6MaxPaginationPreserved: true/);
  assert.match(route, /hf19A21Output200Preserved: true/);
  assert.match(route, /pageChannel: "HF20_ONLY"/);
  assert.match(route, /debuggerPermission: manifest\.permissions\.includes\("debugger"\)/);
});
