import assert from "node:assert/strict";
import test from "node:test";
import {
  runShoplingDailyFulfillment,
  SHOPLING_DAILY_STAGES,
  validateFulfillmentDate,
} from "../local-agent/src/shopling-daily-fulfillment.mjs";
import {
  canTreatCollectionPopupClosureAsComplete,
  isShoplingQnaContinuationScreen,
  isExpectedShoplingCollectionPopupPath,
  isShoplingCollectionPopupComplete,
  matchesExpectedShoplingAccount,
  SHOPLING_DAILY_AUTOMATION_RULES,
} from "../local-agent/src/shopling-daily-browser-adapter.mjs";

function config() {
  return { dataDir: "C:/tmp/commerce-os-test", shoplingOrigins: ["https://a.shopling.co.kr/"] };
}

function harness(overrides = {}) {
  const calls = [];
  const checkpoints = [];
  const adapter = {
    collectAll: async ({ execute }) => {
      calls.push(["collect", execute]);
      return { executed: execute, jobs: ["orders", "claims", "questions"] };
    },
    processMapping: async ({ execute }) => {
      calls.push(["mapping", execute]);
      return overrides.mapping || { executed: execute, needsReview: false, mapped: { count: 2, orderNumbers: ["101", "102"] } };
    },
    moveNewOrdersToReady: async ({ date, execute }) => {
      calls.push(["ready", execute, date]);
      return { executed: execute, before: { count: 2, orderNumbers: ["101", "102"] }, afterCount: execute ? 0 : 2 };
    },
    transmitPending: async ({ date, execute }) => {
      calls.push(["transmit", execute, date]);
      return overrides.transmission || { executed: execute, pending: { count: 2 }, completedOrderNumbers: execute ? ["101", "102"] : [] };
    },
    prepareLabels: async ({ execute, orderNumbers }) => {
      calls.push(["labels", execute, orderNumbers]);
      return { executed: execute, orderCount: orderNumbers.length };
    },
  };
  return {
    calls,
    checkpoints,
    dependencies: {
      adapter,
      ensureDataDirs: async () => {},
      readJsonFile: async () => null,
      writeJsonAtomic: async (_path, value) => { checkpoints.push(structuredClone(value)); },
      writeAgentState: async () => {},
      createShoplingLabelPdfFromSettings: async (_config, options) => {
        calls.push(["capture", options]);
        return { outputPath: "C:/tmp/labels.pdf", orderCount: options.expectedOrders, pageCount: 1 };
      },
      runWindowsPdfPrint: async (options) => {
        calls.push(["print", options]);
        return { executed: true, pageCount: options.expectedPages, jobId: 7 };
      },
    },
  };
}

test("daily fulfillment rules lock all three collections, exact packaging, courier, and sort", () => {
  assert.deepEqual(SHOPLING_DAILY_AUTOMATION_RULES.collectionJobs, ["orders", "claims", "questions"]);
  assert.equal(SHOPLING_DAILY_AUTOMATION_RULES.collectionExecutionMode, "parallel");
  assert.deepEqual(SHOPLING_DAILY_AUTOMATION_RULES.mappingLookupPriority, [
    "VERIFIED_B_CODE",
    "MODEL_NUMBER",
    "SHOPPING_MALL_PRODUCT_CODE",
  ]);
  assert.deepEqual(SHOPLING_DAILY_AUTOMATION_RULES.mappingLookupForbiddenSources, ["SITE_SELF_CODE"]);
  assert.equal(SHOPLING_DAILY_AUTOMATION_RULES.autoPackageValue, "d");
  assert.equal(SHOPLING_DAILY_AUTOMATION_RULES.autoPackageLabel, "우편번호 + 주소 + 수취인 + 전화번호 + 쇼핑몰명");
  assert.equal(SHOPLING_DAILY_AUTOMATION_RULES.courierLabelFragment, "도소매사우루스");
  assert.deepEqual(SHOPLING_DAILY_AUTOMATION_RULES.completedSort, ["sort_tp_ptn_opt_cd", "asc", "A", "asc"]);
});

