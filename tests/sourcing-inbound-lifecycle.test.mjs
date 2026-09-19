import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("sourced receipt activates warehouse identity before persisting the China receipt event", async () => {
  const receipt = await source("../src/lib/internalChinaReceipt.ts");
  const bridgeIndex = receipt.indexOf("confirmSourcingWarehouseReceipt({");
  const ledgerWriteIndex = receipt.indexOf("/rest/v1/commerce_operation_runs?on_conflict=source_event_id");
  assert.ok(bridgeIndex > 0);
  assert.ok(ledgerWriteIndex > bridgeIndex);
  assert.match(receipt, /commitment\.latestPayload/);
  assert.match(receipt, /launchMaterializedCount/);
  assert.match(receipt, /materializeSourcingLaunchItem/);
});

test("warehouse receipt bridge is source-qualified, idempotent and never marks unknown commitments", async () => {
  const bridge = await source("../src/lib/sourcingReceiptBridge.ts");
  assert.match(bridge, /payload\.sourcingConfirmed !== true/);
  assert.match(bridge, /stableUuid\(/);
  assert.match(bridge, /action: "sourcing_received"/);
  assert.match(bridge, /PRODUCT_MASTER_INTEGRATION_SECRET/);
  assert.match(bridge, /body\?\.status !== "RECEIVED"/);
});

test("launch materialization uses sourcing intake as the immutable item id and rejects identity collisions", async () => {
  const materialize = await source("../src/lib/sourcingLaunchMaterialization.ts");
  assert.match(materialize, /id: intakeId/);
  assert.match(materialize, /SOURCING_LAUNCH_IDEMPOTENCY_CONFLICT/);
  assert.match(materialize, /SOURCING_LAUNCH_BCODE_ALREADY_EXISTS/);
  assert.match(materialize, /SOURCING_LAUNCH_MODEL_ALREADY_EXISTS/);
  assert.match(materialize, /warehouseLocation: barcode/);
  assert.match(materialize, /workBatch: "신규소싱입고"/);
  assert.match(materialize, /syncProductLaunchNormalizedChangedItems/);
});
