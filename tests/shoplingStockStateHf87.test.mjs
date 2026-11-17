import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  selectShoplingCoalescedJobs,
  shoplingOptionCoalescingKey,
} from "../src/lib/shoplingStockBatchCoalescing.ts";

const incidentJobs = [
  { jobId: "j1", barcode: "BDE7-1", productKind: "OPTION", modelNo: "AAA115", desiredStatus: "SOLD_OUT" },
  { jobId: "j2", barcode: "BDE7-3", productKind: "OPTION", modelNo: "AAA115", desiredStatus: "SOLD_OUT" },
  { jobId: "j3", barcode: "BDE8-1", productKind: "OPTION", modelNo: "AAA115", desiredStatus: "SOLD_OUT" },
  { jobId: "j4", barcode: "BDE7-2", productKind: "OPTION", modelNo: "AAA115", desiredStatus: "ON_SALE" },
];

test("HF87 groups the three same-model stockouts but keeps the opposite sale state separate", () => {
  const grouped = selectShoplingCoalescedJobs(incidentJobs, incidentJobs[0]);
  assert.deepEqual(grouped.map((job) => job.barcode), ["BDE7-1", "BDE7-3", "BDE8-1"]);
  assert.notEqual(shoplingOptionCoalescingKey(incidentJobs[0]), shoplingOptionCoalescingKey(incidentJobs[3]));
  assert.deepEqual(
    selectShoplingCoalescedJobs(
      [{ ...incidentJobs[0], productKind: "SINGLE" }],
      { ...incidentJobs[0], productKind: "SINGLE" },
    ).map((job) => job.barcode),
    ["BDE7-1"],
  );
});

async function opsHooks() {
  const source = await readFile("public/shopling-stock-state-sync/content-ops-v025.js", "utf8");
  const messages = [];
  const sandbox = { __COMMERCE_OS_EXPOSE_STOCK_HF87_OPS_TEST_HOOKS__: true };
  const window = {
    addEventListener() {},
    postMessage(message) { messages.push(message); },
  };
  const chrome = {
    runtime: {
      getManifest: () => ({ version: "0.6.50" }),
      onMessage: { addListener() {} },
    },
  };
  new Function("globalThis", "window", "location", "chrome", source)(
    sandbox,
    window,
    { origin: "https://commerce-os-ops-center.vercel.app" },
    chrome,
  );
  return { hooks: sandbox.__commerceOsStockHf87OpsTestHooks, messages };
}

test("HF87 applies all B-code API receipts before creating one deduplicated A21 job", async () => {
  const { hooks } = await opsHooks();
  const goodsKeys = ["116618", "116619", "116620", "116621", "116623", "116624"];
  const apiResults = incidentJobs.slice(0, 3).map((job) => ({
    goodsKeys,
    transmissions: goodsKeys.map((goodsKey) => ({
      goodsKey,
      optionCount: 6,
      transmissionKind: "OPTION_SEND",
      effectiveProductKind: "OPTION",
    })),
    receipts: [{ barcode: job.barcode, mutated: true }],
  }));
  const merged = hooks.buildCoalescedJob(incidentJobs.slice(0, 3), apiResults);
  assert.deepEqual(merged.goodsKeys, goodsKeys);
  assert.equal(merged.stockStateTransmissions.length, 6);
  assert.equal(merged.stockStateCoalescedApiCountHf87, 3);
  assert.equal(merged.stockStateCoalescedJobsHf87.length, 3);
  assert.deepEqual(
    merged.stockStateApiEvidence.map((row) => row.barcode),
    ["BDE7-1", "BDE7-3", "BDE8-1"],
  );
});

test("HF87 fans one A21 receipt back out to every original Commerce OS job", async () => {
  const { hooks, messages } = await opsHooks();
  hooks.postResultForJobs({
    jobId: "j1",
    job: { stockStateCoalescedJobsHf87: incidentJobs.slice(0, 3) },
    outcome: "SUCCEEDED",
    message: "A21 전송 완료",
    evidence: { code: "HF87_STABLE_BALANCED_SHOPLING_RESULT_TABLE" },
    finishedAt: 100,
  });
  assert.equal(messages.length, 3);
  assert.deepEqual(messages.map((message) => message.jobId), ["j1", "j2", "j3"]);
  assert.ok(messages.every((message) => message.outcome === "SUCCEEDED"));
  assert.ok(messages.every((message) => message.evidence.coalescedTransmission === true));
});

