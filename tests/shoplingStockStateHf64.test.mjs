import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const backgroundPath =
  "public/shopling-stock-state-sync/background-v086.js";
const evidencePath =
  "public/shopling-stock-state-sync/a6-frame-evidence-v086.js";

async function loadBackgroundHarness({ evidenceByFrame } = {}) {
  const source = await readFile(backgroundPath, "utf8");
  let active = {
    status: "RUNNING",
    stage: "A6",
    job: { jobId: "hf64-bcd8-2", barcode: "BCD8-2" },
    workTabs: { A6: { tabId: 101, windowId: 12, frameId: 7 } },
  };
  const saves = [];
  const dispatches = [];
  const legacyPageReadyCalls = [];
  const legacyStepCalls = [];
  const evidence = evidenceByFrame || {
    7: {
      ok: true,
      role: "A6",
      hasExactSearchControl: true,
      exactResultRowCount: 0,
    },
    11: {
      ok: true,
      role: "A6",
      hasExactSearchControl: true,
      exactResultRowCount: 1,
      totalResultCount: 1,
    },
  };
  const chrome = {
    runtime: { getManifest: () => ({ version: "0.6.27" }) },
    webNavigation: {
      getAllFrames: async () => [
        { frameId: 7 },
        { frameId: 11 },
      ],
    },
    tabs: {
      sendMessage: async (_tabId, message, options) =>
        message?.type === "STOCK_SYNC_A6_FRAME_EVIDENCE_HF64"
          ? evidence[options.frameId] || null
          : null,
      get: async () => ({ id: 101, windowId: 12 }),
    },
  };
  const factory = new Function(
    "chrome",
    "importScripts",
    "handlePageReady",
    "handleStepResult",
    "loadActive",
    "saveActive",
    "dispatchToTarget",
    "sleep",
    `${source}\nreturn { handlePageReady, handleStepResult };`,
  );
  const api = factory(
    chrome,
    () => {},
    async (message, sender) => {
      legacyPageReadyCalls.push({ message, sender });
      return { ok: true, dispatched: true };
    },
    async (message, sender) => {
      legacyStepCalls.push({ message, sender });
      return { ok: true, accepted: true };
    },
    async () => active,
    async (value) => {
      active = value;
      saves.push(structuredClone(value));
      return value;
    },
    async (value, target) => {
      dispatches.push({ value: structuredClone(value), target });
      return true;
    },
    async () => {},
  );
  return {
    api,
    getActive: () => active,
    saves,
    dispatches,
    legacyPageReadyCalls,
    legacyStepCalls,
  };
}

test("HF64 chooses the exact BCD8-2 result frame even while the old A6 frame still responds", async () => {
  const harness = await loadBackgroundHarness();
  const result = await harness.api.handlePageReady(
    { page: { role: "A6" } },
    { tab: { id: 101, windowId: 12 }, frameId: 11 },
  );

  assert.equal(result.dispatched, true);
  assert.equal(harness.getActive().workTabs.A6.frameId, 11);
  assert.equal(
    harness.getActive().watchdogHeartbeatSource,
    "HF64_EXACT_BCODE_RESULT_FRAME",
  );
  assert.equal(harness.legacyPageReadyCalls.length, 1);
});

test("HF64 ignores an early old-frame failure and dispatches the exact same-tab result frame", async () => {
  const harness = await loadBackgroundHarness();
  const result = await harness.api.handleStepResult(
    {
      jobId: "hf64-bcd8-2",
      stage: "A6",
      result: { ok: false, code: "EXACT_RESULT_NOT_FOUND" },
    },
    { tab: { id: 101, windowId: 12 }, frameId: 7 },
  );

  assert.equal(result.code, "HF64_STALE_A6_FRAME_FAILURE_IGNORED");
  assert.equal(result.retrying, true);
  assert.equal(harness.legacyStepCalls.length, 0);
  assert.equal(harness.dispatches.length, 1);
  assert.equal(harness.dispatches[0].target.frameId, 11);
  assert.equal(harness.getActive().workTabs.A6.frameId, 11);
});

test("HF64 accepts exact A6 success from the dedicated tab and rebinds before HF36", async () => {
  const harness = await loadBackgroundHarness();
  const result = await harness.api.handleStepResult(
    {
      jobId: "hf64-bcd8-2",
      stage: "A6",
      result: {
        ok: true,
        completed: true,
        evidence: {
          matchedRows: 1,
          discoveredGoodsKeys: ["120867"],
        },
      },
    },
    { tab: { id: 101, windowId: 12 }, frameId: 11 },
  );

  assert.equal(result.accepted, true);
  assert.equal(harness.legacyStepCalls.length, 1);
  assert.equal(harness.getActive().workTabs.A6.frameId, 11);
  assert.equal(harness.getActive().a6SuccessClaim.frameId, 11);
});

