import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("v0.5.5 rollback scope is limited to A21 list click", async () => {
  const [route, background] = await Promise.all([
    readFile("src/app/api/shopling-stock-state-sync/download/route.ts", "utf8"),
    readFile("public/shopling-stock-state-sync/background-v052.js", "utf8"),
  ]);
  assert.match(route, /patchA21ProvenListClickV055/);
  assert.match(route, /priceCoreLiteralCopyVerified: true/);
  assert.match(background, /STOCK_SYNC_APPLY_OPTION_STATUS_V054/);
  assert.match(background, /active\.job\.goodsKeys = discoveredGoodsKeys/);
});
