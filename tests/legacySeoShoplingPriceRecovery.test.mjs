import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("이전상품 가격권위는 Shopling 현재 판매가가 아니라 중국주문 최종확정표다", async () => {
  const source = await readFile(
    new URL("../src/lib/legacySeoShoplingPriceRecovery.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /prepareLegacySeoPreflight/);
  assert.match(source, /china_order_final_confirmed_v4/);
  assert.doesNotMatch(source, /sale_price/);
  assert.doesNotMatch(source, /shoplingRow\.optAmt/);
  assert.doesNotMatch(source, /resolveLegacyShoplingOptionSalePrice/);
});

test("중국주문 최종가격 적용기는 원가와 최종확정 판매가를 함께 정규화 옵션에 저장한다", async () => {
  const source = await readFile(
    new URL("../src/lib/legacySeoCanonicalPrice.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /legacy_seo_canonical_prices/);
  assert.match(source, /unit_cost_krw: integerUnitCost/);
  assert.match(source, /base_sale_price_krw: finalSalePrice/);
  assert.match(source, /unitCostKrwExact/);
  assert.match(source, /finalSalePriceKrw/);
  assert.match(source, /price_status/);
});

test("SEO RUN 큐 삽입 전에 옵션·B코드·원가·판매가·상세·대표·부가이미지 사전점검을 강제한다", async () => {
  const server = await readFile(
    new URL("../src/lib/legacySeoRunJobServer.ts", import.meta.url),
    "utf8",
  );
  const preflight = await readFile(
    new URL("../src/lib/legacySeoPreflight.ts", import.meta.url),
    "utf8",
  );
  assert.match(server, /prepareLegacySeoPreflight/);
  assert.match(server, /LEGACY_SEO_PREFLIGHT_BLOCKED/);
  assert.match(preflight, /Shopling 옵션\/B코드/);
  assert.match(preflight, /중국주문 최종확정 판매가/);
  assert.match(preflight, /중국주문 최종확정 원가/);
  assert.match(preflight, /상세페이지 HTML/);
  assert.match(preflight, /대표이미지/);
  assert.match(preflight, /부가이미지/);
});
