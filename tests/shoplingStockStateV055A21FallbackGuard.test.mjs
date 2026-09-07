import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("v0.5.5 keeps exact-row count fallback before proven direct click", async () => {
  const builder = await readFile("scripts/build-shopling-stock-worker-v030.mjs", "utf8");
  const route = await readFile("src/app/api/shopling-stock-state-sync/download/route.ts", "utf8");
  assert.match(builder, /EXACT_BOUND_ROWS/);
  assert.match(builder, /A21_RESULT_COUNT_UNAVAILABLE_AT_BATCH_LIMIT/);
  assert.match(route, /PROVEN_A21_LIST_DIRECT_CLICK/);
});
