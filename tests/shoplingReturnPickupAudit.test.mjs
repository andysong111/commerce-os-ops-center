import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createReturnPickupAuditStore,
  returnPickupAuditPath,
} from "../local-agent/src/shopling-return-pickup-audit.mjs";

const actionKey = "cj-return-pickup:3493809:587625375225";

test("audit filenames are deterministic hashes and never expose order identifiers", () => {
  const path = returnPickupAuditPath("C:/safe-data", actionKey);
  assert.match(path, /return-pickup-audits[\\/][a-f0-9]{64}\.json$/);
  assert.doesNotMatch(path, /3493809|587625375225/);
  assert.equal(path, returnPickupAuditPath("C:/safe-data", actionKey));
});

test("audit store persists and reads an exact staged receipt", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "commerce-os-return-audit-"));
  const store = createReturnPickupAuditStore(dataDir);
  assert.equal(await store.readAudit(actionKey), null);
  const audit = {
    schemaVersion: 1,
    actionKey,
    claimKey: "C-1",
    orderNo: "3493809",
    outboundInvoiceNo: "587625375225",
    stage: "CJ_RESERVATION_VERIFIED",
  };
  await store.writeAudit(actionKey, audit);
  assert.deepEqual(await store.readAudit(actionKey), audit);
  assert.deepEqual(await store.listAudits(), [audit]);
});

test("audit store refuses a mismatched action identity", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "commerce-os-return-audit-"));
  const store = createReturnPickupAuditStore(dataDir);
  await assert.rejects(store.writeAudit(actionKey, { actionKey: "different" }), {
    code: "RETURN_PICKUP_AUDIT_INVALID",
  });
});
