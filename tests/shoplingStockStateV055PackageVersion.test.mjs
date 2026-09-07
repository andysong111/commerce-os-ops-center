import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("manifest and download route agree on v0.5.5", async () => {
  const route = await readFile("src/app/api/shopling-stock-state-sync/download/route.ts", "utf8");
  const manifest = await readFile("public/shopling-stock-state-sync/manifest.json", "utf8");
  assert.match(route, /const VERSION = "0\.5\.5"/);
  assert.equal(JSON.parse(manifest).version, "0.5.5");
});
