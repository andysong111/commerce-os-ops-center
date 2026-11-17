import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { strFromU8, unzipSync } from "fflate";
import { patchHf89BackgroundHf84ExplicitHandoff } from "../src/lib/shoplingStockHf89Patch.ts";
import {
  patchHf92ExactPopupDirectCommit,
  patchHf92TrustedClickDetachedReceipt,
} from "../src/lib/shoplingStockHf92Patch.ts";

async function trustedClickHarness({ popupAfterDetach }) {
  const original = await readFile(
    "public/shopling-stock-state-sync/background-v096.js",
    "utf8",
  );
  const source = patchHf92TrustedClickDetachedReceipt(original);
  let queryCount = 0;
  let detached = false;
  const sandbox = {
    __COMMERCE_OS_EXPOSE_STOCK_HF92_TRUSTED_TEST_HOOKS__: true,
  };
  const chrome = {
    runtime: {
      onMessage: { addListener: () => {} },
    },
    scripting: {
      executeScript: async () => [
        {
          frameId: 0,
          result: {
            ok: true,
            x: 120,
            y: 80,
            width: 100,
            height: 30,
            onclick: "goods_mallMody_submit()",
          },
        },
      ],
    },
    tabs: {
      query: async () => {
        queryCount += 1;
        if (popupAfterDetach && detached && queryCount >= 2) {
          return [
            {
              id: 99,
              windowId: 7,
              openerTabId: 42,
              url: "https://a.shopling.co.kr/prodlinkage/goods_mallMdfy_trsmt.phtml?goods=1",
            },
          ];
        }
        return [];
      },
    },
    debugger: {
      attach: async () => {},
      detach: async () => {},
      sendCommand: async () => {
        detached = true;
        throw new Error("Detached while handling command.");
      },
    },
  };
  const active = {
    status: "RUNNING",
    stage: "A21_LIST",
    job: { jobId: "hf92-job", barcode: "BDE7-2" },
    a21ExecutionWorkerHf76: { tabId: 42 },
    workTabs: { A21_LIST: { tabId: 42, frameId: 0 } },
  };
  new Function(
    "globalThis",
    "chrome",
    "loadActive",
    "importScripts",
    "setTimeout",
    source,
  )(
    sandbox,
    chrome,
    async () => active,
    () => {},
    (resolve) => {
      resolve();
      return 1;
    },
  );
  const result = await sandbox.__commerceOsStockHf92TrustedTestHooks.trustedClickHf86(
    { jobId: "hf92-job", expectedHandler: "goods_mallMody_submit" },
    { tab: { id: 42 }, frameId: 0 },
  );
  return { result, queryCount, source };
}