test("Shopling account verification finds the account marker in nested frames", () => {
  const frames = [
    { value: { path: "/", header: "" } },
    { value: { path: "/main.phtml", header: "동네일등 [andy801] - 78 로그아웃" } },
  ];

  assert.equal(matchesExpectedShoplingAccount(frames, "andy801"), true);
  assert.equal(matchesExpectedShoplingAccount(frames, "andy80101"), false);
  assert.equal(matchesExpectedShoplingAccount([{ value: { path: "/login.phtml", header: "[andy801]" } }], "andy801"), false);
});

test("collection popup completion accepts queued requests but waits for active processing", () => {
  assert.equal(isShoplingCollectionPopupComplete(
    "AliExpress 주문 수집 결과입니다. 총 2건중 2건 성공, 0건 실패, 0건 주문 수집 되었습니다. [2026.10.02 04:10:14]",
  ), true);
  assert.equal(isShoplingCollectionPopupComplete(
    "AliExpress 주문 수집 결과입니다. 총 2 건중 2건 성공, 0건 실패, 0건 주문 수집 되었습니다.",
  ), true);
  assert.equal(isShoplingCollectionPopupComplete(
    "AliExpress 주문 수집 결과입니다. 총 2건중 2건 성공, 0건 실패, 0건 주문 수집 되었습니다. 셀러 주문 수집 요청중입니다.",
  ), true);
  assert.equal(isShoplingCollectionPopupComplete(
    "AliExpress 주문 수집 결과입니다. 총 2건중 2건 성공, 0건 실패, 0건 주문 수집 되었습니다. 셀러 주문 수집중입니다.",
  ), false);
  assert.equal(isShoplingCollectionPopupComplete(
    "AliExpress 주문 수집 결과입니다. 총 2건중 2건 성공, 0건 실패, 0건 주문 수집 되었습니다. 셀러 처리중입니다.",
  ), false);
  assert.equal(isShoplingCollectionPopupComplete("주문 수집 요청중입니다."), false);
});

test("collection popup accepts the Shopling result-page redirect for the same job", () => {
  assert.equal(isExpectedShoplingCollectionPopupPath("/order_a/order_gather.phtml", "/order/order_gather_act_sp.phtml"), true);
  assert.equal(isExpectedShoplingCollectionPopupPath("/claim_a/claim_gather.phtml", "/claim/claim_gather_act_sp.phtml"), true);
  assert.equal(isExpectedShoplingCollectionPopupPath("/qna_a/qna_gather.phtml", "/qna/qna_gather_act_sp.phtml"), true);
  assert.equal(isExpectedShoplingCollectionPopupPath("/claim_a/claim_gather.phtml", "/order/order_gather_act_sp.phtml"), false);
});

test("QnA collection recognizes only the exact supported-mall continuation screen", () => {
  const text = "§ 주문 > [B1] 주문자동수집 > 문의수집중.. 쿠팡 API Key 유효기간 오류 지원 쇼핑몰 문의수집 계속하기";
  assert.equal(isShoplingQnaContinuationScreen("/qna/qna_gather_act_sp.phtml", text), true);
  assert.equal(isShoplingQnaContinuationScreen("/order/order_gather_act_sp.phtml", text), false);
  assert.equal(isShoplingQnaContinuationScreen("/qna/qna_gather_act_sp.phtml", "문의수집중.."), false);
});

test("collection popup closure is accepted only after result evidence was observed", () => {
  assert.equal(canTreatCollectionPopupClosureAsComplete({
    hasResult: true,
    hasTotal: true,
    hasCollected: true,
    hasPending: true,
  }), true);
  assert.equal(canTreatCollectionPopupClosureAsComplete({
    hasResult: false,
    hasTotal: true,
    hasCollected: true,
  }), false);
});

