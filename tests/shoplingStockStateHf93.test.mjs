import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { strFromU8, unzipSync } from "fflate";
import { patchHf92TrustedClickDetachedReceipt } from "../src/lib/shoplingStockHf92Patch.ts";
import {
  patchHf93CanonicalSelectionReceipt,
  patchHf93ProgressLabels,
  patchHf93TrustedSelectionReceipt,
} from "../src/lib/shoplingStockHf93Patch.ts";
import { patchHf86CanonicalListSource } from "../src/lib/shoplingStockHf86Patch.ts";
import { patchHf89CanonicalPopupHandoff } from "../src/lib/shoplingStockHf89Patch.ts";

const baseZipPath =
  "public/shopling-stock-state-sync/fixtures/commerce-os-shopling-stock-state-v0.6.48-hf85.zip";

async function currentTrustedSource() {
  const original = await readFile(
    "public/shopling-stock-state-sync/background-v096.js",
    "utf8",
  );
  return patchHf93TrustedSelectionReceipt(
    patchHf92TrustedClickDetachedReceipt(original),
  );
}

async function currentCanonicalSource() {
  const entries = unzipSync(new Uint8Array(await readFile(baseZipPath)));
  const hf86 = patchHf86CanonicalListSource(
    strFromU8(entries["content-a21-canonical-v019.js"]),
  );
  const hf89 = patchHf89CanonicalPopupHandoff(hf86);
  return patchHf93CanonicalSelectionReceipt(hf89);
}

function trustedHarness(source, { popupAfterClick, selectionDialog }) {
  let listener = null;
  let queryCount = 0;
  let debuggerEventListener = null;
  const commands = [];
  const scriptKinds = [];
  const sandbox = {
    __COMMERCE_OS_EXPOSE_STOCK_HF92_TRUSTED_TEST_HOOKS__: true,
  };
  const chrome = {
    runtime: { onMessage: { addListener(value) { listener = value; } } },
    scripting: {
      executeScript: async ({ args }) => {
        if (args?.[0]?.goodsKeys) {
          scriptKinds.push("selection");
          return [{
            frameId: 0,
            result: {
              ok: true,
              code: "HF93_EXACT_ROWS_SELECTED_IN_MAIN_WORLD",
              matchedRowCount: 6,
              checkedRowCount: 6,
              expectedSelectedRowCount: 6,
            },
          }];
        }
        scriptKinds.push("button");
        return [{
          frameId: 0,
          result: {
            ok: true,
            x: 300,
            y: 200,
            width: 120,
            height: 28,
            onclick: "goods_mallMody_submit()",
          },
        }];
      },
    },
    tabs: {
      query: async () => {
        queryCount += 1;
        if (popupAfterClick && queryCount >= 2) {
          return [{ id: 99, windowId: 7, openerTabId: 42 }];
        }
        return [];
      },
    },
    debugger: {
      attach: async () => {},
      detach: async () => {},
      onEvent: {
        addListener(value) { debuggerEventListener = value; },
        removeListener(value) {
          if (debuggerEventListener === value) debuggerEventListener = null;
        },
      },
      sendCommand: async (_target, method, params) => {
        commands.push({ method, params });
        if (selectionDialog && method === "Input.dispatchMouseEvent" && params?.type === "mouseReleased") {
          debuggerEventListener?.(
            { tabId: 42 },
            "Page.javascriptDialogOpening",
            { type: "alert", message: "수정 전송할 자료를 선택하여 주세요." },
          );
        }
        return {};
      },
    },
  };
  const active = {
    status: "RUNNING",
    stage: "A21_LIST",
    job: { jobId: "hf93-job", barcode: "BCC2-1" },
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
      queueMicrotask(resolve);
      return 1;
    },
  );
  return {
    listener,
    hooks: sandbox.__commerceOsStockHf92TrustedTestHooks,
    commands,
    scriptKinds,
  };
}

