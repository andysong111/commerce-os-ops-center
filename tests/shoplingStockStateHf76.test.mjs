import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { patchHf74CanonicalListSource } from "../src/lib/shoplingStockHf74Patch.ts";
import { patchHf75CanonicalListSource } from "../src/lib/shoplingStockHf75Patch.ts";
import { patchHf76CanonicalListSource } from "../src/lib/shoplingStockHf76Patch.ts";

function patchedCanonical() {
  return readFile(
    "public/shopling-a21-price-option-resend/content-a21.js",
    "utf8",
  ).then((base) =>
    patchHf76CanonicalListSource(
      patchHf75CanonicalListSource(patchHf74CanonicalListSource(base)),
    ),
  );
}

test("HF76 patches the real v0.6.38 parent that already guards the 200-row selector", async () => {
  const base = await readFile(
    "public/shopling-a21-price-option-resend/content-a21.js",
    "utf8",
  );
  const hf75 = patchHf75CanonicalListSource(
    patchHf74CanonicalListSource(base),
  ).replace(
    "    setPageSize500();",
    '    if (!setPageSize200HF19()) return fail(assignment.jobId, "A21_PAGE_SIZE_200_SET_FAILED", "A21 화면출력을 200개로 고정하지 못했습니다.");',
  );
  const source = patchHf76CanonicalListSource(hf75);
  assert.match(source, /function setPageSize200Hf76\(\)/);
  assert.match(source, /prepareListAssignmentHf76/);
  assert.match(source, /const VERSION = "0\.1\.9"/);
});

test("HF76 keeps one worker owner across LIST_START and SEARCH_SUBMITTED", async () => {
  const source = await patchedCanonical();
  const sandbox = { __COMMERCE_OS_EXPOSE_A21_V019_TEST_HOOKS__: true };
  const window = { name: "", setTimeout };
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
    { querySelectorAll: () => [] },
    window,
    class {},
    class {},
    class {},
    class {},
    class {},
    setTimeout,
  );
  const hooks = sandbox.__commerceOsA21V019TestHooks;
  const listStart = {
    jobId: "bbc4-3",
    mode: "OPTION",
    runId: "run-76",
    stage: "LIST_START_0_0_run-76",
    stockProductKindHf48: "OPTION",
    goodsKeys: ["111882", "122563"],
  };
  const marker = hooks.assignmentFromMarker(hooks.encodeAssignment(listStart));
  assert.equal(
    hooks.markerOwnsAssignmentHf75(marker, {
      ...listStart,
      stage: "SEARCH_SUBMITTED",
    }),
    true,
  );
  assert.equal(
    hooks.assignmentOwnerKeyHf76(listStart),
    "bbc4-3:run-76:OPTION:111882,122563",
  );
  assert.match(source, /const VERSION = "0\.1\.9"/);
  new Function(source);
});

test("HF76 prepared acknowledgement proves the exact query and never rewrites a stale post-search query", async () => {
  const source = await patchedCanonical();

  class FakeElement {
    constructor(text = "") {
      this.textContent = text;
      this.parentElement = null;
      this.previousSibling = null;
      this.nextSibling = null;
      this.offsetParent = {};
      this.id = "";
    }
    getBoundingClientRect() {
      return { width: 20, height: 20, top: 10, left: 10 };
    }
    getAttribute() {
      return "";
    }
    closest() {
      return null;
    }
    dispatchEvent() {
      return true;
    }
  }
  class FakeInput extends FakeElement {
    constructor(type, text = "") {
      super(text);
      this.type = type;
      this.value = "";
      this.checked = false;
      this.disabled = false;
      this.name = "";
      this.parentElement = { textContent: text };
    }
    click() {
      this.checked = true;
    }
    closest(selector) {
      if (selector === "tr") return { textContent: this.parentElement.textContent };
      return null;
    }
  }
  class FakeSelect extends FakeElement {
    constructor(labels) {
      super();
      this.options = labels.map((label) => ({ textContent: label, value: label }));
      this.value = labels[0];
    }
  }
  class FakeEvent {
    constructor(type, options) {
      this.type = type;
      this.options = options;
    }
  }

  const pageSize = new FakeSelect(["25", "50", "100", "200", "500"]);
  const searchField = new FakeSelect(["검색항목", "샵플링상품코드"]);
  const allDate = new FakeInput("checkbox", "전체");
  const priceSource = new FakeInput("radio", "쇼핑몰별판매가");
  const searchInput = new FakeInput(
    "text",
    "검색항목 샵플링상품코드 다중검색",
  );
  const document = {
    body: {
      innerText:
        "쇼핑몰상품수정 상품 수정전송 검색항목 샵플링상품코드 쇼핑몰별판매가",
    },
    querySelector(selector) {
      if (selector.includes("all_srch_no_term_btn")) return allDate;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === "select") return [pageSize, searchField];
      if (selector === 'input[type="radio"]') return [priceSource];
      if (selector === 'input[type="text"], textarea') return [searchInput];
      return [];
    },
  };
  const sandbox = { __COMMERCE_OS_EXPOSE_A21_V019_TEST_HOOKS__: true };
  const window = { name: "", setTimeout };
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
    document,
    window,
    FakeElement,
    FakeInput,
    class {},
    class {},
    FakeEvent,
    setTimeout,
  );
  const hooks = sandbox.__commerceOsA21V019TestHooks;
  const assignment = {
    jobId: "bbc4-3",
    mode: "OPTION",
    runId: "run-76",
    stage: "LIST_START_0_0_run-76",
    stockProductKindHf48: "OPTION",
    goodsKeys: ["111882", "122563"],
  };
  const prepared = hooks.prepareListAssignmentHf76(assignment);
  assert.deepEqual(
    {
      ok: prepared.ok,
      accepted: prepared.accepted,
      prepared: prepared.prepared,
      ownerKey: prepared.ownerKey,
      goodsKeyQuery: prepared.goodsKeyQuery,
      goodsKeyCount: prepared.goodsKeyCount,
    },
    {
      ok: true,
      accepted: true,
      prepared: true,
      ownerKey: "bbc4-3:run-76:OPTION:111882,122563",
      goodsKeyQuery: "111882,122563",
      goodsKeyCount: 2,
    },
  );
  assert.equal(searchInput.value, "111882,122563");
  assert.ok(window.name.startsWith("commerce-os-a21-v016:"));

  const postSearch = hooks.prepareListAssignmentHf76({
    ...assignment,
    stage: "SEARCH_SUBMITTED",
  });
  assert.equal(postSearch.prepared, true);
  searchInput.value = "999999";
  const stale = hooks.prepareListAssignmentHf76({
    ...assignment,
    stage: "SEARCH_SUBMITTED",
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.code, "A21_LIST_QUERY_OWNER_MISMATCH_HF75");
  assert.equal(searchInput.value, "999999");
});

