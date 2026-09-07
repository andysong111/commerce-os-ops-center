import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("v0.5.5 selective rollback does not restore A6 mutation", async () => {
  const route = await readFile("src/app/api/shopling-stock-state-sync/download/route.ts", "utf8");
  assert.match(route, /a6Mutation: "NONE_READ_ONLY_RESOLVER"/);
  assert.match(route, /checkboxTouched: false/);
  assert.match(route, /optionStatusTouched: false/);
  assert.match(route, /patchA21ProvenListClickV055/);
});
