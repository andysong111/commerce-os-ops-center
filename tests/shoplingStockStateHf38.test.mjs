import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { patchShoplingStockHf38Background } from "../src/lib/shoplingStockHf38Patch.ts";

async function incidentFixture({ freshPopupIds }) {
  const legacy = await readFile(
    "public/shopling-stock-state-sync/background-v030.js",
    "utf8",
  );
  const patched = patchShoplingStockHf38Background(legacy);
  const storage = {};
  const tabs = new Map([
    [1, { id: 1, windowId: 1, url: "https://a.shopling.co.kr/", openerTabId: undefined }],
    // This is a stale A6 tab that existed before the current menu click. The real
    // incident had open Shopling work tabs, so it must never be adopted.
    [9, { id: 9, windowId: 9, url: "https://a.shopling.co.kr/prod/prodBulkOptLst.phtml?popup=Y", openerTabId: 77 }],
  ]);
  let menuClicked = false;
  let menuClickCount = 0;

  const roleFor = (tabId) => {
    if (tabId === 1) return { role: "OTHER", authenticated: true };
    if (tabId === 10) {
      return {
        role: "A21_LIST",
        authenticated: true,
        hasGoodsKey: true,
        hasOptionBarcode: false,
      };
    }
    return {
      role: "A6",
      authenticated: true,
      hasGoodsKey: false,
      hasOptionBarcode: true,
    };
  };

  const chrome = {
    storage: {
      local: {
        async get(key) { return { [key]: storage[key] }; },
        async set(value) { Object.assign(storage, value); },
      },
    },
    windows: {
      async create() {
        const root = { id: 10, windowId: 10, url: "https://a.shopling.co.kr/prod/prodLst.phtml", openerTabId: 1 };
        tabs.set(root.id, root);
        return { id: 10, tabs: [root] };
      },
    },
    tabs: {
      async get(tabId) { return tabs.get(tabId) || null; },
      async sendMessage(_tabId, message) {
        return { ok: true, page: { role: message.expectedRole } };
      },
    },
    scripting: {
      async executeScript(request) {
        if (request.world === "MAIN") {
          menuClickCount += 1;
          if (!menuClicked) {
            menuClicked = true;
            for (const popupId of freshPopupIds) {
              tabs.set(popupId, {
                id: popupId,
                windowId: popupId,
                url: "https://a.shopling.co.kr/prod/prodBulkOptLst.phtml?popup=Y",
                openerTabId: 10,
              });
            }
          }
          return [{ frameId: 0, result: true }];
        }
        if (request.target?.allFrames) {
          const role = roleFor(request.target.tabId);
          return [{
            frameId: 0,
            result: {
              ...role,
              href: tabs.get(request.target.tabId)?.url || "",
              title: role.role,
              ready: "complete",
              optionLabels: [],
              textSample: role.role,
            },
          }];
        }
        if (request.target?.frameIds) return [{ frameId: 0, result: { ok: true } }];
        return [];
      },
    },
  };

  const prelude = `
    let findExactRoleTarget = null;
    let preflightWorkTabs = null;
    let dispatchToTarget = null;
    const expectedRole = (stage) => stage;
    const requiredStages = () => ["A6"];
    const saveActive = async () => null;
    const sleep = async () => null;
    const shoplingTabs = async () => [...chrome.__tabs.values()];
  `;
  chrome.__tabs = tabs;
  const factory = new Function(
    "chrome",
    "importScripts",
    `${prelude}\n${patched}\nreturn { preflightWorkTabs };`,
  );
  const runtime = factory(chrome, () => undefined);
  const result = await runtime.preflightWorkTabs({
    jobId: "incident-a6-popup",
    productKind: "OPTION",
  });
  return { result, storage, menuClickCount, patched };
}

test("HF38 claims the fresh A6 popup instead of polling only the A21-like launcher", async () => {
  const fixture = await incidentFixture({ freshPopupIds: [11] });
  assert.equal(fixture.result.ok, true);
  assert.equal(fixture.result.targets.A6.tabId, 11);
  assert.notEqual(fixture.result.targets.A6.tabId, 9);
  assert.equal(fixture.menuClickCount, 1);
  assert.equal(
    fixture.storage.commerceStockWorkspaceV030.targets.A6.ownershipPolicy,
    "HF38_FRESH_POPUP_EXACT_ROLE_AND_OPENER",
  );
});

test("HF38 fails closed when one menu click creates multiple exact A6 popups", async () => {
  const fixture = await incidentFixture({ freshPopupIds: [11, 12] });
  assert.equal(fixture.result.ok, false);
  assert.equal(fixture.result.code, "SHOPLING_AUTO_WORKSPACE_FAILED");
  assert.match(fixture.result.message, /HF38_FRESH_POPUP_AMBIGUOUS/);
  assert.equal(fixture.menuClickCount, 1);
});

test("HF38 remains v0.6.6 while the UI requires HF41 and preserves the package chain", async () => {
  const [route, page, planner, queue, hiddenBrowserCheck, workflow] = await Promise.all([
    readFile("src/app/api/shopling-stock-state-sync/download-hf38/route.ts", "utf8"),
    readFile("src/app/china-order-manager/stock-control/page.tsx", "utf8"),
    readFile("src/lib/shoplingStockLaunchPlan.ts", "utf8"),
    readFile("src/components/china-order-manager/StockSyncOperationalQueuePanel.tsx", "utf8"),
    readFile("scripts/inventory-ui-hidden-check.mjs", "utf8"),
    readFile(".github/workflows/shopling-stock-state-sync-ci.yml", "utf8"),
  ]);
  assert.match(route, /getHf37Download/);
  assert.match(route, /const VERSION = "0\.6\.6"/);
  assert.match(route, /HF38_FRESH_OWNED_A6_POPUP_HANDOFF/);
  assert.match(page, /download-hf41/);
  assert.match(page, /v0\.6\.9 다운로드/);
  assert.match(planner, /ALL_DATE_STOCK_SYNC_MIN_VERSION = \[0, 6, 9\]/);
  assert.match(queue, /v0\.6\.9로 업데이트/);
  assert.match(hiddenBrowserCheck, /extensionVersion: '0\.6\.9'/);
  assert.match(workflow, /shoplingStockStateHf38\.test\.mjs/);
});
