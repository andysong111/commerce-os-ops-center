import test from "node:test";
import assert from "node:assert/strict";
import { purchaseCycleBlockerActions } from "../src/lib/purchaseCycleBlockerActions.ts";

const explain = (code) => ({
  PURCHASE_CANDIDATE_OMISSION_REVIEW_REQUIRED: "발주후보 누락 검토 필요",
  SHOPLING_ZERO_LEDGER_POSITIVE: "샵플링 재고는 0인데 재고원장은 양수입니다.",
  SALES_SOURCE_STALE_OR_FUTURE: "판매자료가 오래됐습니다.",
}[code] ?? code);

const inventoryConflict = (barcode, productName) => ({
  barcode,
  modelNo: null,
  productName,
  severity: "BLOCKING",
  reasons: ["SHOPLING_ZERO_LEDGER_POSITIVE"],
  salesQuantity30: 1,
  salesQuantity90: 1,
  salesQuantity365: 1,
  salesRevenue30: 1,
  salesTrend: null,
  planningInventoryQuantity: 1,
  ledgerInventoryQuantity: 1,
  shoplingQuantity: 0,
  shoplingSyncedAt: "2026-10-28T12:00:00.000Z",
  purchaseStatus: null,
  recommendedQuantity: 0,
  openCommitment: 0,
});

test("inventory conflicts name the exact products and route to stock control without asking for sales refresh", () => {
  const actions = purchaseCycleBlockerActions({
    blockers: ["PURCHASE_CANDIDATE_OMISSION_REVIEW_REQUIRED"],
    omissionReview: [
      inventoryConflict("BCC5-2", "안경다리 실리콘 1쌍"),
      inventoryConflict("BAE1-3", "셀프미발망토"),
    ],
  }, explain);

  assert.equal(actions.length, 1);
  assert.equal(actions[0].title, "재고 충돌 2종 확인");
  assert.match(actions[0].message, /BCC5-2 안경다리 실리콘 1쌍/);
  assert.match(actions[0].message, /BAE1-3 셀프미발망토/);
  assert.match(actions[0].message, /판매자료 재수집 문제가 아니므로/);
  const href = new URL(actions[0].href, "https://commerce-os.test");
  assert.equal(href.pathname, "/china-order-manager/stock-control");
  assert.equal(href.searchParams.get("focus"), "rough-stock");
  assert.equal(href.searchParams.get("barcodes"), "BCC5-2,BAE1-3");
  assert.equal(href.searchParams.get("returnTo"), "/purchase-cycle-preflight");
});

test("sales refresh is offered only when a sales-source blocker is actually present", () => {
  const actions = purchaseCycleBlockerActions({
    blockers: [
      "PURCHASE_CANDIDATE_OMISSION_REVIEW_REQUIRED",
      "SALES_SOURCE_STALE_OR_FUTURE",
    ],
    omissionReview: [inventoryConflict("BCC5-2", "안경다리 실리콘 1쌍")],
  }, explain);

  assert.equal(actions.length, 2);
  assert.match(actions[0].href, /^\/china-order-manager\/stock-control\?/);
  assert.equal(actions[1].title, "최신 판매자료 준비");
  assert.equal(actions[1].href, "/stage8-sales-events");
});

test("unknown safety blockers do not misleadingly route to sales refresh", () => {
  const actions = purchaseCycleBlockerActions({
    blockers: ["SOME_NEW_SAFETY_BLOCKER"],
    omissionReview: [],
  }, explain);

  assert.deepEqual(actions, [{
    title: "발주안 안전조건 확인",
    message: "SOME_NEW_SAFETY_BLOCKER",
  }]);
});

test("non-inventory omission blockers stay on the omission review instead of routing to stock control", () => {
  const row = {
    ...inventoryConflict("BCA4-1", "은세척천"),
    reasons: ["SUPPLIER_LINK_MISSING"],
  };
  const actions = purchaseCycleBlockerActions({
    blockers: ["PURCHASE_CANDIDATE_OMISSION_REVIEW_REQUIRED"],
    omissionReview: [row],
  }, explain);

  assert.equal(actions.length, 1);
  assert.equal(actions[0].title, "발주후보 누락 근거 확인");
  assert.equal(actions[0].href, "#purchase-omission-review");
});
