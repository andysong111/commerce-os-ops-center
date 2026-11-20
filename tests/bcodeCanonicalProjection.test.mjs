import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../supabase/migrations/20261120090000_canonical_bcode_projection_by_option_barcode.sql", import.meta.url), "utf8");
const route = await readFile(new URL("../src/app/api/integrations/bcode-projections/route.ts", import.meta.url), "utf8");
const releaseMigration = await readFile(new URL("../supabase/migrations/20261120183000_bcode_release_and_pheasant_owner_correction.sql", import.meta.url), "utf8");

test("B-code ledger binds one mutable location to one immutable numeric option identity", () => {
  assert.match(migration, /option_barcode_no text primary key/i);
  assert.match(migration, /b_code text not null unique/i);
  assert.match(migration, /OPTION_BARCODE_IMMUTABLE/);
  assert.match(migration, /BCODE_ALREADY_ASSIGNED/);
  assert.match(migration, /BCODE_CANONICAL_WRITE_REQUIRED/);
  assert.match(migration, /option_bcode_projection_ledger/);
  assert.doesNotMatch(migration, /set identity_key = 'OPTION_BARCODE:/);
  assert.doesNotMatch(migration, /update public\.product_launch_options\s+set option_barcode_identity_key = 'OPTION_BARCODE:/);
});

test("canonical projection is authenticated, idempotent and independently read back", () => {
  assert.match(route, /PRODUCT_MASTER_INTEGRATION_SECRET/);
  assert.match(route, /apply_option_bcode_projection/);
  assert.match(route, /BCODE_PROJECTION_READBACK_FAILED/);
  assert.match(route, /BCODE_PROJECTION_LEDGER_READBACK_FAILED/);
  assert.match(route, /BCODE_PROJECTION_EVENT_READBACK_FAILED/);
  assert.match(migration, /option_bcode_projection_events/);
  assert.match(migration, /BCODE_EVENT_ID_CONFLICT/);
  assert.match(route, /action === ["']release["']/);
  assert.match(route, /release_option_bcode_projection/);
  assert.match(route, /option_bcode_release_events/);
  assert.match(route, /ledgerRows\.length !== 0/);
});

test("owner-confirmed cross-SKU B-code transfers release the old option before assigning the new option", () => {
  assert.match(releaseMigration, /create table if not exists public\.option_bcode_release_events/i);
  assert.match(releaseMigration, /release_option_bcode_projection/i);
  assert.match(releaseMigration, /BCODE_CANONICAL_RELEASE_REQUIRED/);
  assert.match(releaseMigration, /000000000128[\s\S]*000000000129[\s\S]*000000000298[\s\S]*000000000299/);
  assert.match(releaseMigration, /AAA129_OPS_BCODE_RESTORE_FAILED/);
  assert.match(releaseMigration, /AAA090_OPS_BCODE_RELEASE_FAILED/);
  assert.doesNotMatch(releaseMigration, /set\s+option_barcode_no\s*=/i);
});
