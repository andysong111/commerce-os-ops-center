import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { patchHf74CanonicalListSource } from "../src/lib/shoplingStockHf74Patch.ts";

test("HF74 keeps fourteen compatible goods keys in one A21 assignment batch", async () => {
  const source = await readFile(
    "public/shopling-stock-state-sync/background-v093.js",
    "utf8",
  );
  const sandbox = { __COMMERCE_OS_EXPOSE_STOCK_HF74_TEST_HOOKS__: true };
  new Function(
    "globalThis",
    "importScripts",
    "chrome",
    "dispatchCurrent",
    "dispatchToTarget",
    "norm",
    source,
  )(
    sandbox,
    () => {},
    { runtime: { getManifest: () => ({ version: "0.6.37" }) } },
    () => false,
    () => false,
    (value) => String(value ?? "").trim(),
  );
  const hooks = sandbox.__commerceOsStockHf74TestHooks;
  assert.ok(hooks);

  const goodsKeys = Array.from({ length: 14 }, (_, index) => String(111000 + index));
  const active = {
    status: "RUNNING",
    stage: "A21_LIST",
    goodsKeyIndex: 0,
    stockStateGroupIndexHf72: 0,
    optionBatchLimit: 200,
    singleBatchLimit: 200,
    job: {
      jobId: "hf74-batch",
      stockStateApiApplied: true,
      stockStateTransmissionGroupsHf72: [
        {
          transmissionKind: "OPTION_SEND",
          effectiveProductKind: "OPTION",
          goodsKeys,
          optionCounts: Object.fromEntries(goodsKeys.map((key) => [key, 2])),
        },
      ],
    },
  };
  const batch = hooks.currentBatchV093(
    active,
    active.job.stockStateTransmissionGroupsHf72[0],
  );
  assert.deepEqual(batch, goodsKeys);
  const prepared = hooks.prepareGroupedBatchV093(active);
  assert.deepEqual(prepared.batch, goodsKeys);
  assert.deepEqual(active.optionCurrentBatchKeys, goodsKeys);
  assert.deepEqual(active.singleCurrentBatchKeys, []);
  const assignment = hooks.canonicalAssignmentV093(
    active,
    prepared.group,
    prepared.batch,
  );
  assert.equal(assignment.type, "A21_LIST_ASSIGNMENT");
  assert.equal(assignment.stockProductKindHf48, "OPTION");
  assert.deepEqual(assignment.goodsKeys, goodsKeys);
  assert.equal(assignment.goodsKeys.length, 14);
  assert.equal(assignment.stage, hooks.canonicalStageV093(active, prepared.group));
  assert.match(source, /goodsKeys: batch/);
  assert.match(source, /serialPerGoodsKey: false/);
  new Function(source);
});

test("HF74 preserves the OPTION/SINGLE owner marker for each grouped A21 assignment", async () => {
  const source = await readFile(
    "public/shopling-stock-state-sync/background-v093.js",
    "utf8",
  );
  const sandbox = { __COMMERCE_OS_EXPOSE_STOCK_HF74_TEST_HOOKS__: true };
  new Function(
    "globalThis",
    "importScripts",
    "chrome",
    "dispatchCurrent",
    "dispatchToTarget",
    "norm",
    source,
  )(
    sandbox,
    () => {},
    { runtime: { getManifest: () => ({ version: "0.6.37" }) } },
    () => false,
    () => false,
    (value) => String(value ?? "").trim(),
  );
  const active = {
    goodsKeyIndex: 0,
    stockStateGroupIndexHf72: 1,
    job: { jobId: "hf74-single-owner", executionId: "run-1" },
  };
  const group = {
    transmissionKind: "PRODUCT_SALE_STATUS_SEND",
    effectiveProductKind: "SINGLE",
    goodsKeys: ["120001", "120002"],
  };
  const assignment = sandbox.__commerceOsStockHf74TestHooks.canonicalAssignmentV093(
    active,
    group,
    group.goodsKeys,
  );
  assert.equal(assignment.stockProductKindHf48, "SINGLE");
  assert.deepEqual(assignment.goodsKeys, group.goodsKeys);
});

test("HF74 captures one result-tab baseline per grouped batch before dispatch", async () => {
  const source = await readFile(
    "public/shopling-stock-state-sync/background-v093.js",
    "utf8",
  );
  let queryCount = 0;
  const sandbox = { __COMMERCE_OS_EXPOSE_STOCK_HF74_TEST_HOOKS__: true };
  new Function(
    "globalThis",
    "importScripts",
    "chrome",
    "dispatchCurrent",
    "dispatchToTarget",
    "norm",
    source,
  )(
    sandbox,
    () => {},
    {
      runtime: { getManifest: () => ({ version: "0.6.37" }) },
      tabs: {
        query: async ({ url }) => {
          queryCount += 1;
          assert.deepEqual(url, [
            "https://shopling.co.kr/prod_a/prod_status_trsmt.phtml*",
            "https://*.shopling.co.kr/prod_a/prod_status_trsmt.phtml*",
          ]);
          return [{ id: 31 }, { id: 32 }, { id: undefined }];
        },
      },
    },
    () => false,
    () => false,
    (value) => String(value ?? "").trim(),
  );
  const active = { stockStateGroupIndexHf72: 1, goodsKeyIndex: 200 };
  const hooks = sandbox.__commerceOsStockHf74TestHooks;
  await hooks.ensureResultBaselineV093(active);
  assert.equal(active.shoplingResultBaselineBatchKeyHf72, "1:200");
  assert.deepEqual(active.shoplingResultBaselineTabIdsHf72, [31, 32]);
  await hooks.ensureResultBaselineV093(active);
  assert.equal(queryCount, 1);
  assert.match(source, /await ensureResultBaselineV093\(active\);\s*await saveActive\(active\);/);
});