async function resultHooks() {
  const source = await readFile("public/shopling-stock-state-sync/background-v097.js", "utf8");
  const sandbox = { __COMMERCE_OS_EXPOSE_STOCK_HF87_TEST_HOOKS__: true };
  const chrome = {
    runtime: { getManifest: () => ({ version: "0.6.50" }) },
    tabs: {
      onUpdated: { addListener() {} },
      onCreated: { addListener() {} },
    },
    webNavigation: { onCompleted: { addListener() {} } },
    alarms: {
      onAlarm: { addListener() {} },
      create() {},
    },
  };
  new Function(
    "globalThis",
    "chrome",
    "importScripts",
    "setInterval",
    "setTimeout",
    source,
  )(
    sandbox,
    chrome,
    () => {},
    () => 0,
    () => 0,
  );
  return sandbox.__commerceOsStockHf87TestHooks;
}

test("HF87 accepts the real balanced result table even while a stale processing overlay remains", async () => {
  const hooks = await resultHooks();
  const evidence = hooks.resultTableEvidenceHf87(`
    쇼핑몰 상품옵션 수정 전송 결과입니다.
    총건수:1 성공건수:1 실패건수:0
    총건수:1 성공건수:1 실패건수:0
    처리중입니다. 잠시만 기다려주시기 바랍니다.
  `);
  assert.equal(evidence.authoritative, true);
  assert.equal(evidence.processingOverlayPresent, true);
  assert.equal(evidence.totalCount, 2);
  assert.equal(evidence.successCount, 2);
  assert.equal(evidence.failureCount, 0);
});

test("HF87 fails closed for a Shopling failure row or unbalanced result table", async () => {
  const hooks = await resultHooks();
  const failed = hooks.resultTableEvidenceHf87(
    "쇼핑몰 상품옵션 수정 전송 결과입니다. 총건수:2 성공건수:1 실패건수:1",
  );
  const unbalanced = hooks.resultTableEvidenceHf87(
    "쇼핑몰 상품옵션 수정 전송 결과입니다. 총건수:2 성공건수:1 실패건수:0",
  );
  assert.equal(failed.authoritative, false);
  assert.equal(failed.terminal, true);
  assert.equal(failed.rowsBalanced, true);
  assert.equal(unbalanced.authoritative, false);
  assert.equal(unbalanced.terminal, false);
  assert.equal(unbalanced.rowsBalanced, false);
});

test("HF87 package remains traceable while current UI supersedes same-model coalescing", async () => {
  const [route, page, planner, panel, queuePanel, workflow] = await Promise.all([
    readFile("src/app/api/shopling-stock-state-sync/download-hf87/route.ts", "utf8"),
    readFile("src/app/china-order-manager/stock-control/page.tsx", "utf8"),
    readFile("src/lib/shoplingStockLaunchPlan.ts", "utf8"),
    readFile("src/components/china-order-manager/InventoryStockoutOperatorPanel.tsx", "utf8"),
    readFile("src/components/china-order-manager/StockSyncOperationalQueuePanel.tsx", "utf8"),
    readFile(".github/workflows/shopling-stock-state-sync-ci.yml", "utf8"),
  ]);
  assert.match(route, /const VERSION = "0\.6\.50"/);
  assert.match(route, /APPLY_ALL_THEN_ONE_A21_SEND/);
  assert.match(route, /STABLE_BALANCED_SHOPLING_RESULT_TABLE/);
  assert.match(page, /download-hf94/);
  assert.match(page, /v0\.6\.56 다운로드/);
  assert.match(planner, /ALL_DATE_STOCK_SYNC_MIN_VERSION = \[0, 6, 56\]/);
  assert.doesNotMatch(panel, /selectShoplingCoalescedJobs/);
  assert.doesNotMatch(panel, /coalescedJobs: prepared/);
  assert.doesNotMatch(queuePanel, /selectShoplingCoalescedJobs/);
  assert.doesNotMatch(queuePanel, /coalescedJobs: prepared/);
  assert.match(workflow, /shoplingStockStateHf87\.test\.mjs/);
});
