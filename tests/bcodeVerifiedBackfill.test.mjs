import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20261120144000_backfill_verified_product_master_bcodes.sql",
  import.meta.url,
);

test("verified Product Master B-codes use the canonical projection contract", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /apply_option_bcode_projection/);
  assert.match(sql, /VERIFIED_BCODE_BACKFILL_CONFLICT/);
  assert.match(sql, /order by option_barcode_no/);
  assert.match(sql, /expected=25/);
  assert.doesNotMatch(sql, /update\s+public\.product_launch_options\s+set\s+option_barcode_no/i);
});

test("AAA383 stale Ops projection is corrected by immutable option barcode", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /'000000000131','BBD4-2'/);
  assert.match(sql, /AAA383_OPS_PROJECTION_FAILED/);
});
