import assert from "node:assert/strict";
import test from "node:test";

import {
  isExpectedPurchaseStrategyLabReadinessError,
  PRODUCT_MASTER_INTEGRATION_SECRET_REQUIRED,
} from "../src/lib/purchaseStrategyLabReadiness.ts";

test("strategy lab recognizes the stable Product Master readiness code", () => {
  assert.equal(
    isExpectedPurchaseStrategyLabReadinessError(
      new Error(PRODUCT_MASTER_INTEGRATION_SECRET_REQUIRED),
    ),
    true,
  );
  assert.equal(
    isExpectedPurchaseStrategyLabReadinessError({
      code: PRODUCT_MASTER_INTEGRATION_SECRET_REQUIRED,
    }),
    true,
  );
});

test("strategy lab recognizes the deployed Product Master readiness message", () => {
  assert.equal(
    isExpectedPurchaseStrategyLabReadinessError(
      new Error("상품마스터 연동 비밀키가 필요합니다."),
    ),
    true,
  );
});

test("strategy lab does not hide unrelated or approximate errors", () => {
  assert.equal(
    isExpectedPurchaseStrategyLabReadinessError(
      new Error("PRODUCT_MASTER_INTEGRATION_SECRET_REQUIRED_BUT_DIFFERENT"),
    ),
    false,
  );
  assert.equal(
    isExpectedPurchaseStrategyLabReadinessError(
      new Error("상품마스터 응답 형식이 올바르지 않습니다."),
    ),
    false,
  );
  assert.equal(
    isExpectedPurchaseStrategyLabReadinessError({ code: "OTHER_ERROR" }),
    false,
  );
  assert.equal(isExpectedPurchaseStrategyLabReadinessError(null), false);
});
