import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { strFromU8, unzipSync } from "fflate";
import { patchHf89BackgroundHf84ExplicitHandoff } from "../src/lib/shoplingStockHf89Patch.ts";
import { patchHf92ExactPopupDirectCommit } from "../src/lib/shoplingStockHf92Patch.ts";
import { patchHf96SameAssignmentPopupRearm } from "../src/lib/shoplingStockHf96Patch.ts";
import { patchHf100InitialPopupOwnerReconciliation } from "../src/lib/shoplingStockHf100Patch.ts";
import { patchHf101InFlightInitialOwnerSnapshot } from "../src/lib/shoplingStockHf101Patch.ts";

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
  const hf100 = patchHf100InitialPopupOwnerReconciliation(hf96);
  const source = patchHf101InFlightInitialOwnerSnapshot(hf100);
  const start = source.indexOf("function exactPopupOwnerAtCommitHf96");
  const end = source.indexOf("function scheduleHf84", start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}

async function runInFlightOverwriteIncident({
  mutation = "STALE_SAME_ASSIGNMENT",
  initialOpenerTabId = 42,
} = {}) {
  const handoff = await exactHandoffSource();
  const jobId = "bcc5-2-on-sale-20261119-retry";
  const executionId = "bcc5-2-on-sale-20261119-retry-run-1";
  const listTabId = 42;
  const popupTabId = 99;
  const query = INCIDENT_GOODS_KEYS.join(",");
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
      goodsKeyQuery: query,
      baselineTabIds: [],
      armedAt: Date.now(),
      claimedTabId: null,
    },
    workTabs: {
      A21_LIST: { tabId: listTabId, frameId: 0 },
      A21_POPUP: {
        tabId: popupTabId,
        frameId: 0,
        openerTabId: initialOpenerTabId,
        assignmentOwnerKey: ownerKey,
        establishedBy: "HF90_EXACT_TRUSTED_POPUP_HANDOFF",
      },
    },
    shoplingDispatchReceiptHf90: {
      jobId,
      popupTabId,
      expectedListTabId: listTabId,
      exactOwnerBound: true,
      externalWriteConfirmed: false,
      retrySafe: false,
      code: "HF90_EXACT_POPUP_OWNER_BOUND_BEFORE_SUBMIT",
      recordedAt: Date.now(),
    },
  };
  let commitCount = 0;
  let probeCount = 0;
  const sandbox = {};
  const chrome = {
    runtime: { getManifest: () => ({ version: "0.6.61" }) },
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
          probeCount += 1;
          if (probeCount === 1 && mutation !== "NONE") {
            const overwritten = structuredClone(active);
            overwritten.a21PopupOwnershipHf81 = {
              ...overwritten.a21PopupOwnershipHf81,
              baselineTabIds: [popupTabId],
              claimedTabId: null,
              armedAt: Date.now(),
            };
            overwritten.shoplingDispatchReceiptHf90 = null;
            overwritten.workTabs = {
              A21_LIST: { tabId: listTabId, frameId: 0 },
            };
            if (mutation === "CHANGED_GOODS_KEYS") {
              overwritten.optionCurrentBatchKeys = [
                ...INCIDENT_GOODS_KEYS.slice(0, -1),
                "999999",
              ];
            } else if (mutation === "CHANGED_LIST_TAB") {
              overwritten.a21PopupOwnershipHf81.listTabId = 43;
              overwritten.workTabs.A21_LIST.tabId = 43;
            } else if (mutation === "OTHER_POPUP_CLAIMED") {
              overwritten.a21PopupOwnershipHf81.claimedTabId = 100;
            }
            active = overwritten;
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
    async () => {},
  );

  const result = await sandbox.__commerceOsHf84ExplicitPopupHandoff({
    jobId,
    popupTabId,
  });
  return { result, active, commitCount };
}

test("HF101 preserves the real BCC5-2 exact popup when stale duplicate preparation overwrites live owner fields during the same handoff", async () => {
  const { result, active, commitCount } = await runInFlightOverwriteIncident();

  assert.equal(result.ok, true);
  assert.equal(result.committed, true);
  assert.equal(commitCount, 1);
  assert.equal(active.stage, "WAIT_A21_RESULT");
  assert.equal(
    active.shoplingPopupInFlightReconciliationHf101.code,
    "HF101_IN_FLIGHT_INITIAL_OWNER_RECONCILED",
  );
  assert.equal(active.lastMileReceiptHf84.initialOwnerSnapshotReconciledHf101, true);
});

test("HF101 preserves the ordinary exact-popup path with one original submit", async () => {
  const { result, active, commitCount } = await runInFlightOverwriteIncident({
    mutation: "NONE",
  });

  assert.equal(result.ok, true);
  assert.equal(result.committed, true);
  assert.equal(commitCount, 1);
  assert.equal(active.shoplingPopupInFlightReconciliationHf101, undefined);
  assert.equal(active.lastMileReceiptHf84.initialOwnerSnapshotReconciledHf101, false);
});

test("HF101 preserves HF72's proven missing-opener popup path during the same in-flight overwrite", async () => {
  const { result, active, commitCount } = await runInFlightOverwriteIncident({
    initialOpenerTabId: null,
  });

  assert.equal(result.ok, true);
  assert.equal(result.committed, true);
  assert.equal(commitCount, 1);
  assert.equal(
    active.shoplingPopupInFlightReconciliationHf101.code,
    "HF101_IN_FLIGHT_INITIAL_OWNER_RECONCILED",
  );
});

for (const mutation of [
  "CHANGED_GOODS_KEYS",
  "CHANGED_LIST_TAB",
  "OTHER_POPUP_CLAIMED",
]) {
  test(`HF101 blocks ${mutation} before external submit`, async () => {
    const { result, commitCount } = await runInFlightOverwriteIncident({ mutation });

    assert.equal(result.ok, false);
    assert.equal(result.code, "HF101_IN_FLIGHT_POPUP_OWNER_CHANGED");
    assert.equal(result.ownershipCodeHf101, "HF101_IN_FLIGHT_OWNER_SNAPSHOT_MISMATCH");
    assert.equal(commitCount, 0);
  });
}

test("HF101 package, UI gate and CI expose the in-flight owner snapshot fix", async () => {
  const [route, page, planner, workflow] = await Promise.all([
    readFile(
      "src/app/api/shopling-stock-state-sync/download-hf101/route.ts",
      "utf8",
    ),
    readFile("src/app/china-order-manager/stock-control/page.tsx", "utf8"),
    readFile("src/lib/shoplingStockLaunchPlan.ts", "utf8"),
    readFile(".github/workflows/shopling-stock-state-sync-ci.yml", "utf8"),
  ]);
  assert.match(route, /const BASE_VERSION = "0\.6\.60"/);
  assert.match(route, /const VERSION = "0\.6\.61"/);
  assert.match(route, /IMMUTABLE_INITIAL_HF90_OWNER_SNAPSHOT_FOR_SAME_HANDOFF_ONLY/);
  assert.match(route, /HF99_ENDED_ONLY_NO_TRANSMISSION/);
  assert.match(page, /download-hf101/);
  assert.match(page, /v0\.6\.61 다운로드/);
  assert.match(planner, /ALL_DATE_STOCK_SYNC_MIN_VERSION = \[0, 6, 61\]/);
  assert.match(workflow, /shoplingStockStateHf101\.test\.mjs/);
});

test("HF101 patch fails closed when the proven HF100 checkpoint is absent", () => {
  assert.throws(
    () => patchHf101InFlightInitialOwnerSnapshot("not-hf100"),
    /shopling_stock_hf101_patch_checkpoint_mismatch/,
  );
});