test("HF92 accepts the exact new popup as the receipt when CDP detaches after the trusted click", async () => {
  const { result, queryCount } = await trustedClickHarness({
    popupAfterDetach: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.popupObserved, true);
  assert.equal(result.popupTabId, 99);
  assert.equal(result.dispatchDetachedRecovered, true);
  assert.equal(
    result.code,
    "HF92_TRUSTED_CLICK_DETACHED_POPUP_CONFIRMED",
  );
  assert.match(result.dispatchError, /Detached while handling command/);
  assert.ok(queryCount >= 2);
});

test("HF92 reports a retry-safe failure when CDP detaches and no exact popup exists", async () => {
  const { result } = await trustedClickHarness({ popupAfterDetach: false });

  assert.equal(result.ok, false);
  assert.equal(result.code, "HF86_TRUSTED_CLICK_DISPATCH_FAILED");
  assert.equal(result.retrySafe, true);
  assert.equal(result.popupObserved, false);
  assert.match(result.message, /Detached while handling command/);
});

test("HF92 directly probes and commits the exact owned popup without the shared HF84 scanner lock", async () => {
  const fixture = unzipSync(
    new Uint8Array(
      await readFile(
        "public/shopling-stock-state-sync/fixtures/commerce-os-shopling-stock-state-v0.6.48-hf85.zip",
      ),
    ),
  );
  const hf85 = strFromU8(fixture["background-v095.js"]);
  const hf89 = patchHf89BackgroundHf84ExplicitHandoff(hf85);
  const hf92 = patchHf92ExactPopupDirectCommit(hf89);
  new Function(hf92);

  const start = hf92.indexOf(
    "globalThis.__commerceOsHf84ExplicitPopupHandoff = async function explicitPopupHandoffHf92",
  );
  const end = hf92.indexOf("function scheduleHf84", start);
  const handoff = hf92.slice(start, end);
  assert.match(handoff, /target: \{ tabId: popupTabId, allFrames: true \}/);
  assert.match(handoff, /func: probeLastMileHf84/);
  assert.match(handoff, /target: \{ tabId: popupTabId, frameIds: \[frameId\] \}/);
  assert.match(handoff, /func: commitLastMileHf84/);
  assert.match(handoff, /current\.stage = "WAIT_A21_RESULT"/);
  assert.match(handoff, /SHOPLING_HF92_EXACT_POPUP_DIRECT_COMMITTED/);
  assert.doesNotMatch(handoff, /probeThenCommitHf84\(\)/);

  let active = {
    status: "RUNNING",
    stage: "A21_LIST",
    job: {
      jobId: "hf92-direct-job",
      barcode: "BDE7-2",
      productKind: "OPTION",
      desiredStatus: "ON_SALE",
    },
    a21PopupOwnershipHf81: {
      assignmentOwnerKey: "hf92-owner",
      claimedTabId: 99,
    },
  };
  const progressEvents = [];
  const sandbox = {};
  const chrome = {
    runtime: { getManifest: () => ({ version: "0.6.54" }) },
    tabs: {
      get: async () => ({
        id: 99,
        url: "https://a.shopling.co.kr/prodlinkage/goods_mallMdfy_trsmt.phtml?goods=1",
      }),
    },
    scripting: {
      executeScript: async ({ target, args }) => {
        if (target.allFrames) {
          return [{ frameId: 3, result: { eligible: true } }];
        }
        return [
          {
            frameId: 3,
            result: {
              ok: true,
              receiptKey: args[0].receiptKey,
              shoplingSubmitInvoked: true,
              topChecked: true,
              targetChecked: true,
              targetEnabledAfterMode: true,
              duplicate: false,
              submitDispatchMethod: "ORIGINAL_SHOPLING_FUNCTION",
              topLabel: "옵션송신",
              targetLabel: "선택",
            },
          },
        ];
      },
    },
  };
  new Function(
    "globalThis",
    "loadActive",
    "saveActive",
    "chrome",
    "exactPopupUrlHf84",
    "bindingMatchesHf84",
    "receiptKeyHf84",
    "READY_TIMEOUT_MS_HF84",
    "probeLastMileHf84",
    "commitLastMileHf84",
    "committedHf84",
    "readinessHf84",
    "batchQueryHf84",
    "progress",
    handoff,
  )(
    sandbox,
    async () => active,
    async (value) => {
      active = value;
    },
    chrome,
    () => true,
    () => true,
    () => "hf92-direct-receipt",
    100,
    () => {},
    () => {},
    new Set(),
    new Map(),
    () => "116618",
    async (_current, message, details) => {
      progressEvents.push({ message, details });
    },
  );

  const result = await sandbox.__commerceOsHf84ExplicitPopupHandoff({
    jobId: "hf92-direct-job",
    popupTabId: 99,
  });
  assert.equal(result.ok, true);
  assert.equal(result.committed, true);
  assert.equal(result.popupFrameId, 3);
  assert.equal(result.code, "HF92_EXACT_POPUP_BLUE_SUBMIT_COMMITTED");
  assert.equal(active.stage, "WAIT_A21_RESULT");
  assert.equal(active.lastMileReceiptHf84.exactDirectHandoffHf92, true);
  assert.equal(active.lastMileReceiptHf84.popupFrameId, 3);
  assert.equal(progressEvents.length, 1);
  assert.equal(
    progressEvents[0].details.code,
    "SHOPLING_HF92_EXACT_POPUP_DIRECT_COMMITTED",
  );
});

test("HF92 package remains v0.6.54 while the page and gate advance to HF93", async () => {
  const [route, page, planner, workflow] = await Promise.all([
    readFile(
      "src/app/api/shopling-stock-state-sync/download-hf92/route.ts",
      "utf8",
    ),
    readFile("src/app/china-order-manager/stock-control/page.tsx", "utf8"),
    readFile("src/lib/shoplingStockLaunchPlan.ts", "utf8"),
    readFile(".github/workflows/shopling-stock-state-sync-ci.yml", "utf8"),
  ]);

  assert.match(route, /const BASE_VERSION = "0\.6\.53"/);
  assert.match(route, /const VERSION = "0\.6\.54"/);
  assert.match(route, /EXACT_NEW_POPUP_RECEIPT_WINS_OVER_SOURCE_TARGET_DETACH/);
  assert.match(route, /EXACT_OWNED_POPUP_DIRECT_FRAME_PROBE_AND_ORIGINAL_SHOPLING_COMMIT/);
  assert.match(page, /download-hf93/);
  assert.match(page, /v0\.6\.55 다운로드/);
  assert.match(planner, /ALL_DATE_STOCK_SYNC_MIN_VERSION = \[0, 6, 55\]/);
  assert.match(workflow, /shoplingStockStateHf92\.test\.mjs/);
});
