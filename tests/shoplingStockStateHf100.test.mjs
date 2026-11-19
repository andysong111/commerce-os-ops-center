import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { strFromU8, unzipSync } from "fflate";
import { patchHf89BackgroundHf84ExplicitHandoff } from "../src/lib/shoplingStockHf89Patch.ts";
import { patchHf92ExactPopupDirectCommit } from "../src/lib/shoplingStockHf92Patch.ts";
import { patchHf96SameAssignmentPopupRearm } from "../src/lib/shoplingStockHf96Patch.ts";
import { patchHf100InitialPopupOwnerReconciliation } from "../src/lib/shoplingStockHf100Patch.ts";

const INCIDENT_GOODS_KEYS = ["122445", "16384471645", "4854399090", "F661887197"];

function canonicalQuery(active) {
  return (active.optionCurrentBatchKeys || active.job.goodsKeys || []).join(",");
}

function canonicalReceiptKey(active) {
  return [
    active.job.jobId,
    active.job.executionId || active.job.jobId,
    active.job.productKind,
    canonicalQuery(active),
  ].join(":");
}

function bindingMatches(active, popupTabId) {
  const binding = active.a21PopupOwnershipHf81;
  if (!binding) return false;
  if (binding.productKind !== active.job.productKind) return false;
  if (binding.goodsKeyQuery !== canonicalQuery(active)) return false;
  if (binding.assignmentOwnerKey !== canonicalReceiptKey(active)) return false;
  if ((binding.baselineTabIds || []).map(Number).includes(popupTabId)) {
    return false;
  }
  const claimed = binding.claimedTabId == null
    ? null
    : Number(binding.claimedTabId);
  return !Number.isInteger(claimed) || claimed === popupTabId;
}

