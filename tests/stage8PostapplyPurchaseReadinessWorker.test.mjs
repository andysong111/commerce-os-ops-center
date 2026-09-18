import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [worker, api, dispatcher, migration] = await Promise.all([
  read("src/app/api/cron/stage8-postapply-purchase-readiness/route.ts"),
  read("src/app/api/product-master/shopling-sales-events/route.ts"),
  read("src/lib/opsAdaptiveDispatcher.ts"),
  read("supabase/migrations/20260918095500_stage8_postapply_purchase_readiness_worker.sql"),
]);

test("post-apply worker waits for exact FULL completion before expensive purchase evidence reads", () => {
  assert.match(worker, /loadProductMasterShoplingSalesEventSyncStatus/);
  assert.match(worker, /sales\.state !== "COMPLETED"/);
  assert.match(worker, /state: "WAITING_FULL_APPLY"/);
  assert.ok(
    worker.indexOf('sales.state !== "COMPLETED"') <
      worker.indexOf("loadPostApplyCanonicalReconciliation"),
  );
});

test("post-apply worker verifies persisted canonical readback before inventory and shadow evidence", () => {
  assert.match(worker, /loadPostApplyCanonicalReconciliation/);
  assert.match(worker, /if \(!reconciliation\.ready\)/);
  assert.match(worker, /loadInventoryVerificationPriority/);
  assert.match(
    worker,
    /source\?\.reconciliationFingerprint ===[\s\S]*reconciliation\.reconciliationFingerprint/,
  );
});

test("post-apply worker remains read only and never creates a draft or business write", () => {
  assert.match(worker, /writesEnabled: false/);
  assert.match(worker, /approvalEnabled: false/);
  assert.match(worker, /purchaseDraftEnabled: false/);
  assert.doesNotMatch(
    worker,
    /applyProductMasterShoplingSalesEvents|storeInventoryOperation|createInternalPurchaseDraft|postProductMasterEvents/,
  );
});

test("FULL apply wakes post-apply checker but still requires the existing explicit FULL confirmation", () => {
  assert.match(api, /expectedConfirmation = action === "canary" \? "CANARY" : "FULL"/);
  assert.match(api, /action === "full" && result\.ok/);
  assert.match(api, /"stage8-postapply-purchase-readiness"/);
  assert.match(api, /downstreamWakeRequested/);
});

test("post-apply checker is a diagnostic task immediately behind the prewrite worker", () => {
  assert.match(dispatcher, /"stage8-postapply-purchase-readiness"/);
  assert.match(migration, /'stage8-postapply-purchase-readiness'/);
  assert.match(migration, /'diagnostic'/);
  assert.match(migration, /\n  206,/);
  assert.match(migration, /\n  300,\n  60,/);
});
