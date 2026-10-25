import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("독립 상품 편집기는 최초 조회는 normalized authority, 저장/검증은 direct item API를 사용한다", async () => {
  const page = await source("src/app/product-launch-editor/page.tsx");
  const transport = await source("src/app/product-launch-editor/ProductLaunchEditorTransport.tsx");
  assert.match(page, /ProductLaunchEditorTransport/);
  assert.match(transport, /EDITOR_API = "\/api\/product-launch-tracker\/normalized-optimized"/);
  assert.match(transport, /DIRECT_ITEM_API = "\/api\/product-launch-tracker\/item-editor"/);
  assert.match(transport, /method !== "PATCH" && !directReadback/);
  assert.doesNotMatch(transport, /AUTHORITATIVE_LEGACY_API/);
  assert.match(transport, /window\.fetch = routedFetch/);
});

test("direct item API는 정규화 item\/options를 먼저 저장하고 legacy mirror는 응답 밖에서 실행한다", async () => {
  const route = await source("src/app/api/product-launch-tracker/item-editor/route.ts");
  assert.match(route, /readProductLaunchNormalizedItem/);
  assert.match(route, /applyProductLaunchTrackerMutation/);
  assert.match(route, /writeNormalizedItem/);
  assert.match(route, /product_launch_items/);
  assert.match(route, /product_launch_options/);
  assert.match(route, /after\(async \(\) =>/);
  assert.match(route, /mirrorToLegacy/);
  assert.match(route, /legacyMirrorQueued: true/);
});

test("direct item API는 기준판매가와 원가를 option 정규화 행에 직접 기록한다", async () => {
  const route = await source("src/app/api/product-launch-tracker/item-editor/route.ts");
  assert.match(route, /base_sale_price_krw: baseSalePriceKrw/);
  assert.match(route, /roundUpProductLaunchPriceKrw\(option\.baseSalePriceKrw\)/);
  assert.match(route, /unit_cost_krw: nonNegativeInteger\(option\.unitCostKrw\)/);
  assert.match(route, /optionPayload\.baseSalePriceKrw = baseSalePriceKrw/);
  assert.match(route, /option_payload: optionPayload/);
});

test("옵션 바코드 mirror trigger는 부모 상품 updated_at을 덮어쓰지 않는다", async () => {
  const migration = await source(
    "supabase/migrations/202608250001_preserve_product_launch_item_updated_at_on_option_barcode_refresh.sql",
  );
  assert.match(migration, /set option_barcode_nos =/i);
  assert.doesNotMatch(migration, /updated_at\s*=\s*now\(\)/i);
});
