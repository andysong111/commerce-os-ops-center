import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function runPreflight({ authenticated = true, attempts = 1 } = {}) {
  const source = await readFile(
    "public/shopling-stock-state-sync/background-v088.js",
    "utf8",
  );
  const listeners = [];
  const storage = {};
  const tabs = [
    {
      id: 1,
      windowId: 10,
      active: true,
      lastAccessed: 100,
      url: "https://kt.shopling.co.kr/",
    },
  ];
  let workerReady = false;
  let windowCreates = 0;
  let exactMenuClicks = 0;
  let sourceNavigations = 0;
  const chrome = {
    runtime: {
      getManifest: () => ({ version: "0.6.30" }),
      onMessage: { addListener: (listener) => listeners.push(listener) },
    },
    storage: {
      local: {
        get: async (key) => ({ [key]: storage[key] }),
        set: async (value) => Object.assign(storage, value),
      },
    },
    tabs: {
      query: async ({ url }) => {
        const host = String(url).includes("kt.shopling.co.kr")
          ? "kt.shopling.co.kr"
          : "a.shopling.co.kr";
        return tabs.filter((tab) => new URL(tab.url).hostname === host);
      },
      get: async (tabId) => tabs.find((tab) => tab.id === tabId) || null,
      update: async () => {
        sourceNavigations += 1;
        return null;
      },
    },
    windows: {
      create: async ({ url }) => {
        windowCreates += 1;
        const tab = {
          id: 2,
          windowId: 20,
          active: false,
          lastAccessed: 200,
          url,
        };
        tabs.push(tab);
        return { id: 20, tabs: [tab] };
      },
    },
    scripting: {
      executeScript: async ({ target, world }) => {
        if (world === "MAIN") {
          assert.equal(target.tabId, 2);
          exactMenuClicks += 1;
          workerReady = true;
          return [{ frameId: 3, result: true }];
        }
        if (target.tabId === 1) {
          return [
            {
              frameId: 4,
              result: {
                authenticated,
                loginPage: !authenticated,
                exactA21: false,
                exactMenu: authenticated,
                href: "https://a.shopling.co.kr/main.phtml",
                title: "샵플링",
              },
            },
          ];
        }
        if (target.tabId === 2) {
          return [
            {
              frameId: 7,
              result: {
                authenticated,
                loginPage: false,
                exactA21: workerReady,
                exactMenu: !workerReady,
                href: workerReady
                  ? "https://a.shopling.co.kr/prodlinkage/goods_prod_join_list.phtml"
                  : "https://a.shopling.co.kr/main.phtml",
                title: "샵플링 쇼핑몰상품수정",
              },
            },
          ];
        }
        return [];
      },
    },
  };

  const legacyFind = async () => null;
  new Function(
    "chrome",
    "importScripts",
    "findExactRoleTarget",
    source,
  )(chrome, () => {}, legacyFind);
  const listener = listeners.at(-1);
  assert.equal(typeof listener, "function");
  const responses = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    responses.push(
      await new Promise((resolve) => {
        const asynchronous = listener(
          { type: "STOCK_SYNC_SESSION_PREFLIGHT_HF67" },
          {},
          resolve,
        );
        assert.equal(asynchronous, true);
      }),
    );
  }
  return {
    response: responses.at(-1),
    responses,
    storage,
    windowCreates,
    exactMenuClicks,
    sourceNavigations,
  };
}

test("HF67 reproduces the real kt admin-shell failure and prepares one owned A21 worker", async () => {
  const result = await runPreflight();
  assert.equal(result.response.ok, true);
  assert.equal(result.response.authenticated, true);
  assert.equal(result.response.sourceHost, "kt.shopling.co.kr");
  assert.equal(result.response.a21Ready, true);
  assert.equal(result.response.a21TabId, 2);
  assert.equal(result.response.a21FrameId, 7);
  assert.deepEqual(result.response.browserStagesPrepared, ["A21_LIST"]);
  assert.deepEqual(result.response.browserStagesSkipped, ["A4", "A6"]);
  assert.equal(result.response.noProductMutation, true);
  assert.equal(result.windowCreates, 1);
  assert.equal(result.exactMenuClicks, 1);
  assert.equal(result.sourceNavigations, 0);
  assert.equal(
    result.storage.commerceStockWorkspaceV030.targets.A21_LIST.owned,
    true,
  );
  assert.equal(
    result.storage.commerceStockWorkspaceV030.targets.A21_LIST
      .ownershipPolicy,
    "HF67_KT_ADMIN_EXACT_A21_WORKER",
  );
});

test("HF67 reuses the same exact A21 worker on a repeated preflight", async () => {
  const result = await runPreflight({ attempts: 2 });
  assert.equal(result.responses.length, 2);
  assert.equal(result.responses.every((response) => response.ok), true);
  assert.equal(result.windowCreates, 1);
  assert.equal(result.exactMenuClicks, 1);
  assert.equal(result.sourceNavigations, 0);
});

test("HF67 fails closed before worker creation when the kt admin session is logged out", async () => {
  const result = await runPreflight({ authenticated: false });
  assert.equal(result.response.ok, false);
  assert.equal(result.response.authenticated, false);
  assert.equal(result.response.code, "SHOPLING_LOGIN_REQUIRED_BEFORE_START");
  assert.equal(result.windowCreates, 0);
  assert.equal(result.exactMenuClicks, 0);
  assert.equal(result.sourceNavigations, 0);
  assert.equal(result.storage.commerceStockWorkspaceV030, undefined);
});

test("HF67 package advances the live gate and preserves API-only state writes", async () => {
  const [route, bridge, page, planner, preflight] = await Promise.all([
    readFile(
      "src/app/api/shopling-stock-state-sync/download-hf67/route.ts",
      "utf8",
    ),
    readFile(
      "public/shopling-stock-state-sync/content-ops-preflight-v003.js",
      "utf8",
    ),
    readFile("src/app/china-order-manager/stock-control/page.tsx", "utf8"),
    readFile("src/lib/shoplingStockLaunchPlan.ts", "utf8"),
    readFile("src/lib/shoplingStockSessionPreflight.ts", "utf8"),
  ]);
  assert.match(route, /getHf66Download/);
  assert.match(route, /const BASE_VERSION = "0\.6\.29"/);
  assert.match(route, /const VERSION = "0\.6\.30"/);
  assert.match(route, /API_ONLY_AFTER_A21_READY/);
  assert.match(route, /preMutationA21Preparation: true/);
  assert.match(bridge, /STOCK_SYNC_SESSION_PREFLIGHT_HF67/);
  assert.match(bridge, /stockSyncChannel: "HF67"/);
  assert.match(page, /download-hf67/);
  assert.match(page, /v0\.6\.30 다운로드/);
  assert.match(planner, /ALL_DATE_STOCK_SYNC_MIN_VERSION = \[0, 6, 30\]/);
  assert.match(preflight, /timeoutMs = 55_000/);
});
