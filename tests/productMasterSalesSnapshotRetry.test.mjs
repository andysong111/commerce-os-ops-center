import assert from "node:assert/strict";
import test from "node:test";

import {
  PRODUCT_MASTER_SALES_SNAPSHOT_TIMEOUT_MS,
  retryableProductMasterSalesSnapshotRead,
} from "../src/lib/productMasterSalesSnapshotRetry.ts";

test("Product Master sales snapshot gets enough time for paged reads", () => {
  assert.equal(PRODUCT_MASTER_SALES_SNAPSHOT_TIMEOUT_MS, 240_000);
});

test("transient Product Master snapshot failures remain retryable", () => {
  assert.equal(
    retryableProductMasterSalesSnapshotRead(
      new DOMException("The operation was aborted due to timeout", "TimeoutError"),
    ),
    true,
  );
  assert.equal(
    retryableProductMasterSalesSnapshotRead(
      new Error("SALES_EVENT_SNAPSHOT_FAILED:504"),
    ),
    true,
  );
  const wrapped = new Error("request failed", {
    cause: new Error("ECONNRESET"),
  });
  assert.equal(retryableProductMasterSalesSnapshotRead(wrapped), true);
});

test("permanent Product Master snapshot failures still stop preparation", () => {
  assert.equal(
    retryableProductMasterSalesSnapshotRead(
      new Error("SALES_EVENT_SNAPSHOT_INVALID"),
    ),
    false,
  );
  assert.equal(
    retryableProductMasterSalesSnapshotRead(
      new Error("SALES_EVENT_SNAPSHOT_FAILED:400"),
    ),
    false,
  );
});
