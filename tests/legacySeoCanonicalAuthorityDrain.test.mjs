import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("복구 드레인은 공통 가격 권한 검사로 최종확정표와 검증된 후속 가격을 판정한다", async () => {
  const source = await readFile(
    new URL("../src/app/api/cron/legacy-shopling-image-repair/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /legacySeoPriceAuthorityConfirmed/);
  assert.match(
    source,
    /if \(!legacySeoPriceAuthorityConfirmed\(item, option\)\) reasons\.push\("canonical-price"\);/,
  );
  assert.match(source, /legacy-seo-preflight-drain-v8-policy-aware-canonical-authority/);
});

test("공통 가격 권한은 숫자만 있는 임의 옵션은 막고 검증된 중앙정책과 stock 원장을 허용한다", async () => {
  const preflight = await readFile(
    new URL("../src/lib/legacySeoPreflight.ts", import.meta.url),
    "utf8",
  );
  const source = await readFile(
    new URL("../src/lib/legacySeoCanonicalPrice.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /const CANONICAL_PRICE_SOURCE = "china_order_final_confirmed_v4";/);
  assert.match(source, /const CANONICAL_PRICE_REVISION = "20260809_v4_option_max_uniform";/);
  assert.match(source, /function canonicalMarkerConfirmed/);
  assert.match(source, /legacySeoCentralPricePolicyConfirmed/);
  assert.match(source, /\^stock-\[a-z0-9-\]\+-\\d\+\$/i);
  assert.match(preflight, /legacySeoPriceAuthorityConfirmed\(item, option\)/);
  assert.match(preflight, /"canonicalPriceAuthority"/);
  assert.match(preflight, /중국주문 최종확정 v4 적용근거와 현재 가격이 일치하지 않습니다/);
});

test("이전 모델번호와 확정된 옵션명 차이만 좁게 복구한다", async () => {
  const source = await readFile(
    new URL("../src/lib/legacySeoCanonicalPrice.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /AAA086: \{ mode: "supplement", sourceModels: \["AAA087", "AAA088", "AAA089"\] \}/);
  assert.match(source, /AAA327: \{ mode: "replace", sourceModels: \["AAA317"\] \}/);
  assert.match(source, /AAA420: \{ mode: "replace", sourceModels: \["AAA327"\] \}/);
  assert.match(source, /AAA127: \{ "단품": \["펀칭기"\] \}/);
  assert.match(source, /AAA208: \{ "단품": \["단품옵션미기재"\] \}/);
  assert.match(source, /AAA286: \{ "중형": \["m"\] \}/);
  assert.match(source, /unique_product_name_option_affix/);
  assert.match(source, /function canonicalCandidateSummaries/);
  assert.match(source, /canonicalCandidates: canonicalCandidateSummaries\(activeRows\)/);
});
