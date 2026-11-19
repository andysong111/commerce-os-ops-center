import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  applyFreightProductMasterMatches,
  extractFreight1688OfferId,
  matchFreightItemsToPurchaseDraft,
  matchFreightItemsToProductMaster,
  matchFreightItemsWithPurchaseDraftFallback,
  normalizeFreightChinaOption,
  selectFreightPurchaseDraftLinesByOrderNumbers,
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

test("matches the two real 673626 Product Master misses from the selected purchase draft by exact order number", () => {
  const draftLines = [
    {
      barcode: "BBF8-1",
      modelNo: "AAA367",
      modelName: "차량용 소변기",
      saleOption: "블루",
      chinaOption: "单个蓝色OPP伸缩",
      supplierLink: "https://detail.1688.com/offer/679581284406.html",
      orderNumber: "3317016685189009453",
      quantity: 150,
    },
    {
      barcode: "BBE6-2",
      modelNo: "AAA507",
      modelName: "투명 플라스틱 서랍형 수납함",
      saleOption: "90L",
      chinaOption: "【深53】*48*35cm有卡扣 90L",
      supplierLink: "https://detail.1688.com/offer/677122530258.html",
      orderNumber: "3316586270196027099",
      quantity: 4,
    },
  ];
  const response = matchFreightItemsToPurchaseDraft(
    [
      item({
        id: "urinal",
        rowNo: 7,
        itemName: "Plastic Urinal",
        optionText: "规格: 单个蓝色OPP伸缩",
        detailUrl: "https://detail.1688.com/offer/679581284406.html",
        orderNo: "3317016685189009453",
        quantity: 150,
      }),
      item({
        id: "storage",
        rowNo: 8,
        itemName: "Plastic Storage Box",
        optionText: "颜色: 白色外框+透明抽屉 尺寸: 【深53】*48*35cm有卡扣 90L",
        detailUrl: "https://detail.1688.com/offer/677122530258.html",
        orderNo: "3316586270196027099",
        quantity: 4,
      }),
    ],
    draftLines,
  );

  assert.deepEqual(response.summary, {
    total: 2,
    matched: 2,
    unmatched: 0,
    ambiguous: 0,
  });
  assert.equal(response.matches[0].barcode, "BBF8-1");
  assert.equal(response.matches[0].modelNo, "AAA367");
  assert.equal(response.matches[0].source, "PURCHASE_DRAFT");
  assert.equal(response.matches[1].barcode, "BBE6-2");
  assert.equal(response.matches[1].modelName, "투명 플라스틱 서랍형 수납함");
});

test("fails closed when duplicate purchase-draft order lines cannot be disambiguated", () => {
  const duplicate = {
    barcode: "BBF8-1",
    modelNo: "AAA367",
    modelName: "차량용 소변기",
    saleOption: "",
    chinaOption: "",
    supplierLink: "",
    orderNumber: "3317016685189009453",
    quantity: 150,
  };
  const response = matchFreightItemsToPurchaseDraft(
    [
      item({
        detailUrl: undefined,
        optionText: "",
        orderNo: duplicate.orderNumber,
        quantity: 0,
      }),
    ],
    [duplicate, { ...duplicate, barcode: "BBF8-2", saleOption: "다른 옵션" }],
  );

  assert.equal(response.matches[0].status, "AMBIGUOUS");
  assert.equal(response.matches[0].reason, "PURCHASE_DRAFT_AMBIGUOUS");
  assert.equal(response.matches[0].barcode, undefined);
});

test("uses Product Master only when no purchase-draft candidate exists", () => {
  const response = matchFreightItemsWithPurchaseDraftFallback(
    [item()],
    [],
    [product()],
  );

  assert.equal(response.matches[0].status, "MATCHED");
  assert.equal(response.matches[0].source, "PRODUCT_MASTER");
  assert.equal(response.matches[0].barcode, "BAA1-1");
});

test("auto-selects the newest purchase draft by exact 1688 order number and ignores stale copies", () => {
  const orderNumber = "3316598510069009453";
  const selection = selectFreightPurchaseDraftLinesByOrderNumbers(
    [item({ orderNo: orderNumber })],
    [
      {
        draftId: "fast-purchase-draft:newest00000000000000",
        lines: [
          {
            barcode: "BBA7-3",
            modelNo: "AAA495",
            modelName: "캔압축기",
            saleOption: "단품 그레이",
            chinaOption: "深空灰压罐器",
            supplierLink: "https://detail.1688.com/offer/923615736263.html",
            orderNumber,
            quantity: 8,
          },
        ],
      },
      {
        draftId: "fast-purchase-draft:stale000000000000000",
        lines: [
          {
            barcode: "OLD1-1",
            modelNo: "OLD001",
            modelName: "이전 초안",
            saleOption: "",
            chinaOption: "",
            supplierLink: "",
            orderNumber,
            quantity: 8,
          },
        ],
      },
    ],
  );

  assert.deepEqual(selection.draftIds, ["fast-purchase-draft:newest00000000000000"]);
  assert.equal(selection.requestedOrderCount, 1);
  assert.equal(selection.resolvedOrderCount, 1);
  assert.equal(selection.lines.length, 1);
  assert.equal(selection.lines[0].barcode, "BBA7-3");
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
  assert.match(route, /loadInternalChinaPurchaseDraft/);
  assert.match(route, /loadOrderNumberMatchedDraftLines/);
  assert.match(route, /selectFreightPurchaseDraftLinesByOrderNumbers/);
  assert.match(route, /matchFreightItemsWithPurchaseDraftFallback/);
  assert.match(route, /resolveProductLaunchIdentity/);
  assert.match(page, /draftId/);
  assert.match(page, /orderNo: item\.orderNo/);
  assert.doesNotMatch(page, /PRODUCT_MASTER_INTEGRATION_SECRET|x-commerce-os-integration-secret/);
  assert.ok(
    page.match(/requestFreightProductMasterMatches\(/g)?.length >= 4,
    "manual paste, extension import, rerun, and single-row apply must use the live matcher",
  );
});
