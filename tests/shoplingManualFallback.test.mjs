import assert from "node:assert/strict";
import test from "node:test";
import {
  buildShoplingManualFallbackGroups,
  shoplingManualFallbackCopyText,
} from "../src/lib/shoplingManualFallback.ts";

test("manual fallback preserves the exact product-before-option recovery order", () => {
  const groups = buildShoplingManualFallbackGroups([
    {
      barcode: "BDE4-1",
      desiredStatus: "ON_SALE",
      productKind: "OPTION",
      goodsKeys: ["120", "30"],
      stockStateApiEvidence: [
        {
          matchedGoodsKey: "120",
          transmissionSteps: [
            { transmissionKind: "PRODUCT_SALE_STATUS_SEND" },
            { transmissionKind: "OPTION_SEND" },
          ],
        },
        {
          matchedGoodsKey: "30",
          transmissionSteps: [{ transmissionKind: "OPTION_SEND" }],
        },
      ],
    },
  ]);

  assert.deepEqual(groups, {
    soldOutProductGoodsKeys: [],
    onSaleProductGoodsKeys: ["120"],
    optionGoodsKeys: ["30", "120"],
    unresolvedBarcodes: [],
  });
  assert.equal(shoplingManualFallbackCopyText(groups.optionGoodsKeys), "30,120");
});

test("manual fallback routes full option sold-out through product sold-out", () => {
  const groups = buildShoplingManualFallbackGroups([
    {
      barcode: "BDE3-3",
      desiredStatus: "SOLD_OUT",
      productKind: "OPTION",
      goodsKeys: ["122563"],
      stockStateApiEvidence: [
        {
          matchedGoodsKey: "122563",
          transmissionKind: "PRODUCT_SALE_STATUS_SEND",
          transmissionSteps: [
            { transmissionKind: "PRODUCT_SALE_STATUS_SEND" },
          ],
        },
      ],
    },
  ]);

  assert.deepEqual(groups.soldOutProductGoodsKeys, ["122563"]);
  assert.deepEqual(groups.optionGoodsKeys, []);
  assert.deepEqual(groups.unresolvedBarcodes, []);
});

test("manual fallback never guesses an option lane without API evidence", () => {
  const groups = buildShoplingManualFallbackGroups([
    {
      barcode: "BCC6-2",
      desiredStatus: "SOLD_OUT",
      productKind: "OPTION",
      goodsKeys: ["119382"],
    },
    {
      barcode: "BBB4-3",
      desiredStatus: "SOLD_OUT",
      productKind: "SINGLE",
      goodsKeys: ["99", "12"],
    },
  ]);

  assert.deepEqual(groups.soldOutProductGoodsKeys, ["12", "99"]);
  assert.deepEqual(groups.optionGoodsKeys, []);
  assert.deepEqual(groups.unresolvedBarcodes, ["BCC6-2"]);
});
