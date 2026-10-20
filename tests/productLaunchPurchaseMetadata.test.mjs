import assert from "node:assert/strict";
import test from "node:test";
import { buildProductLaunchPurchaseMetadataMap } from "../src/lib/productLaunchPurchaseMetadataCore.ts";

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
