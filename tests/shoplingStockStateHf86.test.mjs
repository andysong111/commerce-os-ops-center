import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { strFromU8, unzipSync } from "fflate";
import { patchHf86CanonicalListSource } from "../src/lib/shoplingStockHf86Patch.ts";

const baseZipPath =
  "public/shopling-stock-state-sync/fixtures/commerce-os-shopling-stock-state-v0.6.48-hf85.zip";

async function baseCanonical() {
  const zip = unzipSync(new Uint8Array(await readFile(baseZipPath)));
  assert.ok(zip["content-a21-canonical-v019.js"]);
  return strFromU8(zip["content-a21-canonical-v019.js"]);
}

test("HF86 replaces the false-positive synthetic list click with a trusted-click request", async () => {
  const source = patchHf86CanonicalListSource(await baseCanonical());
  const clickWorker = source.slice(
    source.indexOf("async function clickModifySend"),
    source.indexOf("function submitButton"),
  );
  assert.match(clickWorker, /A21_TRUSTED_MODIFY_SEND_CLICK_HF86/);
  assert.match(clickWorker, /goods_mallMody_submit/);
  assert.match(clickWorker, /response\?\.trustedClick === true/);
  assert.match(clickWorker, /response\?\.popupObserved === true/);
  assert.doesNotMatch(clickWorker, /commerce-os-stock-main-click/);
  assert.doesNotMatch(clickWorker, /target\.click\(\)/);
  assert.match(source, /const modifySend = await clickModifySend\(assignment\);/);
  assert.match(source, /const VERSION = "0\.1\.9"/);
  new Function(source);
});

test("HF86 canonical worker accepts only a trusted click with an observed popup", async () => {
  const source = patchHf86CanonicalListSource(await baseCanonical());

  class FakeElement {
    constructor() {
      this.textContent = "상품 수정전송";
      this.offsetParent = {};
      this.attributes = new Map([
        ["onclick", "goods_mallMody_submit('','width=1130,height=550,');"],
      ]);
    }
    getBoundingClientRect() {
      return { width: 100, height: 24, top: 0, left: 0 };
    }
    getAttribute(name) {
      return this.attributes.get(name) || "";
    }
  }
  class FakeInput extends FakeElement {}
  class FakeImage extends FakeElement {
    closest() {
      return this;
    }
  }

  let sent = null;
  let runtimeResponse = {
    ok: true,
    trustedClick: true,
    popupObserved: true,
    popupTabId: 91,
  };
  const sandbox = { __COMMERCE_OS_EXPOSE_A21_V019_TEST_HOOKS__: true };
  new Function(
    "globalThis",
    "document",
    "window",
    "HTMLElement",
    "HTMLInputElement",
    "HTMLImageElement",
    "CustomEvent",
    "Event",
    "setTimeout",
    "chrome",
    source,
  )(
    sandbox,
    { querySelectorAll: () => [new FakeElement()] },
    { setTimeout },
    FakeElement,
    FakeInput,
    FakeImage,
    class {},
    class {},
    setTimeout,
    {
      runtime: {
        sendMessage: async (message) => {
          sent = message;
          return runtimeResponse;
        },
      },
    },
  );

  const assignment = {
    jobId: "hf86-job",
    runId: "run-1",
    stockProductKindHf48: "SINGLE",
    goodsKeys: ["116618", "116619"],
  };
  const success = await sandbox.__commerceOsA21V019TestHooks.clickModifySend(assignment);
  assert.deepEqual(success, {
    ok: true,
    code: "A21_MODIFY_SEND_TRUSTED_CLICK_POPUP_CONFIRMED_HF86",
    popupTabId: 91,
  });
  assert.equal(sent.type, "A21_TRUSTED_MODIFY_SEND_CLICK_HF86");
  assert.equal(sent.goodsKeyQuery, "116618,116619");

  runtimeResponse = { ok: true, trustedClick: true, popupObserved: false };
  const rejected = await sandbox.__commerceOsA21V019TestHooks.clickModifySend(assignment);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, "A21_TRUSTED_CLICK_POPUP_NOT_CONFIRMED_HF86");
});

