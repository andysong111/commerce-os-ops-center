import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  applyFreightProductMasterMatches,
  extractFreight1688OfferId,
  matchFreightItemsToProductMaster,
  normalizeFreightChinaOption,
} from "../src/lib/freightProductMasterMatcher.ts";

function product(overrides = {}) {
  return {
    productId: "product-aaa270",
    modelNo: "AAA270",
    productName: "말발굽 고리링",
    productNameCn: "马蹄扣",
    category: "생활용품",
    status: "ACTIVE",
    mainImageUrl: "https://image.example/product.jpg",
    origin: "MADE IN CHINA",
    memo: "",
    skus: [
      {
        skuId: "sku-gold",
        barcode: "BAA1-1",
        optionName: "골드",
        chinaOptionName: "颜色: 金色",
        optionImageUrl: "https://image.example/gold.jpg",
        supplierUrl: "https://detail.1688.com/offer/710684525681.html",
        active: true,
        optionBarcodeNo: "",
        optionBarcodeIdentityKey: "B:BAA1-1",
        latestCostKrw: 100,
        currentBasePrice: 1000,
        listings: [],
      },
      {
        skuId: "sku-silver",
        barcode: "BAA1-2",
        optionName: "실버",
        chinaOptionName: "顏色：銀色",
        optionImageUrl: "",
        supplierUrl: "https://detail.1688.com/offer/710684525681.html?spm=test",
        active: true,
        optionBarcodeNo: "",
        optionBarcodeIdentityKey: "B:BAA1-2",
        latestCostKrw: 100,
        currentBasePrice: 1000,
        listings: [],
      },
    ],
    ...overrides,
  };
}

function item(overrides = {}) {
  return {
    id: "freight-673626-1-1",
    applicationNo: "673626",
    rowNo: 1,
    itemName: "Key Ring",
    optionText: "颜色：金色",
    detailUrl: "https://detail.1688.com/offer/710684525681.html?spm=copy",
    quantity: 20,
    ...overrides,
  };
}

test("normalizes 1688 offer IDs and Chinese option labels", () => {
  assert.equal(
    extractFreight1688OfferId(
      "https://detail.1688.com/offer/710684525681.html?spm=copy",
    ),
    "710684525681",
  );
  assert.equal(normalizeFreightChinaOption("型号：(白色烤漆) 逆向1米/13MM"), "白色烤漆逆向1米13mm");
});

test("matches the exact SKU by offer ID and normalized Chinese option regardless of row order", () => {
  const source = product();
  source.skus.reverse();
  const response = matchFreightItemsToProductMaster([item()], [source]);

  assert.deepEqual(response.summary, {
    total: 1,
    matched: 1,
    unmatched: 0,
    ambiguous: 0,
  });
  assert.equal(response.matches[0].reason, "OFFER_AND_OPTION_EXACT");
  assert.equal(response.matches[0].modelNo, "AAA270");
  assert.equal(response.matches[0].modelName, "말발굽 고리링");
  assert.equal(response.matches[0].barcode, "BAA1-1");
});

test("fails closed when one offer has multiple options but none exactly matches", () => {
  const response = matchFreightItemsToProductMaster(
    [item({ optionText: "颜色: 蓝色" })],
    [product()],
  );

  assert.equal(response.matches[0].status, "AMBIGUOUS");
  assert.equal(response.matches[0].reason, "OPTION_AMBIGUOUS");
  assert.equal(response.matches[0].barcode, undefined);
});

test("does not force a single-SKU offer when the copied option conflicts", () => {
  const source = product({ skus: [product().skus[0]] });
  const response = matchFreightItemsToProductMaster(
    [item({ optionText: "颜色: 蓝色" })],
    [source],
  );

  assert.equal(response.matches[0].status, "UNMATCHED");
  assert.equal(response.matches[0].reason, "OPTION_NOT_FOUND");
});

test("matches a unique SKU by offer ID when the application has no option", () => {
  const source = product({ skus: [product().skus[0]] });
  const response = matchFreightItemsToProductMaster(
    [item({ optionText: "" })],
    [source],
  );

  assert.equal(response.matches[0].status, "MATCHED");
  assert.equal(response.matches[0].reason, "OFFER_UNIQUE_SKU");
  assert.equal(response.matches[0].barcode, "BAA1-1");
});

test("supports an exact B-code manual lookup without fuzzy inference", () => {
  const source = product();
  source.skus[1].supplierUrl = "";
  const response = matchFreightItemsToProductMaster(
    [item({ detailUrl: undefined, optionText: "", lookupText: " baa1-2 " })],
    [source],
  );

  assert.equal(response.matches[0].status, "MATCHED");
  assert.equal(response.matches[0].reason, "LOOKUP_BARCODE_EXACT");
  assert.equal(response.matches[0].optionName, "실버");
});

test("applies only confirmed canonical fields to the freight row", () => {
  const application = {
    applicationNo: "673626",
    applicationNos: ["673626"],
    items: [item()],
  };
  const response = matchFreightItemsToProductMaster(application.items, [product()]);
  const applied = applyFreightProductMasterMatches(application, response.matches);

  assert.equal(applied.items[0].barcode, "BAA1-1");
  assert.equal(applied.items[0].modelNo, "AAA270");
  assert.equal(applied.items[0].modelName, "말발굽 고리링");
  assert.equal(applied.items[0].matchedModelNo, "AAA270");
  assert.equal(applied.items[0].matchedBarcode, "BAA1-1");
  assert.equal(applied.items[0].matchedImageUrl, "https://image.example/gold.jpg");
});

test("keeps the Product Master secret server-side and wires both import paths to the live matcher", () => {
  const route = readFileSync(
    new URL("../src/app/api/freight-product-master-match/route.ts", import.meta.url),
    "utf8",
  );
  const page = readFileSync(
    new URL("../src/app/freight-barcode-request/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(route, /loadLegacySeoInventoryCatalog/);
  assert.match(route, /resolveProductLaunchIdentity/);
  assert.doesNotMatch(page, /PRODUCT_MASTER_INTEGRATION_SECRET|x-commerce-os-integration-secret/);
  assert.ok(
    page.match(/requestFreightProductMasterMatches\(/g)?.length >= 4,
    "manual paste, extension import, rerun, and single-row apply must use the live matcher",
  );
});
