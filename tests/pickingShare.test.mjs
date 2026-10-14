import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadPurchaseCycleModule } from "./helpers/purchaseCycleHarness.mjs";

const token = "A".repeat(43);
const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");

function row(overrides = {}) {
  return {
    payload: {
      snapshotId: "picking-20261014",
      date: "20261014",
      createdAt: "2026-10-14T01:00:00.000Z",
      source: "SHOPLING_API",
      status: "READY",
      summary: { filteredOrderRecordCount: 78, totalQuantity: 325, unresolvedRecordCount: 0 },
      items: [{
        barcode: "BAB2-3",
        quantity: 12,
        modelNames: [],
        modelNumbers: [],
        productNames: ["fixture"],
        optionNames: ["단품"],
        picked: false,
      }],
      delta: {
        addedQuantity: 12,
        changedQuantity: 0,
        removedQuantity: 0,
        quantityToPick: 12,
        addedOrderCount: 1,
        changedOrderCount: 0,
        removedOrderCount: 0,
        toPickItems: [],
      },
      unresolved: [],
    },
    completed: {},
    updated_at: "2026-10-14T01:00:00.000Z",
    expires_at: "2026-10-28T01:00:00.000Z",
    ...overrides,
  };
}

function loadPickingShare(createSupabaseAdminClient) {
  return loadPurchaseCycleModule("src/lib/pickingShare.ts", {
    "node:crypto": { createHash },
    "@/lib/supabase/admin": { createSupabaseAdminClient },
  });
}

function readQuery(result) {
  return {
    select() { return this; },
    eq() { return this; },
    gt() { return this; },
    async maybeSingle() { return result; },
  };
}

test("public picking share rejects malformed bearer tokens before storage access", async () => {
  let storageAccessed = false;
  const picking = loadPickingShare(async () => {
    storageAccessed = true;
    return null;
  });

  assert.equal(picking.validPickingShareToken(token), true);
  assert.equal(picking.validPickingShareToken(token + "x"), false);
  assert.equal(picking.validPickingShareToken("../not-a-token"), false);
  const result = await picking.readPickingShare("short");
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  assert.equal(storageAccessed, false);
});

test("public picking share merges persisted completion and preserves an explicit uncheck", async () => {
  const completedAt = "2026-10-14T02:00:00.000Z";
  const completedRow = row({ completed: { "BAB2-3": { pickedQuantity: 12, completedAt } } });
  const uncheckedRow = row({
    payload: { ...completedRow.payload, items: [{ ...completedRow.payload.items[0], picked: true }] },
    completed: { "BAB2-3": { pickedQuantity: 0, completedAt, completed: false } },
  });
  const rows = [completedRow, uncheckedRow];
  const picking = loadPickingShare(async () => ({
    from() { return readQuery({ data: rows.shift(), error: null }); },
  }));

  const checked = await picking.readPickingShare(token);
  const unchecked = await picking.readPickingShare(token);
  assert.equal(checked.ok, true);
  assert.equal(checked.value.items[0].picked, true);
  assert.equal(checked.value.items[0].completedAt, completedAt);
  assert.equal(unchecked.ok, true);
  assert.equal(unchecked.value.items[0].picked, false);
});

test("completion update rejects invalid or unknown barcodes without writing", async () => {
  let writes = 0;
  const picking = loadPickingShare(async () => ({
    from() {
      const query = readQuery({ data: row(), error: null });
      query.update = () => { writes += 1; return query; };
      return query;
    },
  }));

  const invalid = await picking.updatePickingShareCompletion(token, "not-a-b-code", true);
  const unknown = await picking.updatePickingShareCompletion(token, "BBB9-9", true);
  assert.equal(invalid.status, 400);
  assert.equal(unknown.status, 404);
  assert.equal(writes, 0);
});

test("completion update retries an optimistic conflict and keeps the concurrent check", async () => {
  const first = row();
  const second = row({
    completed: { "BBB1-1": { pickedQuantity: 3, completedAt: "2026-10-14T02:00:00.000Z" } },
    updated_at: "2026-10-14T02:00:00.000Z",
  });
  const reads = [first, second];
  const writes = [];
  let updateAttempt = 0;
  const picking = loadPickingShare(async () => ({
    from() {
      let updateBody = null;
      const query = {
        error: null,
        data: null,
        select() { return this; },
        eq() { return this; },
        gt() { return this; },
        update(value) { updateBody = value; return this; },
        async maybeSingle() { return { data: reads.shift(), error: null }; },
        then(resolve) {
          writes.push(updateBody);
          updateAttempt += 1;
          return Promise.resolve(resolve({ data: updateAttempt === 1 ? [] : [{}], error: null }));
        },
      };
      return query;
    },
  }));

  const result = await picking.updatePickingShareCompletion(token, "BAB2-3", true);
  assert.equal(result.ok, true);
  assert.equal(writes.length, 2);
  assert.equal(writes[1].completed["BBB1-1"].pickedQuantity, 3);
  assert.equal(writes[1].completed["BAB2-3"].pickedQuantity, 12);
});

test("picking snapshot migration keeps public roles out and service role in", async () => {
  const migration = await readFile("supabase/migrations/202610130001_commerce_os_picking_snapshots.sql", "utf8");
  const client = await readFile("src/app/picking/[token]/PickingClient.tsx", "utf8");
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /revoke all[^;]+from anon, authenticated/i);
  assert.match(migration, /grant select, insert, update, delete[^;]+to service_role/i);
  assert.doesNotMatch(client, /SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY|sb_secret_/);
  assert.match(client, /\/api\/picking\//);
  assert.match(client, />모델명<\\/strong>/);
  assert.match(client, />모델번호<\\/strong>/);
  assert.match(client, />옵션명<\\/strong>/);
  assert.match(client, /item\.modelNames/);
  assert.match(client, /item\.modelNumbers/);
  assert.match(client, /item\.optionNames/);
  assert.equal(tokenHash.length, 64);
});
