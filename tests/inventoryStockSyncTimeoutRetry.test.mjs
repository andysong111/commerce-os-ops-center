import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("A21 result timeout is retryable only with desired option status and submit evidence", async () => {
  const resolution = await readFile(
    "src/lib/inventoryStockSyncResolution.ts",
    "utf8",
  );
  assert.match(resolution, /RESULT_TIMEOUT_CODE = "STOCK_SYNC_RESULT_TIMEOUT"/);
  assert.match(resolution, /WAIT_A21_RESULT/);
  assert.match(resolution, /resultTimeoutRetryEvidence/);
  assert.match(resolution, /optionApiEvidence/);
  assert.match(resolution, /statusAfter/);
  assert.match(resolution, /targetStatusCode/);
  assert.match(resolution, /SUBMIT_CLICKED/);
  assert.match(resolution, /productKind !== "OPTION"/);
  assert.match(resolution, /retryableResultTimeout/);
  assert.match(
    resolution,
    /retryableLegacyMarketplaceFailure \|\|\s*retryableResultTimeout/,
  );
});
