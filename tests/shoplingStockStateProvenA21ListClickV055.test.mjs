import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("v0.5.5 uses the proven A21 list direct click while preserving A6 read-only and popup core", async () => {
  const [route, manifest, page, readme] = await Promise.all([
    readFile("src/app/api/shopling-stock-state-sync/download/route.ts", "utf8"),
    readFile("public/shopling-stock-state-sync/manifest.json", "utf8"),
    readFile("src/app/china-order-manager/stock-control/page.tsx", "utf8"),
    readFile("public/shopling-stock-state-sync/README.txt", "utf8"),
  ]);

  assert.match(route, /const VERSION = "0\.5\.5"/);
  assert.match(manifest, /"version": "0\.5\.5"/);
  assert.match(page, /v0\.5\.5 다운로드/);
  assert.match(readme, /v0\.5\.5/);

  assert.match(route, /patchA6ReadOnlyResolverV054/);
  assert.match(route, /a6Mutation: "NONE_READ_ONLY_RESOLVER"/);
  assert.match(route, /patchA21ProvenListClickV055/);
  assert.match(route, /PROVEN_A21_LIST_DIRECT_CLICK/);
  assert.match(route, /button\.click\(\)/);
  assert.match(route, /PROVEN_PRICE_OPTION_RESEND_DIRECT_NO_VISIBILITY_FILTER/);
  assert.match(route, /priceCoreLiteralCopyVerified: true/);
});
