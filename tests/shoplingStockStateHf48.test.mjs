import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  patchShoplingStockHf47Background,
  patchShoplingStockHf47CanonicalWorker,
} from "../src/lib/shoplingStockHf47Patch.ts";
import {
  patchShoplingStockHf48CanonicalWorker,
  patchShoplingStockHf48OptionBackground,
  patchShoplingStockHf48SingleBackground,
} from "../src/lib/shoplingStockHf48Patch.ts";

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

function hf19SplitLimitFixture(source) {
  const before = `await chrome.runtime.sendMessage({ type: "A21_SPLIT_REQUIRED", jobId: assignment.jobId, totalResultCount: total }).catch(() => null);`;
  const after = `await chrome.runtime.sendMessage({ type: "A21_SPLIT_REQUIRED", jobId: assignment.jobId, totalResultCount: total, batchLimit: 200 }).catch(() => null);`;
  assert.equal(source.includes(before), true);
  return source.replace(before, after);
}

test("HF48 routes the real BDE7-3 OPTION acknowledgement away from the SINGLE listener", async () => {
  const [rawWorker, rawOptionBackground, rawSingleBackground] =
    await Promise.all([
      readFile(
        "public/shopling-a21-price-option-resend/content-a21.js",
        "utf8",
      ),
      readFile("public/shopling-stock-state-sync/background-v053.js", "utf8"),
      readFile("public/shopling-stock-state-sync/background-v056.js", "utf8"),
    ]);
  const worker = patchShoplingStockHf48CanonicalWorker(
    patchShoplingStockHf47CanonicalWorker(
      hf19SplitLimitFixture(hf14PopupEvidenceFixture(rawWorker)),
    ),
  );
  const optionBackground = patchShoplingStockHf48OptionBackground(
    patchShoplingStockHf47Background(rawOptionBackground),
  );
  const singleBackground =
    patchShoplingStockHf48SingleBackground(rawSingleBackground);
  new Function(worker);
  new Function(optionBackground);
  new Function(singleBackground);

  assert.match(optionBackground, /stockProductKindHf48: "OPTION"/);
  assert.match(
    optionBackground,
    /stockProductKindHf48 \|\| ""\) === "SINGLE"\) return/,
  );
  assert.match(singleBackground, /stockProductKindHf48: "SINGLE"/);
  assert.match(
    singleBackground,
    /stockProductKindHf48 \|\| ""\) === "OPTION"\) return/,
  );
  assert.match(
    worker,
    /A21_SPLIT_REQUIRED[\s\S]*batchLimit: 200[\s\S]*stockProductKindHf48/,
  );

  const stockProductKindsHf48 = new Map([
    ["stock-sync:BDE7-3:SOLD_OUT", "OPTION"],
  ]);
  const sent = [];
  const stageSource = extractFunction(
    worker,
    "async function stage(jobId, nextStage, extra = {})",
  );
  const stage = new Function(
    "chrome",
    "sleep",
    "stockProductKindsHf48",
    `${stageSource}; return stage;`,
  )(
    {
      runtime: {
        sendMessage: async (message) => {
          sent.push(message);
          const singleResponse =
            message.stockProductKindHf48 === "OPTION"
              ? undefined
              : { ok: false, ignored: true };
          const optionResponse =
            message.stockProductKindHf48 === "SINGLE"
              ? undefined
              : { ok: true, accepted: true };
          return singleResponse ?? optionResponse ?? null;
        },
      },
    },
    async () => {},
    stockProductKindsHf48,
  );

  assert.deepEqual(
    await stage("stock-sync:BDE7-3:SOLD_OUT", "POPUP_OPENING"),
    { ok: true, accepted: true },
  );
  assert.equal(sent.length, 1);
  assert.equal(sent[0].stockProductKindHf48, "OPTION");
});

test("HF48 gives SINGLE list stages the same explicit persisted acknowledgement contract", async () => {
  const raw = await readFile(
    "public/shopling-stock-state-sync/background-v056.js",
    "utf8",
  );
  const patched = patchShoplingStockHf48SingleBackground(raw);
  assert.match(
    patched,
    /if \(next === "SEARCH_SUBMITTED"\)[\s\S]*return \{ ok: true, accepted: true \};/,
  );
  assert.match(
    patched,
    /if \(next === "POPUP_OPENING"\)[\s\S]*return \{ ok: true, accepted: true \};/,
  );
  assert.doesNotMatch(
    patched,
    /if \(message\.type === CANONICAL_STAGE\) \{\s*void canonicalSingleStage/,
  );
});

test("HF48 publishes v0.6.13, rejects HF47 at launch, and is permanent CI coverage", async () => {
  const [route, page, planner, workflow] = await Promise.all([
    readFile(
      "src/app/api/shopling-stock-state-sync/download-hf48/route.ts",
      "utf8",
    ),
    readFile("src/app/china-order-manager/stock-control/page.tsx", "utf8"),
    readFile("src/lib/shoplingStockLaunchPlan.ts", "utf8"),
    readFile(".github/workflows/shopling-stock-state-sync-ci.yml", "utf8"),
  ]);
  assert.match(route, /getHf47Download/);
  assert.match(route, /const BASE_VERSION = "0\.6\.12"/);
  assert.match(route, /const VERSION = "0\.6\.13"/);
  assert.match(route, /HF48_CANONICAL_MESSAGE_ROUTE_ACK/);
  assert.match(
    route,
    /BDE7-3_OPTION_ACK_RACED_BY_SINGLE_BACKGROUND_LISTENER/,
  );
  assert.match(page, /download-hf48/);
  assert.match(page, /v0\.6\.13 다운로드/);
  assert.match(
    planner,
    /ALL_DATE_STOCK_SYNC_MIN_VERSION = \[0, 6, 13\]/,
  );
  assert.match(workflow, /shoplingStockStateHf48\.test\.mjs/);
});
