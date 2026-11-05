import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { patchHf74CanonicalListSource } from "../src/lib/shoplingStockHf74Patch.ts";
import { patchHf75CanonicalListSource } from "../src/lib/shoplingStockHf75Patch.ts";

test("HF75 creates a fresh exact A21 worker and reuses it only inside one B-code execution", async () => {
  const source = await readFile(
    "public/shopling-stock-state-sync/background-v094.js",
    "utf8",
  );
  const tabs = new Map([
    [10, { id: 10, windowId: 1 }],
    [20, { id: 20, windowId: 2 }],
  ]);
  const storage = {};
  let createdWindows = 0;
  let savedActive = 0;
  const sandbox = { __COMMERCE_OS_EXPOSE_STOCK_HF75_TEST_HOOKS__: true };
  new Function(
    "globalThis",
    "importScripts",
    "chrome",
    "dispatchCurrent",
    "dispatchToTarget",
    "saveActive",
    "progress",
    "sleep",
    source,
  )(
    sandbox,
    () => {},
    {
      runtime: { getManifest: () => ({ version: "0.6.38" }) },
      tabs: {
        get: async (id) => tabs.get(id) || null,
        remove: async (id) => tabs.delete(id),
      },
      windows: {
        create: async ({ url, type, focused }) => {
          createdWindows += 1;
          assert.equal(url, "https://kt.shopling.co.kr/prodlinkage/goods_prod_join_list.phtml");
          assert.equal(type, "popup");
          assert.equal(focused, false);
          return { id: 2, tabs: [{ id: 20 }] };
        },
      },
      scripting: {
        executeScript: async ({ target }) => [{
          frameId: 0,
          result: {
            exactA21: target.tabId === 10 || target.tabId === 20,
            href: "https://kt.shopling.co.kr/prodlinkage/goods_prod_join_list.phtml",
            title: "샵플링 쇼핑몰상품수정",
          },
        }],
      },
      storage: {
        local: {
          get: async (key) => ({ [key]: storage[key] }),
          set: async (value) => Object.assign(storage, value),
        },
      },
    },
    () => false,
    () => false,
    async () => { savedActive += 1; },
    async () => {},
    async () => {},
  );

  const active = {
    status: "RUNNING",
    stage: "A21_LIST",
    job: {
      jobId: "bbc4-3",
      executionId: "run-75",
      barcode: "BBC4-3",
      stockStateApiApplied: true,
      stockStateTransmissionGroupsHf72: [{ goodsKeys: ["111882"] }],
    },
  };
  const template = {
    tabId: 10,
    frameId: 0,
    page: { href: "https://kt.shopling.co.kr/prodlinkage/goods_prod_join_list.phtml" },
  };
  const hooks = sandbox.__commerceOsStockHf75TestHooks;
  const worker = await hooks.ensureExecutionWorkerV094(active, template);
  assert.equal(worker.tabId, 20);
  assert.notEqual(worker.tabId, template.tabId);
  assert.equal(active.workTabs.A21_LIST.tabId, 20);
  assert.equal(active.a21ExecutionWorkerHf75.ownerKey, "bbc4-3:run-75");
  assert.equal(storage.commerceStockExecutionWorkerHf75.tabId, 20);
  assert.equal(createdWindows, 1);
  assert.equal(savedActive, 1);

  const repeated = await hooks.ensureExecutionWorkerV094(active, template);
  assert.equal(repeated.tabId, 20);
  assert.equal(createdWindows, 1);
  assert.match(source, /legacyDispatchToTargetV094\(active, worker\)/);
  new Function(source);
});

test("HF75 rejects the live stale-query incident before selecting rows or opening a popup", async () => {
  const base = await readFile(
    "public/shopling-a21-price-option-resend/content-a21.js",
    "utf8",
  );
  const source = patchHf75CanonicalListSource(
    patchHf74CanonicalListSource(base),
  );
  const sandbox = { __COMMERCE_OS_EXPOSE_A21_V018_TEST_HOOKS__: true };
  const window = { name: "", setTimeout };
  new Function(
    "globalThis",
    "document",
    "window",
    "HTMLElement",
    "HTMLInputElement",
    "HTMLImageElement",
    "CustomEvent",
    "Event",
    "setTimeout",
    source,
  )(
    sandbox,
    { querySelectorAll: () => [] },
    window,
    class {},
    class {},
    class {},
    class {},
    class {},
    setTimeout,
  );
  const hooks = sandbox.__commerceOsA21V018TestHooks;
  const staleKeys = [
    "111882", "111883", "111884", "112206", "112354", "115072", "115241",
    "115409", "122554", "122555", "122557", "122559", "122561", "122563",
  ];
  const current = {
    jobId: "bbc4-3",
    mode: "OPTION",
    runId: "run-current",
    stage: "SEARCH_SUBMITTED",
    goodsKeys: ["130001", "130002"],
  };
  const staleMarker = hooks.assignmentFromMarker(hooks.encodeAssignment({
    ...current,
    jobId: "bbc4-2",
    runId: "run-stale",
    goodsKeys: staleKeys,
  }));
  assert.equal(hooks.markerOwnsAssignmentHf75(staleMarker, current), false);
  const currentMarker = hooks.assignmentFromMarker(hooks.encodeAssignment(current));
  assert.equal(hooks.markerOwnsAssignmentHf75(currentMarker, current), true);

  const selection = source.slice(
    source.indexOf("async function selectRowsAndOpenPopup"),
    source.indexOf("async function configureAndSubmitPopup"),
  );
  assert.ok(
    selection.indexOf("verifyListAssignmentOwnershipHf75") <
      selection.indexOf("waitForSearchResultEvidence"),
  );
  const listener = source.slice(source.indexOf("chrome.runtime.onMessage.addListener"));
  assert.doesNotMatch(
    listener,
    /if \(message\?\.type === "A21_LIST_ASSIGNMENT"\) \{\s*markWorker\(message\)/,
  );
  assert.match(source, /A21_LIST_QUERY_OWNER_MISMATCH_HF75/);
  new Function(source);
});

test("HF75 download contract exposes v0.6.38 with fresh-worker and exact-query guards", async () => {
  const [route, page, planner] = await Promise.all([
    readFile("src/app/api/shopling-stock-state-sync/download-hf75/route.ts", "utf8"),
    readFile("src/app/china-order-manager/stock-control/page.tsx", "utf8"),
    readFile("src/lib/shoplingStockLaunchPlan.ts", "utf8"),
  ]);
  assert.match(route, /const BASE_VERSION = "0\.6\.37"/);
  assert.match(route, /const VERSION = "0\.6\.38"/);
  assert.match(route, /ONE_FRESH_EXACT_A21_WORKER_PER_B_CODE/);
  assert.match(route, /OWNER_MARKER_AND_EXACT_GOODS_KEY_QUERY_REQUIRED/);
  assert.match(page, /download-hf75/);
  assert.match(page, /v0\.6\.38 다운로드/);
  assert.match(planner, /ALL_DATE_STOCK_SYNC_MIN_VERSION = \[0, 6, 38\]/);
});
