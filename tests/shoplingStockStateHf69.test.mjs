import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  planShoplingGoodsKeyTransmission,
} from "../src/lib/shopling/shoplingGoodsKeyTransmission.ts";
import {
  patchHf69A21ContentSource,
  patchHf69A21MainSource,
  patchHf69OpsSource,
} from "../src/lib/shoplingStockHf69Patch.ts";

test("HF69 classifies each goods key by its own option count, never by goods-key count", () => {
  const mixedSameBcode = [
    planShoplingGoodsKeyTransmission("OPTION", {
      goodsKey: "120867",
      optionCount: 3,
    }),
    planShoplingGoodsKeyTransmission("OPTION", {
      goodsKey: "120868",
      optionCount: 1,
    }),
    planShoplingGoodsKeyTransmission("OPTION", {
      goodsKey: "120869",
      optionCount: 2,
    }),
  ];

  assert.deepEqual(
    mixedSameBcode.map((row) => row.transmissionKind),
    ["OPTION_SEND", "PRODUCT_SALE_STATUS_SEND", "OPTION_SEND"],
  );
  assert.deepEqual(
    mixedSameBcode.map((row) => row.effectiveProductKind),
    ["OPTION", "SINGLE", "OPTION"],
  );
  assert.equal(mixedSameBcode[1].applyExactOptionStatus, true);
  assert.equal(mixedSameBcode[1].applyProductSaleStatus, true);
  assert.equal(mixedSameBcode[0].applyProductSaleStatus, false);

  const ordinarySingle = planShoplingGoodsKeyTransmission("SINGLE", {
    goodsKey: "120870",
    optionCount: 1,
  });
  assert.equal(ordinarySingle.transmissionKind, "PRODUCT_SALE_STATUS_SEND");
  assert.equal(ordinarySingle.applyExactOptionStatus, false);
  assert.equal(ordinarySingle.applyProductSaleStatus, true);

  assert.throws(
    () => planShoplingGoodsKeyTransmission("OPTION", {
      goodsKey: "120871",
      optionCount: 0,
    }),
    /SHOPLING_GOODS_KEY_OPTION_COUNT_INVALID/,
  );
});

test("HF69 restores visible top-to-bottom A21 option clicking before the form fallback", async () => {
  const [contentBase, mainBase] = await Promise.all([
    readFile("public/shopling-stock-state-sync/price-core-content-a21-v025.js", "utf8"),
    readFile("public/shopling-stock-state-sync/price-core-main-a21-v025.js", "utf8"),
  ]);
  const content = patchHf69A21ContentSource(contentBase);
  const main = patchHf69A21MainSource(mainBase);

  const visibleFirst = content.indexOf("if (await configureOptionByVisibleLabels())");
  const formFallback = content.indexOf('if (await chooseMode("goods_stock"))', visibleFirst);
  assert.ok(visibleFirst >= 0);
  assert.ok(formFallback > visibleFirst);
  assert.match(content, /getBoundingClientRect\(\)\.top/);
  assert.match(content, /VISIBLE_TOP_MODE_THEN_OPTION_ONLY_ROW/);
  assert.match(content, /!value\.includes\("추가상품송신"\)/);
  assert.match(content, /!value\.includes\("옵션\+추가상품송신"\)/);
  assert.match(main, /control\?\.closest\?\.\("tr"\)/);
  assert.match(main, /!evidence\.includes\("추가상품송신"\)/);
  new Function(content);
  new Function(main);
});

test("HF69 package stays reproducible while HF70 becomes the current serial gate", async () => {
  const [opsBase, background, route, optionRoute, page, planner] = await Promise.all([
    readFile("public/shopling-stock-state-sync/content-ops-v023.js", "utf8"),
    readFile("public/shopling-stock-state-sync/background-v089.js", "utf8"),
    readFile("src/app/api/shopling-stock-state-sync/download-hf69/route.ts", "utf8"),
    readFile("src/app/api/inventory-stock-control/shopling-option-status/route.ts", "utf8"),
    readFile("src/app/china-order-manager/stock-control/page.tsx", "utf8"),
    readFile("src/lib/shoplingStockLaunchPlan.ts", "utf8"),
  ]);
  const ops = patchHf69OpsSource(opsBase);

  assert.match(ops, /transmissions\.length !== result\.goodsKeys\.length/);
  assert.match(ops, /stockStateTransmissions: transmissions/);
  assert.match(ops, /optionApiApplied: false/);
  assert.match(background, /normalizedTransmissionsV089/);
  assert.match(background, /current\.effectiveProductKind/);
  assert.match(background, /active\.job\.optionApiApplied = false/);
  assert.match(background, /serialPerGoodsKey: true/);
  assert.match(optionRoute, /inspectShoplingBcodeOnGoodsKey/);
  assert.match(optionRoute, /inspection\.goodsOptionCount/);
  assert.match(optionRoute, /applyExactOptionStatus/);
  assert.match(optionRoute, /applyProductSaleStatus/);
  assert.match(optionRoute, /transmissionKind: plan\.transmissionKind/);
  assert.match(route, /const VERSION = "0\.6\.32"/);
  assert.match(route, /LIVE_OPTION_COUNT_PER_GOODS_KEY/);
  assert.match(route, /SERIAL_ONE_AT_A_TIME/);
  assert.match(page, /download-hf70/);
  assert.match(page, /v0\.6\.33 다운로드/);
  assert.match(planner, /ALL_DATE_STOCK_SYNC_MIN_VERSION = \[0, 6, 33\]/);
  new Function(background);
  new Function(ops);
});
