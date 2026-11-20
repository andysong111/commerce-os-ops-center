import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20261120113715_project_aaa022_confirmed_bcodes.sql",
    import.meta.url,
  ),
  "utf8",
);

test("AAA022 projection assigns only the two newly confirmed locations", () => {
  assert.match(migration, /000000000874','BDE8-2/);
  assert.match(migration, /000000000875','BDE8-3/);
  assert.match(migration, /000000000876','90ml 진청','BDE6-1/);
  assert.match(migration, /000000000877','90ml 연두','BDE6-2/);
  assert.match(migration, /000000000878','90ml 황토','BDE6-3/);
  assert.equal((migration.match(/apply_option_bcode_projection/g) ?? []).length, 2);
  assert.match(migration, /AAA022_PROJECTION_TARGET_ALREADY_CLAIMED/);
  assert.match(migration, /AAA022_LEDGER_POSTCONDITION_FAILED/);
  assert.doesNotMatch(migration, /optBarcode/);
});
