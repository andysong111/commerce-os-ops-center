import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("복구 드레인은 가격이 양수여도 최종확정 v4 provenance와 현재 숫자가 일치하지 않으면 다시 가격매칭한다", async () => {
  const source = await readFile(
    new URL("../src/app/api/cron/legacy-shopling-image-repair/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /const CANONICAL_PRICE_SOURCE = "china_order_final_confirmed_v4";/);
  assert.match(source, /const CANONICAL_PRICE_REVISION = "20260809_v4_option_max_uniform";/);
  assert.match(source, /function canonicalPriceConfirmed/);
  assert.match(source, /text\(canonical\.source\) !== CANONICAL_PRICE_SOURCE/);
  assert.match(source, /text\(canonical\.sourceRevision\) !== CANONICAL_PRICE_REVISION/);
  assert.match(source, /currentSale === canonicalSale/);
  assert.match(source, /currentCost === canonicalCost/);
  assert.match(source, /if \(!canonicalPriceConfirmed\(option\)\) reasons\.push\("canonical-price"\);/);
  assert.match(source, /legacy-seo-preflight-drain-v7-canonical-authority/);
});
