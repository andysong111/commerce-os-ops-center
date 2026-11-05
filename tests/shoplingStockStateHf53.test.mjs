import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("HF53 packages v0.6.18 and requires stale-popup preflight before Shopling click", async () => {
  const [route, patch, background, page, planner] = await Promise.all([
    readFile(
      "src/app/api/shopling-stock-state-sync/download-hf53/route.ts",
      "utf8",
    ),
    readFile("src/lib/shoplingStockHf53Patch.ts", "utf8"),
    readFile("public/shopling-stock-state-sync/background-v077.js", "utf8"),
    readFile("src/app/china-order-manager/stock-control/page.tsx", "utf8"),
    readFile("src/lib/shoplingStockLaunchPlan.ts", "utf8"),
  ]);

  assert.match(route, /getHf52Download/);
  assert.match(route, /const BASE_VERSION = "0\.6\.17"/);
  assert.match(route, /const VERSION = "0\.6\.18"/);
  assert.match(route, /ambiguousExistingPopupBlocked: true/);
  assert.match(patch, /A21_STALE_POPUP_PREFLIGHT_HF53/);
  assert.ok(
    patch.lastIndexOf("const stalePopupPreflightHf53") <
      patch.lastIndexOf("const popupOpeningStageHf47"),
  );
  assert.match(background, /importScripts\("background-v076\.js"\)/);
  assert.match(background, /safeStalePreSubmit/);
  assert.match(background, /ambiguousPopupClosed: false/);
  assert.match(background, /priorA21TransmissionSubmitted: false/);
  assert.match(page, /download-hf73/);
  assert.match(page, /v0\.6\.35 다운로드/);
  assert.match(planner, /ALL_DATE_STOCK_SYNC_MIN_VERSION = \[0, 6, 35\]/);
});

async function runPreflight(frameResult) {
  const source = await readFile(
    "public/shopling-stock-state-sync/background-v077.js",
    "utf8",
  );
  let popupPresent = true;
  const removed = [];
  const listeners = [];
  const chrome = {
    runtime: {
      getManifest: () => ({ version: "0.6.18" }),
      onMessage: { addListener: (listener) => listeners.push(listener) },
    },
    tabs: {
      query: async (query) => {
        if (query?.url) {
          return popupPresent
            ? [
                {
                  id: 417,
                  url: "https://a.shopling.co.kr/prodlinkage/goods_mallMdfy_trsmt.phtml",
                },
              ]
            : [];
        }
        return [];
      },
      remove: async (tabId) => {
        removed.push(tabId);
        popupPresent = false;
      },
      get: async (tabId) =>
        popupPresent && tabId === 417 ? { id: tabId } : null,
    },
    scripting: {
      executeScript: async () => [{ result: frameResult }],
    },
  };
  const active = {
    status: "RUNNING",
    stage: "A21_LIST",
    job: {
      jobId: "stock-resend:incident:BBA7-1:SOLD_OUT",
      barcode: "BBA7-1",
      productKind: "SINGLE",
    },
  };
  const loadActive = async () => active;
  const finish = async () => null;
  new Function(
    "chrome",
    "importScripts",
    "setTimeout",
    "loadActive",
    "finish",
    source,
  )(chrome, () => {}, () => 1, loadActive, finish);

  const listener = listeners.at(-1);
  assert.equal(typeof listener, "function");
  const response = await new Promise((resolve) => {
    const async = listener(
      {
        type: "A21_STALE_POPUP_PREFLIGHT_HF53",
        jobId: active.job.jobId,
      },
      {},
      resolve,
    );
    assert.equal(async, true);
  });
  return { response, removed };
}

test("HF53 closes only the exact stale default pre-submit popup", async () => {
  const { response, removed } = await runPreflight({
    terminal: false,
    processing: false,
    staleMarker: true,
    hasTransmitForm: true,
    generalChecked: true,
    mutationModeChecked: false,
    checkedRadios: ["일반내용수정"],
  });
  assert.equal(response.ok, true);
  assert.deepEqual(response.closedSafeStalePopupTabIds, [417]);
  assert.equal(response.ambiguousPopupClosed, false);
  assert.deepEqual(removed, [417]);
});

test("HF53 fails closed and preserves an ambiguous or processing popup", async () => {
  const { response, removed } = await runPreflight({
    terminal: false,
    processing: true,
    staleMarker: true,
    hasTransmitForm: true,
    generalChecked: true,
    mutationModeChecked: false,
    checkedRadios: ["일반내용수정"],
  });
  assert.equal(response.ok, false);
  assert.equal(response.code, "A21_EXISTING_POPUP_NOT_SAFE_TO_CLOSE_HF53");
  assert.deepEqual(removed, []);
});

test("HF53 allowlists only the exact BBA7-1 terminal recovery incident", async () => {
  const route = await readFile(
    "src/app/api/inventory-stock-control/sync/route.ts",
    "utf8",
  );
  assert.match(route, /"BBA7-1"/);
  assert.match(route, /shopling-bba7-1-hf53-terminal-20261102/);
  assert.match(route, /latestSyncAt: "2026-11-02T03:29:04\.745Z"/);
  assert.match(
    route,
    /owner-retry-20261102032732917-926c5f41-9761-482a-a74b-3e51ae8da686/,
  );
  assert.match(route, /recoveredWithoutShoplingResend: true/);
});
