import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  parseShoplingKrw,
  resolveLegacyShoplingOptionSalePrice,
} from "../src/lib/legacySeoShoplingPriceMath.ts";

test("Shopling 판매가와 옵션 추가금액으로 실제 옵션 기준판매가를 복구한다", () => {
  assert.equal(parseShoplingKrw("12,300원"), 12300);
  assert.equal(resolveLegacyShoplingOptionSalePrice("10,000", "2,500"), 12500);
  assert.equal(resolveLegacyShoplingOptionSalePrice("10,000", "-1,000"), 9000);
  assert.equal(resolveLegacyShoplingOptionSalePrice("0", "2,500"), 0);
  assert.equal(resolveLegacyShoplingOptionSalePrice("잘못된값", "100"), 0);
});

test("이전상품 가격복구는 Shopling sale_price + optAmt를 쓰고 정규화 옵션에 저장한다", async () => {
  const source = await readFile(
    new URL("../src/lib/legacySeoShoplingPriceRecovery.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /"sale_price"/);
  assert.match(source, /shoplingRow\.optAmt/);
  assert.match(source, /resolveLegacyShoplingOptionSalePrice/);
  assert.match(source, /base_sale_price_krw: price/);
  assert.match(source, /shopling-live-sale-v1/);
});

test("샵플링 신규등록 직전에 현재 판매가 복구를 다시 실행해 0원 등록을 차단한다", async () => {
  const route = await readFile(
    new URL("../src/app/api/legacy-seo-run-jobs/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /recoverLegacySeoShoplingPrices/);
  assert.match(route, /Shopling 현재 판매가 복구 실패/);
  assert.match(route, /legacySeoRegistrationExclusion/);
});

test("임시 cron은 0원 옵션만 대상으로 가격복구를 반복한다", async () => {
  const route = await readFile(
    new URL("../src/app/api/cron/legacy-seo-price-recovery/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /base_sale_price_krw: "eq\.0"/);
  assert.match(route, /recoverLegacySeoShoplingPrices/);
  assert.match(route, /TEMPORARY_RECOVERY_EXPIRES_AT/);
});
