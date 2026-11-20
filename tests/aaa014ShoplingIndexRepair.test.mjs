import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20261120111559_refresh_aaa014_shopling_index.sql",
    import.meta.url,
  ),
  "utf8",
);

test("AAA014 Shopling read cache repairs only the confirmed self-management code", () => {
  assert.match(migration, /goods_key = '115236'/);
  assert.match(migration, /option_id = '24679638'/);
  assert.match(migration, /barcode = 'BCG4-2'/);
  assert.match(migration, /option_id = '24679639' and barcode = 'BCG4-3'/);
  assert.match(migration, /OWNER_CONFIRMED_SHOPLING_READBACK/);
  assert.match(migration, /AAA014_SHOPLING_INDEX_SOURCE_PRECONDITION_FAILED/);
  assert.match(migration, /AAA014_SHOPLING_INDEX_POSTCONDITION_FAILED/);
  assert.doesNotMatch(migration, /optBarcode/);
  assert.doesNotMatch(migration, /option_quantity_observed\s*=/);
  assert.doesNotMatch(migration, /option_status_observed\s*=/);
  assert.doesNotMatch(migration, /product_sale_status_observed\s*=/);
});
