import assert from "node:assert/strict";
import test from "node:test";

import {
  decidePurchaseRunRetry,
  EMPTY_PURCHASE_RUN_RETRY_TRACKER,
} from "../src/lib/purchaseRunPreparationRetryCore.ts";

test("ordinary purchase-run progress keeps polling without accumulating failures", () => {
  const decision = decidePurchaseRunRetry(
    { signature: "DEMAND:0:TimeoutError", identicalFailureCount: 2 },
    { stage: "DEMAND", progress: 12 },
  );
  assert.deepEqual(decision, {
    signature: null,
    identicalFailureCount: 0,
    stopAutomaticRetry: false,
    waitMs: 1_000,
  });
});

test("two identical transient failures stop automatic retry with bounded backoff", () => {
  const sample = {
    stage: "DEMAND",
    progress: 0,
    code: "The operation was aborted due to timeout",
    retryableFailure: true,
  };
  const first = decidePurchaseRunRetry(EMPTY_PURCHASE_RUN_RETRY_TRACKER, sample);
  const second = decidePurchaseRunRetry(first, sample);
  assert.equal(first.identicalFailureCount, 1);
  assert.equal(first.waitMs, 1_500);
  assert.equal(second.identicalFailureCount, 2);
  assert.equal(second.waitMs, 3_000);
  assert.equal(second.stopAutomaticRetry, true);
});

test("a changed stage or progress starts a new transient-failure sequence", () => {
  const previous = {
    signature: "DEMAND:0:TimeoutError",
    identicalFailureCount: 2,
  };
  const decision = decidePurchaseRunRetry(previous, {
    stage: "SALES",
    progress: 35,
    code: "TimeoutError",
    retryableFailure: true,
  });
  assert.equal(decision.identicalFailureCount, 1);
  assert.equal(decision.stopAutomaticRetry, false);
});
