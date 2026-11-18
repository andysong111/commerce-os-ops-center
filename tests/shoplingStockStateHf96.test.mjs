import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { strFromU8, unzipSync } from "fflate";
import { patchHf89BackgroundHf84ExplicitHandoff } from "../src/lib/shoplingStockHf89Patch.ts";
import { patchHf92ExactPopupDirectCommit } from "../src/lib/shoplingStockHf92Patch.ts";
import { patchHf96SameAssignmentPopupRearm } from "../src/lib/shoplingStockHf96Patch.ts";

const INCIDENT_GOODS_KEYS = [
  "120461",
  "120462",
  "120463",
  "120464",
  "120465",
  "120466",
  "122438",
  "122440",
  "122442",
  "122443",
  "122444",
  "122445",
];

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
  const source = patchHf96SameAssignmentPopupRearm(hf92);
  const start = source.indexOf("function exactPopupOwnerAtCommitHf96");
  const end = source.indexOf("function scheduleHf84", start);
  assert.ok(start >= 0 && end > start);
  return { source, handoff: source.slice(start, end) };
}

function canonicalQuery(active) {
  const values = active.job.productKind === "OPTION"
    ? active.optionCurrentBatchKeys
    : active.singleCurrentBatchKeys;
  return (values || active.job.goodsKeys || []).join(",");
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

async function runIncidentHarness({
  includeDurableReceipt = true,
  receiptPopupTabId = 99,
  rearmedGoodsKeys = INCIDENT_GOODS_KEYS,
  simulateRearm = true,
} = {}) {
  const { handoff } = await exactHandoffSource();
  const jobId = "bcc5-1-on-sale-20261119";
  const executionId = "bcc5-1-on-sale-20261119-run-1";
  const listTabId = 42;
  const popupTabId = 99;
  const initialQuery = INCIDENT_GOODS_KEYS.join(",");
  const initialOwnerKey = [jobId, executionId, "OPTION", initialQuery].join(":");
  let active = {
    status: "RUNNING",
    stage: "A21_LIST",
    job: {
      jobId,
      executionId,
      barcode: "BCC5-1",
      productKind: "OPTION",
      desiredStatus: "ON_SALE",
      goodsKeys: [...INCIDENT_GOODS_KEYS],
    },
    optionCurrentBatchKeys: [...INCIDENT_GOODS_KEYS],
    a21PopupOwnershipHf81: {
      assignmentOwnerKey: initialOwnerKey,
      listTabId,
      productKind: "OPTION",
      goodsKeyQuery: initialQuery,
      baselineTabIds: [],
      armedAt: Date.now() - 200,
      claimedTabId: popupTabId,
    },
    workTabs: {
      A21_LIST: { tabId: listTabId, frameId: 0 },
      A21_POPUP: {
        tabId: popupTabId,
        frameId: 0,
        openerTabId: listTabId,
        assignmentOwnerKey: initialOwnerKey,
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
  const progressEvents = [];
  let commitCount = 0;
  let rearmed = false;
  const sandbox = {};
  const chrome = {
    runtime: { getManifest: () => ({ version: "0.6.58" }) },
    tabs: {
      get: async () => ({
        id: popupTabId,
        openerTabId: listTabId,
        url: "https://a.shopling.co.kr/prodlinkage/goods_mallMdfy_trsmt.phtml?goods=1",
      }),
    },
    scripting: {
      executeScript: async ({ target, args }) => {
        if (target.allFrames) {
          if (simulateRearm && !rearmed) {
            rearmed = true;
            const query = rearmedGoodsKeys.join(",");
            active = {
              ...active,
              optionCurrentBatchKeys: [...rearmedGoodsKeys],
              a21PopupOwnershipHf81: {
                ...active.a21PopupOwnershipHf81,
                assignmentOwnerKey: [
                  jobId,
                  executionId,
                  "OPTION",
                  query,
                ].join(":"),
                goodsKeyQuery: query,
                baselineTabIds: [popupTabId],
                armedAt: Date.now(),
                claimedTabId: null,
              },
            };
          }
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
    async (_current, message, details) => {
      progressEvents.push({ message, details });
    },
  );

  const result = await sandbox.__commerceOsHf84ExplicitPopupHandoff({
    jobId,
    popupTabId,
  });
  return { result, active, commitCount, progressEvents };
}

test("HF96 reconciles the real BCC5-1 12-goods-key same-assignment re-arm and submits exactly once", async () => {
  const { result, active, commitCount, progressEvents } =
    await runIncidentHarness();

  assert.equal(result.ok, true);
  assert.equal(result.committed, true);
  assert.equal(result.code, "HF96_REARM_RECONCILED_BLUE_SUBMIT_COMMITTED");
  assert.equal(commitCount, 1);
  assert.equal(active.stage, "WAIT_A21_RESULT");
  assert.equal(
    active.lastMileReceiptHf84.sameAssignmentRearmReconciledHf96,
    true,
  );
  assert.equal(
    active.shoplingPopupReconciliationHf96.canonicalOwnerKey,
    canonicalReceiptKey(active),
  );
  assert.equal(progressEvents.length, 1);
  assert.equal(
    progressEvents[0].details.code,
    "SHOPLING_HF96_REARM_RECONCILED_AND_COMMITTED",
  );
});

test("HF96 preserves the ordinary exact-popup path without invoking reconciliation", async () => {
  const { result, active, commitCount } = await runIncidentHarness({
    simulateRearm: false,
  });

  assert.equal(result.ok, true);
  assert.equal(result.code, "HF92_EXACT_POPUP_BLUE_SUBMIT_COMMITTED");
  assert.equal(commitCount, 1);
  assert.equal(
    active.lastMileReceiptHf84.sameAssignmentRearmReconciledHf96,
    false,
  );
  assert.equal(active.shoplingPopupReconciliationHf96, undefined);
});

test("HF96 blocks the re-armed popup when the durable HF90 receipt is missing", async () => {
  const { result, commitCount } = await runIncidentHarness({
    includeDurableReceipt: false,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "HF92_EXACT_POPUP_OWNER_CHANGED");
  assert.equal(
    result.ownershipCodeHf96,
    "HF96_EXACT_POPUP_OWNER_PROOF_MISMATCH",
  );
  assert.equal(commitCount, 0);
});

test("HF96 blocks a durable receipt bound to another popup", async () => {
  const { result, commitCount } = await runIncidentHarness({
    receiptPopupTabId: 100,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "HF92_EXACT_POPUP_OWNER_CHANGED");
  assert.equal(commitCount, 0);
});

test("HF96 blocks a semantic goods-key change instead of reusing the prior popup", async () => {
  const { result, commitCount } = await runIncidentHarness({
    rearmedGoodsKeys: [...INCIDENT_GOODS_KEYS.slice(0, -1), "999999"],
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "HF92_EXACT_POPUP_OWNER_CHANGED");
  assert.equal(commitCount, 0);
});

test("HF96 package advances only the guarded ownership layer and current UI gate", async () => {
  const [route, page, planner, workflow] = await Promise.all([
    readFile(
      "src/app/api/shopling-stock-state-sync/download-hf96/route.ts",
      "utf8",
    ),
    readFile("src/app/china-order-manager/stock-control/page.tsx", "utf8"),
    readFile("src/lib/shoplingStockLaunchPlan.ts", "utf8"),
    readFile(".github/workflows/shopling-stock-state-sync-ci.yml", "utf8"),
  ]);
  assert.match(route, /const BASE_VERSION = "0\.6\.57"/);
  assert.match(route, /const VERSION = "0\.6\.58"/);
  assert.match(route, /ONE_BCODE_AT_A_TIME_UNCHANGED/);
  assert.match(route, /FAIL_CLOSED_BEFORE_EXTERNAL_SUBMIT/);
  assert.match(route, /patchHf96SameAssignmentPopupRearm/);
  assert.match(page, /download-hf96/);
  assert.match(page, /v0\.6\.58 다운로드/);
  assert.match(planner, /ALL_DATE_STOCK_SYNC_MIN_VERSION = \[0, 6, 58\]/);
  assert.match(workflow, /shoplingStockStateHf96\.test\.mjs/);
});

test("HF96 patch fails closed when its HF92 checkpoint is absent", () => {
  assert.throws(
    () => patchHf96SameAssignmentPopupRearm("not-the-proven-hf92-source"),
    /shopling_stock_hf96_patch_checkpoint_mismatch/,
  );
});