async function exactHandoffSource() {
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
  const hf96 = patchHf96SameAssignmentPopupRearm(hf92);
  const source = patchHf100InitialPopupOwnerReconciliation(hf96);
  const start = source.indexOf("function exactPopupOwnerAtCommitHf96");
  const end = source.indexOf("function scheduleHf84", start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}

async function runInitialMismatchIncident({
  initialRearm = true,
  includeDurableReceipt = true,
  receiptPopupTabId = 99,
  bindingGoodsKeys = INCIDENT_GOODS_KEYS,
} = {}) {
  const handoff = await exactHandoffSource();
  const jobId = "bcc5-2-on-sale-20261119";
  const executionId = "bcc5-2-on-sale-20261119-run-1";
  const listTabId = 42;
  const popupTabId = 99;
  const query = INCIDENT_GOODS_KEYS.join(",");
  const bindingQuery = bindingGoodsKeys.join(",");
  const ownerKey = [jobId, executionId, "OPTION", query].join(":");
  let active = {
    status: "RUNNING",
    stage: "A21_LIST",
    job: {
      jobId,
      executionId,
      barcode: "BCC5-2",
      productKind: "OPTION",
      desiredStatus: "ON_SALE",
      goodsKeys: [...INCIDENT_GOODS_KEYS],
    },
    optionCurrentBatchKeys: [...INCIDENT_GOODS_KEYS],
    a21PopupOwnershipHf81: {
      assignmentOwnerKey: ownerKey,
      listTabId,
      productKind: "OPTION",
      goodsKeyQuery: bindingQuery,
      baselineTabIds: initialRearm ? [popupTabId] : [],
      armedAt: Date.now(),
      claimedTabId: null,
    },
    workTabs: {
      A21_LIST: { tabId: listTabId, frameId: 0 },
      A21_POPUP: {
        tabId: popupTabId,
        frameId: 0,
        openerTabId: listTabId,
        assignmentOwnerKey: ownerKey,
        establishedBy: "HF90_EXACT_TRUSTED_POPUP_HANDOFF",
      },
    },
    shoplingDispatchReceiptHf90: includeDurableReceipt
      ? {
          jobId,
          popupTabId: receiptPopupTabId,
          expectedListTabId: listTabId,
          exactOwnerBound: true,
          externalWriteConfirmed: false,
          retrySafe: false,
          code: "HF90_EXACT_POPUP_OWNER_BOUND_BEFORE_SUBMIT",
          recordedAt: Date.now(),
        }
      : null,
  };
  let commitCount = 0;
  const sandbox = {};
  const chrome = {
    runtime: { getManifest: () => ({ version: "0.6.60" }) },
    tabs: {
      get: async () => ({
        id: popupTabId,
        openerTabId: listTabId,
        url: "https://kt.shopling.co.kr/prodlinkage/goods_mallMdfy_trsmt.phtml",
      }),
    },
    scripting: {
      executeScript: async ({ target, args }) => {
        if (target.allFrames) {
          return [{ frameId: 3, result: { eligible: true } }];
        }
        commitCount += 1;
        return [{
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
        }];
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
    bindingMatches,
    canonicalReceiptKey,
    100,
    () => {},
    () => {},
    new Set(),
    new Map(),
    canonicalQuery,
    async () => {},
  );

  const result = await sandbox.__commerceOsHf84ExplicitPopupHandoff({
    jobId,
    popupTabId,
  });
  return { result, active, commitCount };
}

test("HF100 recovers the real BCC5-2 popup re-arm before the initial blue-submit owner check", async () => {
  const { result, active, commitCount } = await runInitialMismatchIncident();

  assert.equal(result.ok, true);
  assert.equal(result.committed, true);
  assert.equal(commitCount, 1);
  assert.equal(active.stage, "WAIT_A21_RESULT");
  assert.equal(
    active.shoplingPopupInitialReconciliationHf100.code,
    "HF100_INITIAL_REARM_RECONCILED",
  );
  assert.equal(active.lastMileReceiptHf84.initialOwnerReconciledHf100, true);
});

test("HF100 preserves the ordinary exact-popup path", async () => {
  const { result, active, commitCount } = await runInitialMismatchIncident({
    initialRearm: false,
    includeDurableReceipt: false,
  });

  assert.equal(result.ok, true);
  assert.equal(result.committed, true);
  assert.equal(commitCount, 1);
  assert.equal(active.shoplingPopupInitialReconciliationHf100, undefined);
  assert.equal(active.lastMileReceiptHf84.initialOwnerReconciledHf100, false);
});

test("HF100 blocks an initially re-armed popup without the fresh HF90 receipt", async () => {
  const { result, commitCount } = await runInitialMismatchIncident({
    includeDurableReceipt: false,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "HF100_EXACT_POPUP_INITIAL_OWNER_MISMATCH");
  assert.equal(
    result.ownershipCodeHf100,
    "HF96_EXACT_POPUP_OWNER_PROOF_MISMATCH",
  );
  assert.equal(commitCount, 0);
});

test("HF100 blocks a receipt for another popup or another goods-key assignment", async () => {
  const otherPopup = await runInitialMismatchIncident({ receiptPopupTabId: 100 });
  assert.equal(otherPopup.result.ok, false);
  assert.equal(otherPopup.commitCount, 0);

  const otherGoods = await runInitialMismatchIncident({
    bindingGoodsKeys: [...INCIDENT_GOODS_KEYS.slice(0, -1), "999999"],
  });
  assert.equal(otherGoods.result.ok, false);
  assert.equal(otherGoods.commitCount, 0);
});

test("HF100 package, UI gate and CI expose the initial-owner fix", async () => {
  const [route, page, planner, workflow] = await Promise.all([
    readFile(
      "src/app/api/shopling-stock-state-sync/download-hf100/route.ts",
      "utf8",
    ),
    readFile("src/app/china-order-manager/stock-control/page.tsx", "utf8"),
    readFile("src/lib/shoplingStockLaunchPlan.ts", "utf8"),
    readFile(".github/workflows/shopling-stock-state-sync-ci.yml", "utf8"),
  ]);
  assert.match(route, /const BASE_VERSION = "0\.6\.59"/);
  assert.match(route, /const VERSION = "0\.6\.60"/);
  assert.match(route, /FAIL_CLOSED_BEFORE_EXTERNAL_SUBMIT/);
  assert.match(route, /HF99_ENDED_ONLY_NO_TRANSMISSION/);
  assert.match(page, /download-hf100/);
  assert.match(page, /v0\.6\.60 다운로드/);
  assert.match(planner, /ALL_DATE_STOCK_SYNC_MIN_VERSION = \[0, 6, 60\]/);
  assert.match(workflow, /shoplingStockStateHf100\.test\.mjs/);
});

test("HF100 patch fails closed when the proven HF96 checkpoint is absent", () => {
  assert.throws(
    () => patchHf100InitialPopupOwnerReconciliation("not-hf96"),
    /shopling_stock_hf100_patch_checkpoint_mismatch/,
  );
});