test("one execute run reaches direct label print in the required stage order", async () => {
  const testHarness = harness();
  const result = await runShoplingDailyFulfillment(config(), {
    date: "20261002",
    account: "andy801",
    execute: true,
  }, testHarness.dependencies);

  assert.equal(result.status, "completed");
  assert.deepEqual(testHarness.calls.map((call) => call[0]), ["collect", "mapping", "ready", "transmit", "labels", "capture", "print"]);
  assert.equal(testHarness.calls.find((call) => call[0] === "capture")[1].expectedOrders, 2);
  assert.equal(testHarness.calls.find((call) => call[0] === "capture")[1].autoDetectPages, true);
  assert.equal(testHarness.calls.find((call) => call[0] === "print")[1].expectedPages, 1);
  assert.equal(testHarness.checkpoints.at(-1).currentStage, "COMPLETE");
  assert.deepEqual(Object.keys(testHarness.checkpoints.at(-1).stages), SHOPLING_DAILY_STAGES);
});

test("an already transmitted batch still reaches label output after a resumed pipeline", async () => {
  const testHarness = harness({
    transmission: {
      executed: false,
      pending: { count: 0, orderNumbers: [] },
      completed: { count: 2, orderNumbers: ["201", "202"] },
      completedOrderNumbers: ["201", "202"],
      reusedCompleted: true,
    },
  });
  const result = await runShoplingDailyFulfillment(config(), {
    date: "20261002",
    account: "andy801",
    execute: true,
  }, testHarness.dependencies);

  assert.equal(result.status, "completed");
  assert.deepEqual(testHarness.calls.find((call) => call[0] === "labels")[2], ["201", "202"]);
  assert.equal(testHarness.calls.find((call) => call[0] === "capture")[1].expectedOrders, 2);
  assert.equal(testHarness.calls.find((call) => call[0] === "print")[1].expectedPages, 1);
});

test("unmapped orders stop the run before B7 and preserve a review checkpoint", async () => {
  const testHarness = harness({
    mapping: { executed: false, needsReview: true, unmapped: { count: 1, orderNumbers: ["991"] } },
  });
  const result = await runShoplingDailyFulfillment(config(), {
    date: "20261002",
    execute: true,
  }, testHarness.dependencies);

  assert.equal(result.status, "needs_mapping_review");
  assert.deepEqual(testHarness.calls.map((call) => call[0]), ["collect", "mapping"]);
  assert.equal(testHarness.checkpoints.at(-1).stages.MAP_AND_CONFIRM.status, "needs_review");
});

test("dry-run traverses inspection stages without capture or printer execution", async () => {
  const testHarness = harness();
  const result = await runShoplingDailyFulfillment(config(), {
    date: "20261002",
    execute: false,
  }, testHarness.dependencies);

  assert.equal(result.status, "dry_run_completed");
  assert.deepEqual(testHarness.calls.map((call) => call[0]), ["collect", "mapping", "ready", "transmit", "labels"]);
  assert.equal(testHarness.calls.some((call) => call[0] === "capture" || call[0] === "print"), false);
});

test("resume skips succeeded stages and continues from mapping review", async () => {
  const testHarness = harness();
  testHarness.dependencies.readJsonFile = async () => ({
    version: 1,
    date: "20261002",
    mode: "execute",
    status: "needs_mapping_review",
    currentStage: "MAP_AND_CONFIRM",
    stages: {
      COLLECT_ORDER_CLAIM_QNA: { status: "succeeded", result: { executed: true, jobs: ["orders", "claims", "questions"] } },
      MAP_AND_CONFIRM: { status: "needs_review", result: { needsReview: true } },
    },
  });
  const result = await runShoplingDailyFulfillment(config(), {
    date: "20261002",
    execute: true,
    resume: true,
  }, testHarness.dependencies);

  assert.equal(result.status, "completed");
  assert.deepEqual(testHarness.calls.map((call) => call[0]), ["mapping", "ready", "transmit", "labels", "capture", "print"]);
});

test("fulfillment dates reject malformed or impossible calendar values", () => {
  assert.equal(validateFulfillmentDate("20261002"), "20261002");
  assert.throws(() => validateFulfillmentDate("2026-10-02"), { code: "SHOPLING_DAILY_DATE_INVALID" });
  assert.throws(() => validateFulfillmentDate("20260231"), { code: "SHOPLING_DAILY_DATE_INVALID" });
});
