import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("stock state sync exposes v0.5.5 consistently", async () => {
  const [route, manifest, page] = await Promise.all([
    readFile("src/app/api/shopling-stock-state-sync/download/route.ts", "utf8"),
    readFile("public/shopling-stock-state-sync/manifest.json", "utf8"),
    readFile("src/app/china-order-manager/stock-control/page.tsx", "utf8"),
  ]);
  assert.match(route, /const VERSION = "0\.5\.5"/);
  assert.match(manifest, /"version": "0\.5\.5"/);
  assert.match(page, /Shopling 재고상태 확장 v0\.5\.5 다운로드/);
});
