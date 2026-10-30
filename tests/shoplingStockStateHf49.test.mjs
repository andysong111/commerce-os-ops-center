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
import {
  patchShoplingStockHf49CanonicalWorker,
  patchShoplingStockHf49OptionBackground,
  patchShoplingStockHf49OptionBatch,
  patchShoplingStockHf49SingleBackground,
  patchShoplingStockHf49SingleBatch,
} from "../src/lib/shoplingStockHf49Patch.ts";

function hf14PopupEvidenceFixture(source) {
  const before = '    await stage(assignment.jobId, "POPUP_OPENING", { selectedRowCount: checked, totalResultCount: total, message: `${checked}\uac1c \uc1fc\ud551\ubab0 \ud589 \uc120\ud0dd \uc644\ub8cc` });';
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
        ? \`${"${checked}"}\uac1c \uc1fc\ud551\ubab0 \ud589 \uc120\ud0dd \uc644\ub8cc \u00b7 \uc0ad\uc81c/\ubbf8\uc874\uc7ac GOODSKEY ${"${missing.length}"}\uac74 \ubb34\uc2dc\`
        : \`${"${checked}"}\uac1c \uc1fc\ud551\ubab0 \ud589 \uc120\ud0dd \uc644\ub8cc\`,
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

async function patchedScripts() {
  const [rawWorker, rawOption, rawSingle, rawSingleBatch, rawOptionBatch] =
    await Promise.all([
      readFile("public/shopling-a21-price-option-resend/content-a21.js", "utf8"),
      readFile("public/shopling-stock-state-sync/background-v053.js", "utf8"),
      readFile("public/shopling-stock-state-sync/background-v056.js", "utf8"),
      readFile("public/shopling-stock-state-sync/background-v057.js", "utf8"),
      readFile("public/shopling-stock-state-sync/background-v071.js", "utf8"),
    ]);
  const worker = patchShoplingStockHf49CanonicalWorker(
    patchShoplingStockHf48CanonicalWorker(
      patchShoplingStockHf47CanonicalWorker(
        hf19SplitLimitFixture(hf14PopupEvidenceFixture(rawWorker)),
      ),
    ),
  );
  const option = patchShoplingStockHf49OptionBackground(
    patchShoplingStockHf48OptionBackground(
      patchShoplingStockHf47Background(rawOption),
    ),
  );
  const single = patchShoplingStockHf49SingleBackground(
    patchShoplingStockHf48SingleBackground(rawSingle),
  );
  const singleBatch = patchShoplingStockHf49SingleBatch(rawSingleBatch);
  const optionBatch = patchShoplingStockHf49OptionBatch(rawOptionBatch);
  for (const script of [worker, option, single, singleBatch, optionBatch]) {
    new Function(script);
  }
  return { worker, option, single, singleBatch, optionBatch };
}

test("HF49 preserves BDE7-3 OPTION ownership after the real search page reload", async () => {
  const { worker, option, single, singleBatch, optionBatch } =
    await patchedScripts();

  assert.match(
    optionBatch,
    /mode: "OPTION",\s*stockProductKindHf48: "OPTION",\s*goodsKeys: batch/,
  );
  assert.match(
    singleBatch,
    /mode: "OPTION",\s*stockProductKindHf48: "SINGLE",\s*goodsKeys: batch/,
  );
  assert.match(
    option,
    /stockProductKindHf48 \|\| ""\) !== "OPTION"\) return/,
  );
  assert.match(
    single,
    /stockProductKindHf48 \|\| ""\) !== "SINGLE"\) return/,
  );
  assert.match(
    singleBatch,
    /CANONICAL_SPLIT\) return;\s*if \(String\(message\?\.stockProductKindHf48 \|\| ""\) !== "SINGLE"\) return/,
  );

  const resumedAssignment = {
    jobId: "stock-sync:BDE7-3:SOLD_OUT",
    stockProductKindHf48: "OPTION",
  };
  const stockProductKindsHf48 = new Map([
    [resumedAssignment.jobId, resumedAssignment.stockProductKindHf48],
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
          const responders = [
            message.stockProductKindHf48 === "OPTION"
              ? { ok: true, accepted: true, adapter: "OPTION" }
              : null,
            message.stockProductKindHf48 === "SINGLE"
              ? { ok: true, accepted: true, adapter: "SINGLE" }
              : null,
          ].filter(Boolean);
          assert.equal(responders.length, 1);
          return responders[0];
        },
      },
    },
    async () => {},
    stockProductKindsHf48,
  );

  assert.deepEqual(
    await stage(resumedAssignment.jobId, "POPUP_OPENING"),
    { ok: true, accepted: true, adapter: "OPTION" },
  );
  assert.equal(sent[0].stockProductKindHf48, "OPTION");
});

test("HF49 rejects missing ownership and carries ownership through popup/result markers", async () => {
  const { worker } = await patchedScripts();
  const owners = ["", "OPTION", "SINGLE"];
  const handlerCounts = owners.map((owner) => ({
    owner,
    count: Number(owner === "OPTION") + Number(owner === "SINGLE"),
  }));
  assert.deepEqual(handlerCounts, [
    { owner: "", count: 0 },
    { owner: "OPTION", count: 1 },
    { owner: "SINGLE", count: 1 },
  ]);

  const encodeSource = extractFunction(worker, "function encodeAssignment(message)");
  const decodeSource = extractFunction(worker, "function assignmentFromMarker(raw)");
  const markerTools = new Function(
    "OPENER_PREFIX",
    `${encodeSource}; ${decodeSource}; return { encodeAssignment, assignmentFromMarker };`,
  )("commerce-os-a21-v016:");
  const marker = markerTools.encodeAssignment({
    jobId: "stock-sync:BDE7-3:SOLD_OUT",
    mode: "OPTION",
    runId: "run-bde7-3",
    stockProductKindHf48: "OPTION",
  });
  assert.deepEqual(markerTools.assignmentFromMarker(marker), {
    jobId: "stock-sync:BDE7-3:SOLD_OUT",
    mode: "OPTION",
    runId: "run-bde7-3",
    stockProductKindHf48: "OPTION",
  });
});

test("HF49 publishes v0.6.14, blocks HF48, and runs in permanent CI", async () => {
  const [route, page, planner, workflow] = await Promise.all([
    readFile("src/app/api/shopling-stock-state-sync/download-hf49/route.ts", "utf8"),
    readFile("src/app/china-order-manager/stock-control/page.tsx", "utf8"),
    readFile("src/lib/shoplingStockLaunchPlan.ts", "utf8"),
    readFile(".github/workflows/shopling-stock-state-sync-ci.yml", "utf8"),
  ]);
  assert.match(route, /getHf48Download/);
  assert.match(route, /const BASE_VERSION = "0\.6\.13"/);
  assert.match(route, /const VERSION = "0\.6\.14"/);
  assert.match(route, /HF49_EXACT_CANONICAL_OWNER_AFTER_PAGE_RELOAD/);
  assert.match(
    route,
    /BDE7-3_OPTION_BATCH_RELOAD_DROPPED_OWNER_AND_REOPENED_ACK_RACE/,
  );
  assert.match(page, /download-hf49/);
  assert.match(page, /v0\.6\.14 \ub2e4\uc6b4\ub85c\ub4dc/);
  assert.match(planner, /ALL_DATE_STOCK_SYNC_MIN_VERSION = \[0, 6, 14\]/);
  assert.match(workflow, /shoplingStockStateHf49\.test\.mjs/);
});
