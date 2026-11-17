import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { strFromU8, unzipSync } from "fflate";
import { patchHf86CanonicalListSource } from "../src/lib/shoplingStockHf86Patch.ts";
import {
  patchHf89BackgroundHf84ExplicitHandoff,
  patchHf89CanonicalPopupHandoff,
} from "../src/lib/shoplingStockHf89Patch.ts";

const baseZipPath =
  "public/shopling-stock-state-sync/fixtures/commerce-os-shopling-stock-state-v0.6.48-hf85.zip";

async function baseEntries() {
  return unzipSync(new Uint8Array(await readFile(baseZipPath)));
}

test("HF89 hands the exact popup ID from the trusted red click to the blue submit engine", async () => {
  const entries = await baseEntries();
  const trustedCanonical = patchHf86CanonicalListSource(
    strFromU8(entries["content-a21-canonical-v019.js"]),
  );
  const patched = patchHf89CanonicalPopupHandoff(trustedCanonical);
  const listWorker = patched.slice(
    patched.indexOf("async function selectRowsAndOpenPopup"),
    patched.indexOf("async function configureAndSubmitPopup"),
  );
  assert.match(listWorker, /A21_EXACT_POPUP_HANDOFF_HF89/);
  assert.match(listWorker, /popupTabId: Number\(modifySend\?\.popupTabId\)/);
  assert.match(listWorker, /popupHandoffHf89\?\.committed !== true/);
  assert.match(listWorker, /HF89_POPUP_HANDOFF_NOT_COMMITTED/);
  new Function(patched);
});
test("HF89 claims only the exact new popup before invoking the proven HF84 flow", async () => {
  const entries = await baseEntries();
  const patched = patchHf89BackgroundHf84ExplicitHandoff(
    strFromU8(entries["background-v095.js"]),
  );
  const explicit = patched.slice(
    patched.indexOf("__commerceOsHf84ExplicitPopupHandoff"),
    patched.indexOf("function scheduleHf84"),
  );
  assert.match(explicit, /binding\.claimedTabId = popupTabId/);
  assert.match(explicit, /await probeThenCommitHf84\(\)/);
  assert.match(explicit, /Number\(receipt\?\.popupTabId\) === popupTabId/);
  assert.match(explicit, /receipt\?\.shoplingSubmitInvoked === true/);
  assert.match(explicit, /HF89_EXACT_POPUP_BLUE_SUBMIT_COMMITTED/);
  new Function(patched);
});

async function backgroundHarness({ active, directResult }) {
  const source = await readFile(
    "public/shopling-stock-state-sync/background-v098.js",
    "utf8",
  );
  let listener = null;
  let directInput = null;
  const sandbox = {
    __COMMERCE_OS_EXPOSE_STOCK_HF89_TEST_HOOKS__: true,
    __commerceOsHf84ExplicitPopupHandoff: async (input) => {
      directInput = input;
      return directResult;
    },
  };
  const chrome = {
    runtime: {
      getManifest: () => ({ version: "0.6.52" }),
      onMessage: {
        addListener(value) {
          listener = value;
        },
      },
    },
  };
  new Function("globalThis", "chrome", "loadActive", "importScripts", source)(
    sandbox,
    chrome,
    async () => active,
    () => {},
  );
  return {
    listener,
    hooks: sandbox.__commerceOsStockHf89TestHooks,
    directInput: () => directInput,
  };
}

test("HF89 background accepts only the owned list sender and returns the blue-submit receipt", async () => {
  const active = {
    status: "RUNNING",
    job: { jobId: "hf89-job" },
    a21ExecutionWorkerHf76: { tabId: 42 },
  };
  const harness = await backgroundHarness({
    active,
    directResult: {
      ok: true,
      accepted: true,
      committed: true,
      code: "HF89_EXACT_POPUP_BLUE_SUBMIT_COMMITTED",
    },
  });
  const response = await new Promise((resolve) => {
    const kept = harness.listener(
      {
        type: "A21_EXACT_POPUP_HANDOFF_HF89",
        jobId: "hf89-job",
        popupTabId: 99,
        goodsKeys: ["116618", "116619"],
      },
      { tab: { id: 42 }, frameId: 0 },
      resolve,
    );
    assert.equal(kept, true);
  });
  assert.equal(response.ok, true);
  assert.equal(response.committed, true);
  assert.equal(response.exactPopupHandoff, true);
  assert.equal(response.extensionVersion, "0.6.52");
  assert.deepEqual(harness.directInput(), {
    jobId: "hf89-job",
    popupTabId: 99,
    expectedListTabId: 42,
    goodsKeys: ["116618", "116619"],
    extensionVersion: "0.6.52",
  });
});

test("HF89 rejects a popup handoff from an unrelated Shopling list window", async () => {
  const harness = await backgroundHarness({
    active: {
      status: "RUNNING",
      job: { jobId: "hf89-job" },
      a21ExecutionWorkerHf76: { tabId: 42 },
    },
    directResult: { ok: true, committed: true },
  });
  const response = await harness.hooks.handoffExactPopupHf89(
    { jobId: "hf89-job", popupTabId: 99 },
    { tab: { id: 77 }, frameId: 0 },
  );
  assert.equal(response.ok, false);
  assert.equal(response.code, "HF89_EXACT_POPUP_HANDOFF_OWNER_MISMATCH");
  assert.equal(harness.directInput(), null);
});

test("HF89 package stays reproducible while the stock-control gate advances to HF90", async () => {
  const [route, page, planner, workflow] = await Promise.all([
    readFile("src/app/api/shopling-stock-state-sync/download-hf89/route.ts", "utf8"),
    readFile("src/app/china-order-manager/stock-control/page.tsx", "utf8"),
    readFile("src/lib/shoplingStockLaunchPlan.ts", "utf8"),
    readFile(".github/workflows/shopling-stock-state-sync-ci.yml", "utf8"),
  ]);
  assert.match(route, /const BASE_VERSION = "0\.6\.51"/);
  assert.match(route, /const VERSION = "0\.6\.52"/);
  assert.match(route, /EXACT_POPUP_ID_DIRECT_TO_PROVEN_HF84_COMMIT/);
  assert.match(page, /download-hf92/);
  assert.match(page, /v0\.6\.54 다운로드/);
  assert.match(planner, /ALL_DATE_STOCK_SYNC_MIN_VERSION = \[0, 6, 54\]/);
  assert.match(workflow, /shoplingStockStateHf89\.test\.mjs/);
});
