import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20261120114322_refresh_aaa022_shopling_index.sql",
    import.meta.url,
  ),
  "utf8",
);

test("AAA022 Shopling cache moves every gray and sky listing after exact readback", () => {
  for (const goodsKey of [
    "111890", "111891", "111892", "112204", "112352", "115242", "115410",
  ]) {
    assert.match(migration, new RegExp(goodsKey));
  }
  assert.equal((migration.match(/'BDE5-2','BDE8-2'/g) ?? []).length, 14);
  assert.equal((migration.match(/'BDE5-3','BDE8-3'/g) ?? []).length, 14);
  assert.match(migration, /OWNER_CONFIRMED_SHOPLING_READBACK/);
  assert.match(migration, /AAA022_SHOPLING_INDEX_SOURCE_PRECONDITION_FAILED/);
  assert.match(migration, /AAA022_SHOPLING_INDEX_POSTCONDITION_FAILED/);
  assert.doesNotMatch(migration, /optBarcode/);
  assert.doesNotMatch(migration, /option_quantity_observed\s*=/);
  assert.doesNotMatch(migration, /option_status_observed\s*=/);
  assert.doesNotMatch(migration, /product_sale_status_observed\s*=/);
});
