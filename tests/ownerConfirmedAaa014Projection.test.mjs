import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL("../supabase/migrations/20261120110750_project_owner_confirmed_aaa014_bcodes.sql", import.meta.url),
  "utf8",
);

test("AAA014 projection uses canonical option barcodes and distinct B-codes", () => {
  assert.match(migration, /000000000872','BCG4-2/);
  assert.match(migration, /000000000873','BCG4-3/);
  assert.match(migration, /apply_option_bcode_projection/);
  assert.match(migration, /release-orphan:000000000855/);
  assert.match(migration, /release-orphan:000000000854/);
  assert.match(migration, /AAA014_ORPHAN_REGISTRY_RELEASE_FAILED/);
  assert.match(migration, /AAA014_LEDGER_POSTCONDITION_FAILED/);
  assert.doesNotMatch(migration, /optBarcode/);
});
