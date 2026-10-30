import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, ROOT), "utf8");
}

test("Shopling plan parser reads the 10,000 maximum and 11,113 cumulative use", async () => {
  const script = await source(
    "public/shopling-account-title-bridge/content-shopling-product-db-capacity.js",
  );
  const context = vm.createContext({ console });
  vm.runInContext(script, context);
  const parse = context.__commerceOsParseShoplingProductDbCapacityText;
  assert.equal(typeof parse, "function");
  assert.deepEqual(
    { ...parse(`상품 DB\n10,000\n사용 상품 DB 수 (누적)\n11,113\n쇼핑몰 상품 등록\n25,000\n925`) },
    {
      maximumProductCodeCount: 10_000,
      usedProductCodeCount: 11_113,
    },
  );
  assert.equal(parse("상품 DB\n10,000\n사용 상품 DB 수 (누적)\n알 수 없음"), null);
});

test("v0.6.4 extension stores Shopling quota and syncs it only from the Ops page", async () => {
  const [manifestRaw, download, collector, sync, main] = await Promise.all([
    source("public/shopling-account-title-bridge/manifest.json"),
    source("src/app/api/shopling-account-title-bridge/download/route.ts"),
    source("public/shopling-account-title-bridge/content-shopling-product-db-capacity.js"),
    source("public/shopling-account-title-bridge/content-commerce-os-product-db-capacity-sync.js"),
    source("public/shopling-account-title-bridge/content-commerce-os-product-db-capacity-main.js"),
  ]);
  const manifest = JSON.parse(manifestRaw);
  assert.match(download, /manifest\.version = "0\.6\.4"/);
  assert.match(download, /v0\.6\.4\.zip/);
  assert.ok(download.includes('"content-shopling-product-db-capacity.js"'));
  assert.ok(download.includes('"content-commerce-os-product-db-capacity-sync.js"'));
  assert.ok(download.includes('"content-commerce-os-product-db-capacity-main.js"'));
  assert.ok(
    manifest.content_scripts.some((entry) =>
      entry.js?.includes("content-shopling-product-db-capacity.js"),
    ),
  );
  assert.ok(
    manifest.content_scripts.some(
      (entry) =>
        entry.world === "MAIN" &&
        entry.js?.includes("content-commerce-os-product-db-capacity-main.js"),
    ),
  );
  assert.match(collector, /chrome\.storage\.local\.set/);
  assert.match(sync, /commerce-os-shopling-product-db-capacity-sync-request/);
  assert.match(main, /credentials: "same-origin"/);
  assert.match(main, /shopling-product-db-capacity-readback/);
  for (const script of [collector, sync, main]) {
    assert.doesNotMatch(script, /\.click\s*\(|requestSubmit\s*\(|\.submit\s*\(/);
  }
});