test("HF74 clicks the single red Shopling list action through the MAIN-world bridge", async () => {
  const base = await readFile(
    "public/shopling-a21-price-option-resend/content-a21.js",
    "utf8",
  );
  const source = patchHf74CanonicalListSource(base);

  class FakeElement {
    constructor() {
      this.textContent = "상품 수정전송";
      this.offsetParent = {};
      this.attributes = new Map();
    }
    getBoundingClientRect() {
      return { width: 100, height: 24, top: 0, left: 0 };
    }
    getAttribute(name) {
      return this.attributes.get(name) || "";
    }
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    }
    removeAttribute(name) {
      this.attributes.delete(name);
    }
  }
  class FakeInput extends FakeElement {}
  class FakeImage extends FakeElement {
    closest() {
      return this;
    }
  }
  class FakeCustomEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.detail = options.detail;
    }
  }

  const target = new FakeElement();
  const listeners = new Map();
  let requestCount = 0;
  const window = {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
    dispatchEvent(event) {
      if (event.type === "commerce-os-stock-main-click") {
        requestCount += 1;
        const listener = listeners.get("commerce-os-stock-main-click-result");
        listener?.({
          detail: {
            token: event.detail.token,
            ok: true,
            code: "MAIN_CLICKED",
          },
        });
      }
      return true;
    },
    setTimeout,
  };
  const sandbox = { __COMMERCE_OS_EXPOSE_A21_V017_TEST_HOOKS__: true };
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
    source,
  )(
    sandbox,
    { querySelectorAll: () => [target] },
    window,
    FakeElement,
    FakeInput,
    FakeImage,
    FakeCustomEvent,
    class {},
    setTimeout,
  );
  const result = await sandbox.__commerceOsA21V017TestHooks.clickModifySend();
  assert.equal(result.ok, true);
  assert.equal(result.code, "A21_MODIFY_SEND_MAIN_CLICKED");
  assert.equal(requestCount, 1);
  assert.equal(target.attributes.has("data-commerce-os-stock-click-token"), false);
  const listClickWorker = source.slice(
    source.indexOf("async function clickModifySend"),
    source.indexOf("function submitButton"),
  );
  assert.doesNotMatch(listClickWorker, /candidates\[0\]\.click\(\)/);
  assert.match(source, /await clickModifySend\(\)/);
  new Function(source);
});

test("HF74 refuses an ambiguous red Shopling list action before requesting a MAIN-world click", async () => {
  const base = await readFile(
    "public/shopling-a21-price-option-resend/content-a21.js",
    "utf8",
  );
  const source = patchHf74CanonicalListSource(base);

  class FakeElement {
    constructor() {
      this.textContent = "상품 수정전송";
      this.offsetParent = {};
      this.attributes = new Map();
    }
    getBoundingClientRect() {
      return { width: 100, height: 24, top: 0, left: 0 };
    }
    getAttribute(name) {
      return this.attributes.get(name) || "";
    }
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    }
    removeAttribute(name) {
      this.attributes.delete(name);
    }
  }
  class FakeInput extends FakeElement {}
  class FakeImage extends FakeElement {}
  let requestCount = 0;
  const window = {
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      requestCount += 1;
      return true;
    },
    setTimeout,
  };
  const sandbox = { __COMMERCE_OS_EXPOSE_A21_V017_TEST_HOOKS__: true };
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
    source,
  )(
    sandbox,
    { querySelectorAll: () => [new FakeElement(), new FakeElement()] },
    window,
    FakeElement,
    FakeInput,
    FakeImage,
    class {},
    class {},
    setTimeout,
  );
  const result = await sandbox.__commerceOsA21V017TestHooks.clickModifySend();
  assert.equal(result.ok, false);
  assert.equal(result.code, "A21_MODIFY_SEND_BUTTON_AMBIGUOUS");
  assert.equal(requestCount, 0);
});

test("HF74 download contract exposes v0.6.37 and replaces both grouped dispatch and list click", async () => {
  const [route, page, planner] = await Promise.all([
    readFile("src/app/api/shopling-stock-state-sync/download-hf74/route.ts", "utf8"),
    readFile("src/app/china-order-manager/stock-control/page.tsx", "utf8"),
    readFile("src/lib/shoplingStockLaunchPlan.ts", "utf8"),
  ]);
  assert.match(route, /const BASE_VERSION = "0\.6\.36"/);
  assert.match(route, /const VERSION = "0\.6\.37"/);
  assert.match(route, /ONE_ASSIGNMENT_PER_COMPATIBLE_GROUP_UP_TO_200/);
  assert.match(route, /OPTION_OR_SINGLE_PER_COMPATIBLE_GROUP/);
  assert.match(route, /CAPTURED_ONCE_BEFORE_EACH_GROUPED_BATCH/);
  assert.match(route, /stockProductKindHf48: group\.effectiveProductKind/);
  assert.match(route, /await ensureResultBaselineV093\(active\)/);
  assert.match(route, /SHOPLING_MAIN_WORLD_EVENT_BRIDGE/);
  assert.match(page, /download-hf74/);
  assert.match(page, /v0\.6\.37 다운로드/);
  assert.match(planner, /ALL_DATE_STOCK_SYNC_MIN_VERSION = \[0, 6, 37\]/);
});
