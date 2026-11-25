import assert from "node:assert/strict";
import test from "node:test";
import { isSafeShoplingStockRetry, MAX_SHOPLING_STOCK_ATTEMPTS } from "../src/lib/shoplingStockRetryPolicy.mjs";

const beforeDispatch = {
  outcome: "FAILED",
  evidence: { code: "SHOPLING_HF72_FIRST_GROUP_DISPATCH_FAILED", retrySafe: true },
};

test("stock retry requires proof that the original Shopling submission did not start", () => {
  assert.equal(MAX_SHOPLING_STOCK_ATTEMPTS, 3);
  assert.equal(isSafeShoplingStockRetry(beforeDispatch), true);
  assert.equal(isSafeShoplingStockRetry({
    outcome: "FAILED",
    evidence: { code: "HF93_SELECTION_DIALOG_CAUGHT", retrySafe: true, popupObserved: false },
  }), true);
  assert.equal(isSafeShoplingStockRetry({
    outcome: "FAILED",
    message: "Shopling API HTTP 503",
    evidence: { code: "SHOPLING_STOCK_STATE_COALESCED_API_FAILED", browserMutationStarted: false, appliedApiCount: 0 },
  }), true);
  for (const result of [
    { outcome: "SUCCEEDED", evidence: { marketFailureCount: 15, responsibilityReceiptAccepted: true } },
    { ...beforeDispatch, outcome: "UNCERTAIN" },
    { outcome: "FAILED", evidence: { code: "HF86_TRUSTED_CLICK_POPUP_TIMEOUT", retrySafe: true } },
    { outcome: "FAILED", evidence: { code: "SHOPLING_LOGIN_REQUIRED", retrySafe: true, browserMutationStarted: false } },
    { outcome: "FAILED", evidence: { code: "SHOPLING_STOCK_STATE_COALESCED_API_FAILED", browserMutationStarted: false, appliedApiCount: 0 }, message: "상태 E, 판매종료" },
    { outcome: "FAILED", evidence: { code: "SHOPLING_STOCK_STATE_COALESCED_API_FAILED", browserMutationStarted: false, appliedApiCount: 1 }, message: "HTTP 503" },
  ]) assert.equal(isSafeShoplingStockRetry(result), false, JSON.stringify(result));
});

test("an observed popup, original receipt or submitted subset overrides a retry flag", () => {
  for (const evidence of [
    { popupObserved: true },
    { stage: "WAIT_A21_RESULT" },
    { stockStateGroupReceipts: [{ goodsKeys: ["115419"] }] },
    { history: [{ lastMileReceipt: { shoplingSubmitInvoked: true } }] },
    { result: { exactOwnerA21PopupTabId: 12 } },
    { responsibilityReceiptAccepted: true },
  ]) {
    assert.equal(isSafeShoplingStockRetry({ ...beforeDispatch, evidence: { ...beforeDispatch.evidence, ...evidence } }), false);
  }
});
