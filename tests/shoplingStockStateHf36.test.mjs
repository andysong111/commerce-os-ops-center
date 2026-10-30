import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const backgroundPath = "public/shopling-stock-state-sync/background-v073.js";

async function loadOverlay(active) {
  const source = await readFile(backgroundPath, "utf8");
  const legacyCalls = [];
  const chrome = { runtime: { getManifest: () => ({ version: "0.6.4" }) } };
  const factory = new Function(
    "importScripts",
    "chrome",
    "loadActive",
    "handlePageReady",
    "handleStepResult",
    `${source}\nreturn { handlePageReady, handleStepResult };`,
  );
  const overlay = factory(
    () => {},
    chrome,
    async () => active,
    async (message, sender) => {
      legacyCalls.push({ type: "ready", message, sender });
      return { ok: true, legacy: true };
    },
    async (message, sender) => {
      legacyCalls.push({ type: "result", message, sender });
      return { ok: true, legacy: true };
    },
  );
  return { ...overlay, legacyCalls };
}

const active = {
  status: "RUNNING",
  stage: "A6",
  job: { jobId: "bcb6-2-canary" },
  workTabs: { A6: { tabId: 41, frameId: 7 } },
};

test("HF36 ignores the BCB6-2 date failure from an unassigned frame while the assigned A6 frame runs", async () => {
  const harness = await loadOverlay(active);
  const result = await harness.handleStepResult(
    {
      jobId: "bcb6-2-canary",
      stage: "A6",
      result: {
        ok: false,
        code: "SEARCH_DATE_FIELDS_AMBIGUOUS",
        message: "검색 시작일·종료일을 정확히 특정하지 못해 검색을 차단했습니다.",
      },
    },
    { tab: { id: 41 }, frameId: 0 },
  );

  assert.equal(result.ignored, true);
  assert.equal(result.code, "STOCK_SYNC_UNASSIGNED_FRAME_IGNORED_HF36");
  assert.equal(result.assignedFrameId, 7);
  assert.equal(result.senderFrameId, 0);
  assert.equal(harness.legacyCalls.length, 0);
});

test("HF36 forwards only the assigned A6 frame result to the proven coordinator", async () => {
  const harness = await loadOverlay(active);
  const result = await harness.handleStepResult(
    {
      jobId: "bcb6-2-canary",
      stage: "A6",
      result: { ok: true, completed: true, evidence: { matchedRows: 8 } },
    },
    { tab: { id: 41 }, frameId: 7 },
  );

  assert.equal(result.legacy, true);
  assert.equal(harness.legacyCalls.length, 1);
  assert.equal(harness.legacyCalls[0].type, "result");
});

test("HF36 ignores page-ready redispatches from a different frame in the assigned tab", async () => {
  const harness = await loadOverlay(active);
  const result = await harness.handlePageReady(
    { page: { role: "A6" } },
    { tab: { id: 41 }, frameId: 0 },
  );

  assert.equal(result.ignored, true);
  assert.equal(harness.legacyCalls.length, 0);
});

test("HF36 still packages v0.6.4 while the stock-control UI has advanced to HF46", async () => {
  const [route, planner, page, queuePanel, operatorPanel] = await Promise.all([
    readFile("src/app/api/shopling-stock-state-sync/download-hf36/route.ts", "utf8"),
    readFile("src/lib/shoplingStockLaunchPlan.ts", "utf8"),
    readFile("src/app/china-order-manager/stock-control/page.tsx", "utf8"),
    readFile("src/components/china-order-manager/StockSyncOperationalQueuePanel.tsx", "utf8"),
    readFile("src/components/china-order-manager/InventoryStockoutOperatorPanel.tsx", "utf8"),
  ]);
  assert.match(route, /getHf35Download/);
  assert.match(route, /const BASE_VERSION = "0\.6\.3"/);
  assert.match(route, /const VERSION = "0\.6\.4"/);
  assert.match(planner, /ALL_DATE_STOCK_SYNC_MIN_VERSION = \[0, 6, 11\]/);
  assert.match(page, /download-hf46/);
  assert.match(page, /v0\.6\.11 다운로드/);
  assert.match(queuePanel, /v0\.6\.11으로 업데이트해 주세요/);
  assert.match(operatorPanel, /v0\.6\.11으로 업데이트/);
});
