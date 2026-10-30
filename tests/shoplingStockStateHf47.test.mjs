import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  patchShoplingStockHf47Background,
  patchShoplingStockHf47CanonicalWorker,
} from "../src/lib/shoplingStockHf47Patch.ts";

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `missing ${signature}`);
  const bodyMarker = source.indexOf(") {", start);
  assert.notEqual(bodyMarker, -1, `missing function body for ${signature}`);
  const open = bodyMarker + 2;
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated ${signature}`);
}

function hf14PopupEvidenceFixture(source) {
  const before = '    await stage(assignment.jobId, "POPUP_OPENING", { selectedRowCount: checked, totalResultCount: total, message: `${checked}개 쇼핑몰 행 선택 완료` });';
  const after = `    const singleStockBatch = false;
    await stage(assignment.jobId, "POPUP_OPENING", {
      selectedRowCount: checked,
      totalResultCount: total,
      requestedGoodsKeyCount: assignment.goodsKeys.length,
      matchedGoodsKeyCount: seen.size,
      missingGoodsKeys: singleStockBatch ? missing : [],
      missingGoodsKeysIgnored: Boolean(singleStockBatch && missing.length),
      returnedRowsRestrictedToRequestedGoodsKeys: matched.length === total,
      message: singleStockBatch && missing.length
        ? \`${"${checked}"}개 쇼핑몰 행 선택 완료 · 삭제/미존재 GOODSKEY ${"${missing.length}"}건 무시\`
        : \`${"${checked}"}개 쇼핑몰 행 선택 완료\`,
    });`;
  assert.equal(source.includes(before), true);
  return source.replace(before, after);
}

test("HF47 BDE7-3 fixture blocks 상품 수정전송 when POPUP_OPENING is not acknowledged", async () => {
  const raw = await readFile(
    "public/shopling-a21-price-option-resend/content-a21.js",
    "utf8",
  );
  const patched = patchShoplingStockHf47CanonicalWorker(
    hf14PopupEvidenceFixture(raw),
  );
  new Function(patched);

  const source = extractFunction(
    patched,
    "async function selectRowsAndOpenPopup(assignment)",
  );
  const goodsKeys = ["116618", "116619", "116620", "116621", "116623", "116624"];
  const matched = goodsKeys.map((goodsKey) => ({
    goodsKey,
    checkbox: { checked: false },
  }));
  let clicks = 0;
  const failures = [];
  const factory = new Function(
    "role",
    "fail",
    "waitForSearchResultEvidence",
    "MAX_VISIBLE_RESULTS",
    "selectMallSpecificPriceSource",
    "findResultRows",
    "setControl",
    "markWorker",
    "stage",
    "clickModifySend",
    `${source}; return selectRowsAndOpenPopup;`,
  );
  const run = factory(
    () => "A21_LIST",
    async (_jobId, code, message) => failures.push({ code, message }),
    async () => ({ ready: true, total: 6 }),
    500,
    () => true,
    () => ({ matched, seen: new Set(goodsKeys), target: new Set(goodsKeys) }),
    (checkbox) => {
      checkbox.checked = true;
    },
    () => {},
    async () => null,
    () => {
      clicks += 1;
      return true;
    },
  );

  await run({ jobId: "stock-sync:BDE7-3:SOLD_OUT", goodsKeys });
  assert.equal(clicks, 0);
  assert.deepEqual(
    failures.map((item) => item.code),
    ["A21_POPUP_OPENING_STAGE_NOT_ACKNOWLEDGED_HF47"],
  );
});
test("HF47 keeps the acknowledged normal path and retries only the ledger message", async () => {
  const raw = await readFile(
    "public/shopling-a21-price-option-resend/content-a21.js",
    "utf8",
  );
  const patched = patchShoplingStockHf47CanonicalWorker(
    hf14PopupEvidenceFixture(raw),
  );
  const stageSource = extractFunction(patched, "async function stage(jobId, nextStage, extra = {})");
  let attempts = 0;
  const stage = new Function(
    "chrome",
    "sleep",
    `${stageSource}; return stage;`,
  )(
    {
      runtime: {
        sendMessage: async () => {
          attempts += 1;
          return attempts === 2 ? { ok: true, accepted: true } : null;
        },
      },
    },
    async () => {},
  );
  assert.deepEqual(await stage("job", "POPUP_OPENING"), {
    ok: true,
    accepted: true,
  });
  assert.equal(attempts, 2);
});

test("HF47 closes a stale BDE7-3 SEARCH_SUBMITTED ledger without mutation or transmission", async () => {
  const raw = await readFile(
    "public/shopling-stock-state-sync/background-v053.js",
    "utf8",
  );
  const patched = patchShoplingStockHf47Background(raw);
  new Function(patched);
  const source = extractFunction(
    patched,
    "async function failStaleSearchSubmittedHf47(trigger)",
  );
  const active = {
    status: "RUNNING",
    stage: "A21_LIST",
    stageStartedAt: 1,
    a21CanonicalStage: "SEARCH_SUBMITTED",
    a21CanonicalStageAt: 1,
    job: {
      jobId: "stock-sync:BDE7-3:SOLD_OUT:2026-10-13T13:22:03.111Z",
      barcode: "BDE7-3",
      productKind: "OPTION",
      optionApiApplied: true,
      goodsKeys: ["116618", "116619", "116620", "116621", "116623", "116624"],
    },
  };
  const finishes = [];
  const recover = new Function(
    "loadActive",
    "chrome",
    "POPUP_MATCH",
    "finish",
    `${source}; return failStaleSearchSubmittedHf47;`,
  )(
    async () => active,
    { tabs: { query: async () => [] } },
    "popup-pattern",
    async (...args) => {
      finishes.push(args);
      return { status: args[1] };
    },
  );

  assert.deepEqual(await recover("regression"), { status: "FAILED" });
  assert.equal(finishes.length, 1);
  assert.equal(finishes[0][1], "FAILED");
  assert.equal(finishes[0][3].optionApiMutationRepeatedByRecovery, false);
  assert.equal(finishes[0][3].a21TransmissionSubmittedByRecovery, false);
  assert.equal(finishes[0][3].priorA21TransmissionSubmitted, false);
  assert.equal(finishes[0][3].retryAllowedAutomatically, false);
  assert.equal(
    finishes[0][3].incident,
    "BDE7-3_SIX_NOOP_OPTIONS_POPUP_OPENED_WITHOUT_STAGE_ACK",
  );
});

test("HF47 publishes v0.6.12 and is permanently wired into stock CI", async () => {
  const [route, page, planner, workflow] = await Promise.all([
    readFile(
      "src/app/api/shopling-stock-state-sync/download-hf47/route.ts",
      "utf8",
    ),
    readFile("src/app/china-order-manager/stock-control/page.tsx", "utf8"),
    readFile("src/lib/shoplingStockLaunchPlan.ts", "utf8"),
    readFile(".github/workflows/shopling-stock-state-sync-ci.yml", "utf8"),
  ]);
  assert.match(route, /getHf46Download/);
  assert.match(route, /const BASE_VERSION = "0\.6\.11"/);
  assert.match(route, /const VERSION = "0\.6\.12"/);
  assert.match(route, /HF47_POPUP_OPENING_STAGE_ACK_FAIL_CLOSED/);
  assert.match(page, /download-hf48/);
  assert.match(page, /v0\.6\.13 다운로드/);
  assert.match(planner, /ALL_DATE_STOCK_SYNC_MIN_VERSION = \[0, 6, 13\]/);
  assert.match(workflow, /shoplingStockStateHf47\.test\.mjs/);
});
