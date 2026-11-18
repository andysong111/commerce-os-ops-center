import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function createHarness({
  openerTabId = 42,
  popupUrl =
    "https://a.shopling.co.kr/prodlinkage/goods_mallMdfy_trsmt.phtml?goods=1",
  directResult = {
    ok: true,
    accepted: true,
    committed: true,
    receipt: { shoplingSubmitInvoked: true },
  },
} = {}) {
  const source = await readFile(
    "public/shopling-stock-state-sync/background-v099.js",
    "utf8",
  );
  let active = {
    status: "RUNNING",
    stage: "A21_LIST",
    job: { jobId: "hf90-job", barcode: "BDE7-2" },
    a21ExecutionWorkerHf76: { tabId: 42 },
    workTabs: { A21_LIST: { tabId: 42, frameId: 0 } },
    a21PopupOwnershipHf81: { assignmentOwnerKey: "hf90-owner" },
  };
  let ownerAtDirectHandoff = null;
  const sandbox = {
    __COMMERCE_OS_EXPOSE_STOCK_HF90_TEST_HOOKS__: true,
    __commerceOsHf84ExplicitPopupHandoff: async () => {
      ownerAtDirectHandoff = active.workTabs?.A21_POPUP || null;
      active = {
        ...active,
        stage: "WAIT_A21_RESULT",
        lastMileReceiptHf84: {
          popupTabId: 99,
          shoplingSubmitInvoked: true,
          topChecked: true,
          targetChecked: true,
        },
      };
      return directResult;
    },
  };
  const chrome = {
    runtime: { getManifest: () => ({ version: "0.6.53" }) },
    tabs: {
      get: async (tabId) =>
        tabId === 99
          ? {
              id: 99,
              windowId: 7,
              openerTabId,
              url: popupUrl,
            }
          : null,
    },
  };
  const loadActive = async () => active;
  const saveActive = async (value) => {
    active = value;
  };
  new Function(
    "globalThis",
    "chrome",
    "loadActive",
    "saveActive",
    "importScripts",
    source,
  )(sandbox, chrome, loadActive, saveActive, () => {});
  return {
    sandbox,
    active: () => active,
    ownerAtDirectHandoff: () => ownerAtDirectHandoff,
  };
}

test("HF90 persists the exact trusted popup owner before invoking the blue submit", async () => {
  const harness = await createHarness();
  const result = await harness.sandbox.__commerceOsHf84ExplicitPopupHandoff({
    jobId: "hf90-job",
    popupTabId: 99,
    expectedListTabId: 42,
  });

  assert.equal(result.ok, true);
  assert.equal(result.committed, true);
  assert.equal(result.exactOwnerBoundHf90, true);
  assert.equal(result.committedReceiptPersisted, true);
  assert.equal(result.externalWriteConfirmed, true);
  assert.equal(result.retrySafe, false);
  assert.deepEqual(harness.ownerAtDirectHandoff(), {
    tabId: 99,
    frameId: 0,
    windowId: 7,
    openerTabId: 42,
    assignmentOwnerKey: "hf90-owner",
    establishedBy: "HF90_EXACT_TRUSTED_POPUP_HANDOFF",
    establishedAt: harness.ownerAtDirectHandoff().establishedAt,
  });
  assert.equal(harness.active().workTabs.A21_POPUP.tabId, 99);
  assert.equal(
    harness.active().shoplingDispatchReceiptHf90.code,
    "HF90_EXACT_POPUP_BLUE_SUBMIT_COMMITTED_AND_OWNED",
  );
  assert.equal(
    harness.active().shoplingDispatchReceiptHf90.externalWriteConfirmed,
    true,
  );
  assert.equal(harness.active().shoplingDispatchReceiptHf90.retrySafe, false);
});

test("HF90 rejects a popup whose opener belongs to another A21 list", async () => {
  const harness = await createHarness({ openerTabId: 77 });
  const result = await harness.sandbox.__commerceOsHf84ExplicitPopupHandoff({
    jobId: "hf90-job",
    popupTabId: 99,
    expectedListTabId: 42,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "HF90_EXACT_POPUP_OWNER_CHAIN_MISMATCH");
  assert.equal(harness.ownerAtDirectHandoff(), null);
  assert.equal(harness.active().workTabs.A21_POPUP, undefined);
});

test("HF90 package remains traceable while the stock-control gate advances beyond v0.6.53", async () => {
  const [background, route, page, planner, workflow] = await Promise.all([
    readFile("public/shopling-stock-state-sync/background-v099.js", "utf8"),
    readFile(
      "src/app/api/shopling-stock-state-sync/download-hf90/route.ts",
      "utf8",
    ),
    readFile("src/app/china-order-manager/stock-control/page.tsx", "utf8"),
    readFile("src/lib/shoplingStockLaunchPlan.ts", "utf8"),
    readFile(".github/workflows/shopling-stock-state-sync-ci.yml", "utf8"),
  ]);

  assert.match(background, /importScripts\("background-v098\.js"\)/);
  assert.match(background, /active\.workTabs\.A21_POPUP/);
  assert.match(background, /externalWriteConfirmed: true/);
  assert.match(background, /retrySafe: false/);
  assert.match(route, /const BASE_VERSION = "0\.6\.52"/);
  assert.match(route, /const VERSION = "0\.6\.53"/);
  assert.match(route, /PROVEN_HF60_HF72_PROCESSING_OR_RESULT_OWNER_CHAIN/);
  assert.match(page, /download-hf96/);
  assert.match(page, /v0\.6\.58 다운로드/);
  assert.match(planner, /ALL_DATE_STOCK_SYNC_MIN_VERSION = \[0, 6, 58\]/);
  assert.match(workflow, /shoplingStockStateHf90\.test\.mjs/);
});
