import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("HF54 packages v0.6.19 with a bounded parallel read-only login preflight", async () => {
  const [route, background, bridge, page, planner, preflight] =
    await Promise.all([
      readFile(
        "src/app/api/shopling-stock-state-sync/download-hf54/route.ts",
        "utf8",
      ),
      readFile("public/shopling-stock-state-sync/background-v078.js", "utf8"),
      readFile(
        "public/shopling-stock-state-sync/content-ops-preflight-v002.js",
        "utf8",
      ),
      readFile("src/app/china-order-manager/stock-control/page.tsx", "utf8"),
      readFile("src/lib/shoplingStockLaunchPlan.ts", "utf8"),
      readFile("src/lib/shoplingStockSessionPreflight.ts", "utf8"),
    ]);

  assert.match(route, /getHf53Download/);
  assert.match(route, /const BASE_VERSION = "0\.6\.18"/);
  assert.match(route, /const VERSION = "0\.6\.19"/);
  assert.match(route, /concurrentRecentTabPreflight: true/);
  assert.match(route, /noShoplingWrite: true/);
  assert.match(background, /importScripts\("background-v077\.js"\)/);
  assert.match(background, /Promise\.all\(candidates\.map\(inspectTab\)\)/);
  assert.match(background, /const MAX_RECENT_TABS = 32/);
  assert.match(background, /const PER_TAB_TIMEOUT_MS = 2_500/);
  assert.match(bridge, /STOCK_SYNC_SESSION_PREFLIGHT_HF54/);
  assert.match(bridge, /stockSyncChannel: "HF54"/);
  assert.match(page, /download-hf63/);
  assert.match(page, /v0\.6\.26 다운로드/);
  assert.match(planner, /ALL_DATE_STOCK_SYNC_MIN_VERSION = \[0, 6, 26\]/);
  assert.match(preflight, /자동화 확장 v0\.6\.26 연결/);
});

async function runHf54Preflight({ tabCount, authenticatedTabId }) {
  const source = await readFile(
    "public/shopling-stock-state-sync/background-v078.js",
    "utf8",
  );
  const listeners = [];
  let inFlight = 0;
  let maxInFlight = 0;
  let executeCount = 0;
  const tabs = Array.from({ length: tabCount }, (_, index) => ({
    id: index + 1,
    active: index === tabCount - 1,
    lastAccessed: index + 1,
    url: `https://a.shopling.co.kr/admin/${index + 1}`,
  }));
  const chrome = {
    runtime: {
      onMessage: { addListener: (listener) => listeners.push(listener) },
    },
    tabs: {
      query: async () => tabs,
    },
    scripting: {
      executeScript: async ({ target }) => {
        executeCount += 1;
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 10));
        inFlight -= 1;
        return [
          {
            result: {
              authenticated: target.tabId === authenticatedTabId,
              loginPage: false,
            },
          },
        ];
      },
    },
  };
  new Function("chrome", "importScripts", source)(chrome, () => {});
  const listener = listeners.at(-1);
  assert.equal(typeof listener, "function");
  const response = await new Promise((resolve) => {
    const async = listener(
      { type: "STOCK_SYNC_SESSION_PREFLIGHT_HF54" },
      {},
      resolve,
    );
    assert.equal(async, true);
  });
  return { response, executeCount, maxInFlight };
}

test("HF54 inspects twenty retained Shopling tabs concurrently and finds the active login", async () => {
  const { response, executeCount, maxInFlight } = await runHf54Preflight({
    tabCount: 20,
    authenticatedTabId: 20,
  });
  assert.equal(response.ok, true);
  assert.equal(response.authenticated, true);
  assert.equal(response.tabId, 20);
  assert.equal(response.checkedTabCount, 20);
  assert.equal(response.inspectedTabCount, 20);
  assert.equal(response.parallelInspection, true);
  assert.equal(executeCount, 20);
  assert.ok(maxInFlight > 1, `expected concurrent inspection, got ${maxInFlight}`);
});

test("HF54 fails closed without any Shopling mutation when no authenticated tab exists", async () => {
  const { response, executeCount, maxInFlight } = await runHf54Preflight({
    tabCount: 8,
    authenticatedTabId: null,
  });
  assert.equal(response.ok, false);
  assert.equal(response.authenticated, false);
  assert.equal(response.code, "SHOPLING_LOGIN_REQUIRED_BEFORE_START");
  assert.equal(response.parallelInspection, true);
  assert.equal(executeCount, 8);
  assert.ok(maxInFlight > 1);
});