test("HF76 background rejects a weak accepted reply and accepts only the prepared owner/query receipt", async () => {
  const source = await readFile(
    "public/shopling-stock-state-sync/background-v095.js",
    "utf8",
  );
  const sandbox = { __COMMERCE_OS_EXPOSE_STOCK_HF76_TEST_HOOKS__: true };
  new Function(
    "globalThis",
    "importScripts",
    "chrome",
    "dispatchCurrent",
    "dispatchToTarget",
    "saveActive",
    "progress",
    "sleep",
    source,
  )(
    sandbox,
    () => {},
    { runtime: { getManifest: () => ({ version: "0.6.39" }) } },
    () => false,
    () => false,
    async () => {},
    async () => {},
    async () => {},
  );
  const hooks = sandbox.__commerceOsStockHf76TestHooks;
  const active = {
    status: "RUNNING",
    stage: "A21_LIST",
    goodsKeyIndex: 0,
    optionBatchLimit: 200,
    job: {
      jobId: "bbc4-3",
      executionId: "run-76",
      stockStateApiApplied: true,
      stockStateTransmissionGroupsHf72: [
        {
          transmissionKind: "OPTION_SEND",
          effectiveProductKind: "OPTION",
          goodsKeys: ["111882", "122563"],
          optionCounts: { 111882: 2, 122563: 2 },
        },
      ],
    },
  };
  const prepared = hooks.prepareGroupedBatchV095(active);
  const assignment = hooks.canonicalAssignmentV095(
    active,
    prepared.group,
    prepared.batch,
  );
  assert.equal(
    hooks.preparedAckMatchesV095({ ok: true, accepted: true }, assignment),
    false,
  );
  assert.equal(
    hooks.preparedAckMatchesV095(
      {
        ok: true,
        accepted: true,
        prepared: true,
        role: "A21_LIST",
        version: "0.1.9",
        ownerKey: hooks.assignmentOwnerKeyV095(assignment),
        goodsKeyQuery: "111882,122563",
        goodsKeyCount: 2,
      },
      assignment,
    ),
    true,
  );
  assert.match(source, /SHOPLING_HF76_PREPARED_ACK_MISSING/);
  new Function(source);
});

test("HF76 download contract remains reproducible after HF77 becomes required", async () => {
  const [route, page, planner, workflow] = await Promise.all([
    readFile("src/app/api/shopling-stock-state-sync/download-hf76/route.ts", "utf8"),
    readFile("src/app/china-order-manager/stock-control/page.tsx", "utf8"),
    readFile("src/lib/shoplingStockLaunchPlan.ts", "utf8"),
    readFile(".github/workflows/shopling-stock-state-sync-ci.yml", "utf8"),
  ]);
  assert.match(route, /const BASE_VERSION = "0\.6\.38"/);
  assert.match(route, /const VERSION = "0\.6\.39"/);
  assert.match(route, /EXACT_OWNER_AND_EXACT_GOODS_KEY_QUERY_PREPARED_BEFORE_ACK/);
  assert.match(page, /download-hf77/);
  assert.match(page, /v0\.6\.40 다운로드/);
  assert.match(planner, /ALL_DATE_STOCK_SYNC_MIN_VERSION = \[0, 6, 40\]/);
  assert.match(workflow, /shoplingStockStateHf76\.test\.mjs/);
  assert.match(workflow, /background-v095\.js/);
});