function loadBackgroundHarness({ active, popupAfterClick = true }) {
  return readFile("public/shopling-stock-state-sync/background-v096.js", "utf8").then((source) => {
    let listener = null;
    let queryCount = 0;
    const commands = [];
    let detached = false;
    const chrome = {
      runtime: {
        onMessage: {
          addListener(value) {
            listener = value;
          },
        },
      },
      tabs: {
        query: async () => {
          queryCount += 1;
          if (queryCount === 1 || !popupAfterClick) return [];
          return [{ id: 99, windowId: 7, openerTabId: 42 }];
        },
      },
      scripting: {
        executeScript: async () => [{
          frameId: 0,
          result: {
            ok: true,
            x: 340,
            y: 220,
            width: 120,
            height: 28,
            onclick: "goods_mallMody_submit('','width=1130,height=550,');",
          },
        }],
      },
      debugger: {
        attach: async () => {},
        sendCommand: async (_target, method, params) => {
          commands.push({ method, params });
          return {};
        },
        detach: async () => {
          detached = true;
        },
      },
    };
    new Function(
      "importScripts",
      "chrome",
      "loadActive",
      "setTimeout",
      source,
    )(
      () => {},
      chrome,
      async () => active,
      (resolve) => queueMicrotask(resolve),
    );
    return { listener, commands, get detached() { return detached; } };
  });
}

test("HF86 background dispatches one trusted CDP click and confirms the exact new popup", async () => {
  const harness = await loadBackgroundHarness({
    active: {
      status: "RUNNING",
      job: { jobId: "hf86-job" },
      a21ExecutionWorkerHf76: { tabId: 42 },
    },
  });
  assert.equal(typeof harness.listener, "function");
  const response = await new Promise((resolve) => {
    const kept = harness.listener(
      {
        type: "A21_TRUSTED_MODIFY_SEND_CLICK_HF86",
        jobId: "hf86-job",
        expectedHandler: "goods_mallMody_submit",
      },
      { tab: { id: 42 }, frameId: 0 },
      resolve,
    );
    assert.equal(kept, true);
  });
  assert.equal(response.ok, true);
  assert.equal(response.trustedClick, true);
  assert.equal(response.popupObserved, true);
  assert.equal(response.popupTabId, 99);
  assert.deepEqual(
    harness.commands.map((entry) => entry.method),
    ["Input.dispatchMouseEvent", "Input.dispatchMouseEvent", "Input.dispatchMouseEvent"],
  );
  assert.equal(harness.detached, true);
});

test("HF86 fails closed before clicking when the A21 worker does not own the job", async () => {
  const harness = await loadBackgroundHarness({
    active: {
      status: "RUNNING",
      job: { jobId: "another-job" },
      a21ExecutionWorkerHf76: { tabId: 42 },
    },
  });
  const response = await new Promise((resolve) => {
    harness.listener(
      {
        type: "A21_TRUSTED_MODIFY_SEND_CLICK_HF86",
        jobId: "hf86-job",
        expectedHandler: "goods_mallMody_submit",
      },
      { tab: { id: 42 }, frameId: 0 },
      resolve,
    );
  });
  assert.equal(response.ok, false);
  assert.equal(response.code, "HF86_ASSIGNMENT_OWNER_MISMATCH");
  assert.equal(harness.commands.length, 0);
});

test("HF86 download contract advances the UI and extension minimum to v0.6.49", async () => {
  const [route, page, planner, workflow] = await Promise.all([
    readFile("src/app/api/shopling-stock-state-sync/download-hf86/route.ts", "utf8"),
    readFile("src/app/china-order-manager/stock-control/page.tsx", "utf8"),
    readFile("src/lib/shoplingStockLaunchPlan.ts", "utf8"),
    readFile(".github/workflows/shopling-stock-state-sync-ci.yml", "utf8"),
  ]);
  assert.match(route, /const BASE_VERSION = "0\.6\.48"/);
  assert.match(route, /const VERSION = "0\.6\.49"/);
  assert.match(route, /CHROME_DEBUGGER_TRUSTED_MOUSE_EVENT/);
  assert.match(route, /EXACT_NEW_SHOPLING_MODIFY_SEND_POPUP_OBSERVED/);
  assert.match(page, /download-hf86/);
  assert.match(page, /v0\.6\.49 다운로드/);
  assert.match(planner, /ALL_DATE_STOCK_SYNC_MIN_VERSION = \[0, 6, 49\]/);
  assert.match(workflow, /shoplingStockStateHf86\.test\.mjs/);
});
