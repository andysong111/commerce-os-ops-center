import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProductLaunchPurchaseMetadataMap,
  buildPurchaseChinaLinkPatch,
  resolveDraftSupplierLink,
} from "../src/lib/productLaunchPurchaseMetadataCore.ts";
import { buildProductLaunchTrackerIndex } from "../src/lib/productLaunchTrackerOptimized.ts";
import { readChinaDetailPageLink } from "../public/product-launch-tracker-app/lib/china-product-links.mjs";

const commonUrl = "https://detail.1688.com/offer/10.html";
const purchaseUrl = "https://detail.1688.com/offer/20.html";
const detailPageUrl = "https://detail.1688.com/offer/30.html";
const backup = "https://detail.1688.com/offer/40.html";

test("purchase metadata keeps exact Shopling zero quantity and the newest evidence time", () => {
  const result = buildProductLaunchPurchaseMetadataMap([{
    modelNumber: "AAA001",
    productName: "SIMULATION ONLY",
    chinaProductLinks: ["https://detail.1688.com/offer/1.html"],
    orderOptions: [{
      barcode: "BCA5-1",
      saleOption: "남성",
      chinaOption: "肤色,均码",
      shoplingOptionSync: {
        optQty: "0",
        syncedAt: "2026-10-01T00:00:00+09:00",
      },
    }],
  }]);

  assert.deepEqual(result.get("BCA5-1"), {
    barcode: "BCA5-1",
    modelNumber: "AAA001",
    productName: "SIMULATION ONLY",
    supplierLink: "https://detail.1688.com/offer/1.html",
    saleOption: "남성",
    chinaOption: "肤色,均码",
    shoplingQuantity: 0,
    shoplingSyncedAt: "2026-09-30T15:00:00.000Z",
    conflict: false,
  });
});

test("conflicting Shopling quantities remain unknown instead of being summed or guessed", () => {
  const result = buildProductLaunchPurchaseMetadataMap([
    {
      chinaProductLinks: ["https://detail.1688.com/offer/1.html"],
      orderOptions: [{
        barcode: "BCA5-1",
        saleOption: "남성",
        chinaOption: "肤色,均码",
        shoplingOptionSync: { optQty: "0" },
      }],
    },
    {
      chinaProductLinks: ["https://detail.1688.com/offer/1.html"],
      orderOptions: [{
        barcode: "BCA5-1",
        saleOption: "남성",
        chinaOption: "肤色,均码",
        shoplingOptionSync: { optQty: "12" },
      }],
    },
  ]);

  assert.equal(result.get("BCA5-1").shoplingQuantity, null);
});

test("tracker index forwards purchase link roles and existing shared priority to all model B-codes", () => {
  const { summaries } = buildProductLaunchTrackerIndex({
    items: [
      {
        id: "shared",
        modelNumber: "AAA010",
        chinaProductLinks: [commonUrl, backup],
        orderOptions: [{ barcode: "BCA5-1", saleOption: "단품" }],
      },
      {
        id: "split",
        modelNumber: "AAA020",
        primaryChinaProductLink: detailPageUrl,
        chinaProductLinks: [detailPageUrl, backup],
        chinaLinkUsage: { commonUrl, purchaseUrl, detailPageUrl, purchaseAlternates: [backup] },
        orderOptions: [
          { barcode: "BCA5-2", saleOption: "빨강", supplierLink: detailPageUrl },
          { barcode: "BCA5-3", saleOption: "파랑" },
        ],
      },
    ],
  });
  const metadata = buildProductLaunchPurchaseMetadataMap(summaries);
  assert.equal(metadata.get("BCA5-1").supplierLink, commonUrl);
  assert.equal(resolveDraftSupplierLink(metadata.get("BCA5-2"), commonUrl), purchaseUrl);
  assert.equal(resolveDraftSupplierLink(metadata.get("BCA5-3"), detailPageUrl), purchaseUrl);
  assert.deepEqual(summaries.find((item) => item.id === "split").chinaProductLinks, [purchaseUrl, backup]);
});

test("missing or conflicting configured purchase links block fallback to old draft links", () => {
  const detailOnly = {
    chinaProductLinks: [detailPageUrl, backup],
    chinaLinkUsage: { commonUrl, purchaseUrl: "", detailPageUrl, purchaseAlternates: [backup] },
    orderOptions: [{ barcode: "BCA5-1", saleOption: "단품" }],
  };
  const metadata = buildProductLaunchPurchaseMetadataMap([detailOnly]);
  assert.equal(resolveDraftSupplierLink(metadata.get("BCA5-1"), commonUrl), "");
  const conflict = buildProductLaunchPurchaseMetadataMap([
    detailOnly,
    { ...detailOnly, chinaLinkUsage: { ...detailOnly.chinaLinkUsage, purchaseUrl } },
  ]);
  assert.equal(conflict.get("BCA5-1").conflict, true);
  assert.equal(resolveDraftSupplierLink(conflict.get("BCA5-1"), commonUrl), "");
  assert.equal(resolveDraftSupplierLink(undefined, commonUrl), commonUrl);
});

test("draft writeback updates purchase only and preserves image source metadata and legacy order", () => {
  const legacy = {
    chinaProductLinks: [commonUrl, backup],
    detailPageSource: { primaryUrl: commonUrl, resultId: "existing-result" },
  };
  assert.deepEqual(buildPurchaseChinaLinkPatch(legacy, commonUrl), {});
  const patch = buildPurchaseChinaLinkPatch(legacy, purchaseUrl);
  assert.equal(patch.chinaLinkUsage.purchaseUrl, purchaseUrl);
  assert.equal(readChinaDetailPageLink(patch), commonUrl);
  assert.equal(patch.detailPageSource.resultId, "existing-result");
  assert.deepEqual(patch.chinaLinkUsage.purchaseAlternates, [commonUrl, backup]);

  const withoutImageSource = buildPurchaseChinaLinkPatch({}, purchaseUrl);
  assert.equal(readChinaDetailPageLink(withoutImageSource), "");
  assert.equal(withoutImageSource.chinaLinkUsage.purchaseUrl, purchaseUrl);
});