test("HF93 removes the misleading price-adjustment wording from SINGLE progress", async () => {
  const original = await readFile(
    "public/shopling-stock-state-sync/background-v056.js",
    "utf8",
  );
  const patched = patchHf93ProgressLabels(original);
  assert.match(patched, /A21 상품 원본 검색 제출 → 전체 정확일치 행 선택/);
  assert.match(patched, /단품 A21 상품 원본 목록 엔진 연결 대기/);
  assert.doesNotMatch(patched, /가격조정 원본/);
  new Function(patched);
});

test("HF93 passes the exact selected-row receipt to the trusted-click boundary", async () => {
  const source = await currentCanonicalSource();
  assert.match(source, /expectedSelectedRowCount: Number\(selectionReceipt\?\.selectedRowCount \|\| 0\)/);
  assert.match(source, /expectedTotalResultCount: Number\(selectionReceipt\?\.totalResultCount \|\| 0\)/);
  assert.match(source, /selectedRowCount: checked, totalResultCount: total/);
  new Function(source);
});

test("HF93 revalidates exact rows in MAIN world before the trusted red click", async () => {
  const source = await currentTrustedSource();
  const harness = trustedHarness(source, {
    popupAfterClick: true,
    selectionDialog: false,
  });
  const result = await harness.hooks.trustedClickHf86(
    {
      jobId: "hf93-job",
      expectedHandler: "goods_mallMody_submit",
      goodsKeyQuery: "119577",
      expectedSelectedRowCount: 6,
      expectedTotalResultCount: 6,
    },
    { tab: { id: 42 }, frameId: 0 },
  );
  assert.equal(result.ok, true);
  assert.equal(result.popupObserved, true);
  assert.equal(result.popupTabId, 99);
  assert.equal(result.selectionReceipt.checkedRowCount, 6);
  assert.deepEqual(harness.scriptKinds, ["button", "selection"]);
  assert.ok(
    harness.commands.findIndex((entry) => entry.method === "Input.dispatchMouseEvent") >
      harness.commands.findIndex((entry) => entry.method === "Page.enable"),
  );
});

test("HF93 closes the exact no-selection alert and fails fast without an eight-second popup wait", async () => {
  const source = await currentTrustedSource();
  const harness = trustedHarness(source, {
    popupAfterClick: false,
    selectionDialog: true,
  });
  const result = await harness.hooks.trustedClickHf86(
    {
      jobId: "hf93-job",
      expectedHandler: "goods_mallMody_submit",
      goodsKeyQuery: "119577",
      expectedSelectedRowCount: 6,
      expectedTotalResultCount: 6,
    },
    { tab: { id: 42 }, frameId: 0 },
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, "HF93_SELECTION_DIALOG_CAUGHT");
  assert.equal(result.retrySafe, true);
  assert.equal(result.popupObserved, false);
  assert.ok(
    harness.commands.some(
      (entry) => entry.method === "Page.handleJavaScriptDialog" && entry.params.accept === true,
    ),
  );
});

test("HF93 package remains v0.6.55 while the stock-control gate advances to HF94", async () => {
  const [route, page, planner, workflow] = await Promise.all([
    readFile(
      "src/app/api/shopling-stock-state-sync/download-hf93/route.ts",
      "utf8",
    ),
    readFile("src/app/china-order-manager/stock-control/page.tsx", "utf8"),
    readFile("src/lib/shoplingStockLaunchPlan.ts", "utf8"),
    readFile(".github/workflows/shopling-stock-state-sync-ci.yml", "utf8"),
  ]);
  assert.match(route, /const BASE_VERSION = "0\.6\.54"/);
  assert.match(route, /const VERSION = "0\.6\.55"/);
  assert.match(route, /EXACT_CURRENT_RESULT_ROWS_REVERIFIED_IN_MAIN_WORLD/);
  assert.match(route, /EXACT_NO_SELECTION_ALERT_AUTO_CLOSED_AND_FAILED_FAST/);
  assert.match(page, /download-hf100/);
  assert.match(page, /v0\.6\.60 다운로드/);
  assert.match(planner, /ALL_DATE_STOCK_SYNC_MIN_VERSION = \[0, 6, 60\]/);
  assert.match(workflow, /shoplingStockStateHf93\.test\.mjs/);
});
