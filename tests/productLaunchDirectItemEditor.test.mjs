import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
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

test("direct item API는 링크 변경 시 발주 원장까지 확인하고 다른 변경은 기존 백그라운드 저장을 사용한다", async () => {
  const route = await source("src/app/api/product-launch-tracker/item-editor/route.ts");
  assert.match(route, /readProductLaunchNormalizedItem/);
  assert.match(route, /applyProductLaunchTrackerMutation/);
  assert.match(route, /writeNormalizedItem/);
  assert.match(route, /product_launch_items/);
  assert.match(route, /product_launch_options/);
  assert.match(route, /after\(async \(\) =>/);
  assert.match(route, /mirrorToLegacy/);
  assert.match(route, /if \(linkUsage\) \{\s*await mirrorToLegacy\(legacyRequest, config\.value, identity\.value, itemId, linkUsage\)/);
  assert.match(route, /legacyMirrorQueued: !linkUsage/);
  assert.match(route, /JSON\.stringify\(asRecord\(result\)\.chinaLinkUsage\) !== JSON\.stringify\(expectedLinkUsage\)/);
});

test("normalized-direct batch checks owner identity, rejects ambiguous reads, and never falls back to legacy", async () => {
  const route = await source("src/app/api/product-launch-tracker/item-editor/route.ts");
  const code = stripTypeScriptTypes(
    route.replace(/^import[\s\S]*?from ["'][^"']+["'];\s*/gm, ""),
  ).replace(/^export /gm, "");
  let ownerAuthenticated = true;
  const owner = "fixture-owner";
  const calls = [];
  const get = new Function(
    "resolveProductLaunchIdentity",
    "getProductLaunchAdminConfig",
    "readProductLaunchNormalizedItems",
    code + "\nreturn GET;",
  )(
    async () => ownerAuthenticated
      ? { ok: true, value: { userId: owner } }
      : { ok: false, status: 401, body: { ok: false } },
    () => ({ ok: true, value: {} }),
    async (_config, userId, ids) => {
      calls.push([userId, ids]);
      return ids.filter((id) => id !== "missing").map((id) => ({ id }));
    },
  );
  const read = (ids) => get({
    nextUrl: new URL("https://ops.example/item-editor?" + new URLSearchParams([
      ["mode", "items-direct"],
      ...ids.map((id) => ["id", id]),
    ])),
  });
  assert.deepEqual(await (await read(["one", "two"])).json(), {
    ok: true,
    items: [{ id: "one" }, { id: "two" }],
    itemSource: "normalized-direct",
  });
  assert.equal((await read(["missing"])).status, 404);
  for (const invalid of [[], ["one", "one"], [""], Array.from({ length: 101 }, (_, i) => String(i))]) {
    assert.equal((await read(invalid)).status, 400);
  }
  ownerAuthenticated = false;
  assert.equal((await read(["one"])).status, 401);
  assert.deepEqual(calls, [[owner, ["one", "two"]], [owner, ["missing"]]]);
});

test("synchronous link mirror accepts only the exact saved role receipt for the requested item", async () => {
  const route = await source("src/app/api/product-launch-tracker/item-editor/route.ts");
  const code = stripTypeScriptTypes(
    route.replace(/^import[\s\S]*?from ["'][^"']+["'];\s*/gm, ""),
  ).replace(/^export /gm, "");
  const expectedUsage = {
    commonUrl: "",
    purchaseUrl: "https://detail.1688.com/offer/10.html",
    detailPageUrl: "https://detail.1688.com/offer/20.html",
    purchaseAlternates: ["https://detail.1688.com/offer/30.html"],
  };
  let responseFactory;
  let reconciled = 0;
  const mirror = new Function(
    "legacyPatch",
    "reconcileProductLaunchNormalizedAfterLegacyItems",
    code + "\nreturn mirrorToLegacy;",
  )(
    async () => responseFactory(),
    async () => { reconciled += 1; },
  );
  const save = () => mirror({}, {}, {}, "target", expectedUsage);
  const success = (items) => Response.json({ ok: true, items });

  responseFactory = () => success([{ id: "other", chinaLinkUsage: expectedUsage }]);
  await assert.rejects(save, /저장한 값과 일치하지 않습니다/);
  responseFactory = () => success([{ id: "target", chinaLinkUsage: {
    ...expectedUsage,
    purchaseUrl: expectedUsage.detailPageUrl,
  } }]);
  await assert.rejects(save, /저장한 값과 일치하지 않습니다/);
  responseFactory = () => Response.json({ ok: false }, { status: 503 });
  await assert.rejects(save, /다시 저장해 주세요/);
  assert.equal(reconciled, 0);

  responseFactory = () => success([{ id: "target", chinaLinkUsage: expectedUsage }]);
  await save();
  assert.equal(reconciled, 1);
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

test("상품출시 B코드 수정은 물리 위치 확인 후 상품마스터 중앙 변경을 먼저 완료한다", async () => {
  const route = await source("src/app/api/product-launch-tracker/item-editor/route.ts");
  const editor = await source("src/app/product-launch-editor/ProductLaunchStandaloneEditor.tsx");
  assert.match(route, /detectExistingBCodeChange/);
  assert.match(route, /BCODE_CHANGE_SERIALIZATION_REQUIRED/);
  assert.match(route, /BCODE_PHYSICAL_CONFIRMATION_REQUIRED/);
  assert.match(route, /\/api\/integrations\/location-changes/);
  assert.match(route, /optionBarcodeNo/);
  assert.match(route, /releaseSource: Boolean\(detected\.previousBarcode\)/);
  assert.match(route, /await applyCanonicalBCodeChange\(inputRecord, bCodeChange\);\s*await writeNormalizedItem/s);
  assert.match(editor, /새 B코드 위치에 해당 상품이 실제로 적재되어 있습니다/);
  assert.match(editor, /기존 B코드 위치는 비어 있으며 이전 위치를 해제해도 됩니다/);
  assert.match(editor, /한 번에 여러 B코드를 바꿀 수 없습니다/);
});
