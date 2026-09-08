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
  assert.doesNotMatch(source, /shoplingRow\.sale_price|row\.sale_price|<sale_price>/);
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

test("중복 옵션 가격은 값이 동일할 때만 자동 허용하고 값이 다르면 제품명까지 검증 후 차단한다", async () => {
  const source = await readFile(
    new URL("../src/lib/legacySeoCanonicalPrice.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /sameCanonicalValues/);
  assert.match(source, /uniqueProductNameMatch/);
  assert.match(source, /product_name/);
  assert.match(source, /원가\/판매가가 달라 자동 매칭할 수 없음/);
  assert.match(source, /optionCount === 1 && sameCanonicalValues\(activeRows\)/);
});

test("동일 모델번호로 활성 상품이 둘 이상이면 가격 적용 전에 전역 중복검사로 차단한다", async () => {
  const guard = await readFile(
    new URL("../src/lib/legacySeoDuplicateModelGuard.ts", import.meta.url),
    "utf8",
  );
  const preflight = await readFile(
    new URL("../src/lib/legacySeoPreflight.ts", import.meta.url),
    "utf8",
  );
  assert.match(guard, /shopling_upload_status: "eq\.완료"/);
  assert.match(guard, /archived_at: "is\.null"/);
  assert.match(guard, /value\.itemIds\.size < 2/);
  assert.match(preflight, /readDuplicateActiveLegacySeoModels/);
  assert.match(preflight, /models\.filter\(\(modelNumber\) => !duplicateActiveModels\.has\(modelNumber\)\)/);
  assert.match(preflight, /동일 모델번호로 활성 상품이/);
  assert.match(preflight, /중복 모델번호 안전검사 실패로 가격 적용을 차단/);
  assert.ok(
    preflight.indexOf("duplicateActiveModels = await readDuplicateActiveLegacySeoModels") <
      preflight.indexOf("canonicalPrice = await applyLegacySeoCanonicalPrices"),
  );
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

test("사전점검은 현재 Shopling 상세·이미지를 복구하되 기존 값과 원본 item_payload를 보존한다", async () => {
  const preflight = await readFile(
    new URL("../src/lib/legacySeoPreflight.ts", import.meta.url),
    "utf8",
  );
  const assets = await readFile(
    new URL("../src/lib/legacySeoShoplingAssetRecovery.ts", import.meta.url),
    "utf8",
  );
  assert.match(preflight, /recoverLegacySeoShoplingAssets/);
  assert.match(assets, /readRawItemPayload/);
  assert.match(assets, /item_payload: payload/);
  assert.match(assets, /text\(current\.html\) \|\| text\(group\.detailHtml\)/);
  assert.match(assets, /currentMain \|\| shoplingImages\[0\]/);
  assert.match(assets, /currentImages\.length\s*\? currentImages/);
  assert.doesNotMatch(assets, /\.\.\.item,\s*detailPageAsset/);
});