test("HF64 never transfers A6 across tabs and leaves A21 ownership to the strict legacy guard", async () => {
  const otherTab = await loadBackgroundHarness();
  await otherTab.api.handleStepResult(
    {
      jobId: "hf64-bcd8-2",
      stage: "A6",
      result: {
        ok: true,
        completed: true,
        evidence: { matchedRows: 1, discoveredGoodsKeys: ["120867"] },
      },
    },
    { tab: { id: 999, windowId: 12 }, frameId: 11 },
  );
  assert.equal(otherTab.getActive().workTabs.A6.frameId, 7);
  assert.equal(otherTab.legacyStepCalls.length, 1);

  const a21 = await loadBackgroundHarness();
  a21.getActive().stage = "A21_LIST";
  a21.getActive().workTabs.A21_LIST = { tabId: 202, frameId: 5 };
  await a21.api.handleStepResult(
    { jobId: "hf64-bcd8-2", stage: "A21_LIST", result: { ok: false } },
    { tab: { id: 202 }, frameId: 9 },
  );
  assert.equal(a21.getActive().workTabs.A21_LIST.frameId, 5);
  assert.equal(a21.legacyStepCalls.length, 1);
});

test("HF64 A6 evidence is read-only and detects exact B-code rows", async () => {
  const source = await readFile(evidencePath, "utf8");
  let listener = null;
  const select = {
    options: [{ textContent: "옵션자체관리코드" }],
  };
  const row = {
    innerText: "BCD8-2 컨트롤러 레이싱그립 120867-4416179",
    textContent: "",
  };
  const input = { value: "BCD8-2" };
  const storage = new Map([
    [
      "commerce-stock-search-v042:A6:/goods:옵션자체관리코드:BCD8-2",
      JSON.stringify({
        submitted: true,
        at: Date.now(),
        fieldLabel: "옵션자체관리코드",
        token: "BCD8-2",
      }),
    ],
  ]);
  const sessionStorage = {
    get length() {
      return storage.size;
    },
    key: (index) => [...storage.keys()][index] || null,
    getItem: (key) => storage.get(key) || null,
  };
  const document = {
    body: { innerText: "총 조회수: 1건" },
    documentElement: { innerText: "" },
    querySelectorAll: (selector) => {
      if (selector === "select") return [select];
      if (selector === "tr") return [row];
      if (selector === "input,textarea") return [input];
      return [];
    },
  };
  const chrome = {
    runtime: {
      onMessage: {
        addListener: (value) => {
          listener = value;
        },
      },
    },
  };
  new Function(
    "chrome",
    "document",
    "sessionStorage",
    "location",
    source,
  )(chrome, document, sessionStorage, { href: "https://a.shopling.co.kr/a6" });
  let result = null;
  listener(
    { type: "STOCK_SYNC_A6_FRAME_EVIDENCE_HF64", barcode: "BCD8-2" },
    {},
    (value) => {
      result = value;
    },
  );

  assert.equal(result.exactResultRowCount, 1);
  assert.equal(result.totalResultCount, 1);
  assert.equal(result.controlsEchoExactBarcode, true);
  assert.equal(result.hasFreshSubmittedTicket, true);
  assert.equal(result.readOnly, true);
  assert.equal(result.mutationAttempted, false);
  assert.doesNotMatch(source, /\.click\(|dispatchEvent|\.value\s*=/);
});

test("HF64 package publishes v0.6.27 with serial B-code execution", async () => {
  const [route, page, planner, background] = await Promise.all([
    readFile(
      "src/app/api/shopling-stock-state-sync/download-hf64/route.ts",
      "utf8",
    ),
    readFile("src/app/china-order-manager/stock-control/page.tsx", "utf8"),
    readFile("src/lib/shoplingStockLaunchPlan.ts", "utf8"),
    readFile(backgroundPath, "utf8"),
  ]);
  assert.match(route, /const BASE_VERSION = "0\.6\.26"/);
  assert.match(route, /const VERSION = "0\.6\.27"/);
  assert.match(route, /maxConcurrentDispatchLanes: 1/);
  assert.match(route, /serialBcodeExecution: true/);
  assert.match(route, /a21WriteOwnerHandoffAllowed: false/);
  assert.match(page, /download-hf66/);
  assert.match(page, /v0\.6\.29 다운로드/);
  // HF64 stays downloadable for incident replay, while the live launch gate
  // advances when the intentionally incompatible HF65 API-first flow replaces it.
  assert.match(planner, /ALL_DATE_STOCK_SYNC_MIN_VERSION = \[0, 6, 29\]/);
  assert.doesNotMatch(planner, /mode: "PARALLEL",\s*jobs:/);
  assert.match(background, /HF64_EXACT_BCODE_RESULT_FRAME/);
});
