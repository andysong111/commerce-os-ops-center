import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildInternalChinaCostPriceDecision,
  costDefensePrice,
} from "../src/lib/internalChinaCostPricePolicy.ts";

const [review, approvalRoute, dispatcherRoute, reviewPage, receiptPanel] =
  await Promise.all([
    readFile("src/lib/internalChinaCostPriceReview.ts", "utf8"),
    readFile(
      "src/app/api/china-order-manager/price-review/approve/route.ts",
      "utf8",
    ),
    readFile("src/app/api/cron/receipt-live-price-proposals/route.ts", "utf8"),
    readFile("src/app/china-order-manager/price-review/page.tsx", "utf8"),
    readFile(
      "src/components/china-order-manager/InternalChinaReceiptPanel.tsx",
      "utf8",
    ),
  ]);

test("v1 cost snapshot still raises price below bare confirmed-cost floor", () => {
  const result = buildInternalChinaCostPriceDecision({
    currentPrice: 1000,
    latestCostKrw: 600,
    previousCostKrw: 500,
  });
  assert.equal(result.targetPrice, 1200);
  assert.equal(result.direction, "INCREASE");
  assert.equal(result.changeRequired, true);
});

test("v1 cost snapshot still recognizes confirmed-cost drop", () => {
  const result = buildInternalChinaCostPriceDecision({
    currentPrice: 1500,
    latestCostKrw: 500,
    previousCostKrw: 700,
  });
  assert.equal(result.targetPrice, 1000);
  assert.equal(result.direction, "DECREASE");
  assert.equal(result.changeRequired, true);
});

test("first confirmed cost never causes a v1 automatic markdown", () => {
  const result = buildInternalChinaCostPriceDecision({
    currentPrice: 1500,
    latestCostKrw: 500,
    previousCostKrw: null,
  });
  assert.equal(result.targetPrice, 1000);
  assert.equal(result.direction, "HOLD");
  assert.equal(result.changeRequired, false);
});

test("unchanged cost with sufficient margin holds current price in v1 snapshot", () => {
  const result = buildInternalChinaCostPriceDecision({
    currentPrice: 1000,
    latestCostKrw: 500,
    previousCostKrw: 500,
  });
  assert.equal(result.targetPrice, 1000);
  assert.equal(result.direction, "HOLD");
  assert.equal(result.changeRequired, false);
});

test("missing current price is fail-closed", () => {
  const result = buildInternalChinaCostPriceDecision({
    currentPrice: 0,
    latestCostKrw: 500,
    previousCostKrw: 700,
  });
  assert.equal(result.direction, "BLOCKED");
  assert.equal(result.blockedReason, "CURRENT_PRICE_MISSING");
  assert.equal(result.changeRequired, false);
});

test("multi-unit v1 snapshot preserves every unit cost before v2 group overlay", () => {
  assert.equal(costDefensePrice(500, 3), 3000);
  const result = buildInternalChinaCostPriceDecision({
    currentPrice: 2500,
    latestCostKrw: 500,
    previousCostKrw: 450,
    unitsPerOrder: 3,
  });
  assert.equal(result.unitsPerOrder, 3);
  assert.equal(result.targetPrice, 3000);
  assert.equal(result.direction, "INCREASE");
});

test("v1 remains a cost snapshot and never imports the product-grade engine", () => {
  assert.ok(review.includes("INTERNAL_CHINA_COST_PRICE_PROPOSAL"));
  assert.ok(review.includes("shoplingWritesEnabled: false"));
  assert.ok(review.includes("buildInternalChinaCostPriceDecision"));
  assert.equal(review.includes("priceGradeEngine"), false);
  assert.equal(review.includes("productGrade"), false);
  assert.ok(reviewPage.includes("상품등급"));
  assert.ok(reviewPage.includes("사용하지 않습니다"));
});

test("legacy v1 approval API is hard-retired and cannot be used after v2", () => {
  assert.ok(approvalRoute.includes("INTERNAL_CHINA_COST_PRICE_V1_RETIRED"));
  assert.ok(approvalRoute.includes("status: 410"));
  assert.ok(approvalRoute.includes("shoplingPriceWritesEnabled: false"));
  assert.equal(approvalRoute.includes("approveInternalChinaCostPriceProposal"), false);
  assert.equal(reviewPage.includes("InternalChinaCostPriceApprovalButton"), false);
});

test("dispatcher orders cost snapshot then group-aware v2 before legacy receipt proposal", () => {
  const costIndex = dispatcherRoute.indexOf("runInternalChinaCostPriceProposalStep");
  const groupIndex = dispatcherRoute.indexOf("runInternalChinaGroupCostPriceProposalStep");
  const legacyIndex = dispatcherRoute.indexOf("runReceiptLivePriceProposalStep");
  assert.ok(costIndex >= 0);
  assert.ok(groupIndex > costIndex);
  assert.ok(legacyIndex > groupIndex);
  assert.ok(dispatcherRoute.includes('flow: "internal_china_group_cost_price_v2"'));
  assert.ok(dispatcherRoute.includes("productGradeUsed: false"));
  assert.ok(dispatcherRoute.includes("productGroupGuessingEnabled: false"));
  assert.ok(dispatcherRoute.includes("shoplingPriceWritesEnabled: false"));
});

test("landed-cost close hands off to the selected month one-click flow, not the legacy execution page", () => {
  assert.ok(receiptPanel.includes("월 가격조정으로 이동"));
  assert.ok(receiptPanel.includes("/china-order-manager?month=${encodeURIComponent(cycleMonth)}#monthly-price"));
  assert.equal(receiptPanel.includes("/china-order-manager/price-review"), false);
  assert.equal(receiptPanel.includes("가격조정·상품등급"), false);
});
