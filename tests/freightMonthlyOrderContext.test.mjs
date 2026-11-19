import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { applyFreightMonthlyOrderContext } from "../src/lib/freightMonthlyOrderContext.ts";

const context = {
  cycleMonth: "2026-09",
  draftId: "fast-purchase-draft:1234567890abcdef1234",
  orderCount: 1,
  lineCount: 2,
  totalQuantity: 25,
  savedAt: Date.now(),
  lines: [
    {
      barcode: "BGA1-1",
      modelNo: "AAA027",
      modelName: "냉장고 자석트레이",
      saleOption: "화이트 L",
      chinaOption: "磁吸白色大号",
      orderNumber: "5127724441173018635",
      supplierLink: "https://detail.1688.com/offer/723117981480.html",
      quantity: 15,
    },
    {
      barcode: "BGA4-1",
      modelNo: "AAA027",
      modelName: "냉장고 자석트레이",
      saleOption: "블랙 L",
      chinaOption: "磁吸黑色大号",
      orderNumber: "5127724441173018635",
      supplierLink: "https://detail.1688.com/offer/723117981480.html",
      quantity: 10,
    },
  ],
};

function item(overrides = {}) {
  return {
    id: "freight-item-1-1",
    rowNo: 1,
    itemName: "Magnetic Refrigerator Shelf",
    optionText: "",
    quantity: 0,
    ...overrides,
  };
}

test("same 1688 order number is disambiguated by Chinese option", () => {
  const result = applyFreightMonthlyOrderContext(
    [
      item({
        id: "white",
        optionText: "产品规格: 磁吸白色大号",
        quantity: 15,
        orderNo: "5127724441173018635",
      }),
      item({
        id: "black",
        optionText: "产品规格: 磁吸黑色大号",
        quantity: 10,
        orderNo: "5127724441173018635",
      }),
    ],
    context,
  );

  assert.equal(result.matchedCount, 2);
  assert.equal(result.items[0].barcode, "BGA1-1");
  assert.equal(result.items[0].modelNo, "AAA027");
  assert.equal(result.items[1].barcode, "BGA4-1");
  assert.match(result.items[1].memo, /월간 발주 자동연동 2026-09/);
});

test("ambiguous duplicate order number is not assigned arbitrarily", () => {
  const result = applyFreightMonthlyOrderContext(
    [item({ orderNo: "5127724441173018635" })],
    context,
  );

  assert.equal(result.matchedCount, 0);
  assert.equal(result.items[0].barcode, undefined);
});

test("1688 offer id and option can match when order number is missing", () => {
  const result = applyFreightMonthlyOrderContext(
    [
      item({
        detailUrl:
          "https://detail.1688.com/offer/723117981480.html?spm=test",
        optionText: "磁吸黑色大号",
        quantity: 10,
      }),
    ],
    context,
  );

  assert.equal(result.matchedCount, 1);
  assert.equal(result.items[0].barcode, "BGA4-1");
});

test("weak unrelated text does not receive a monthly B-code", () => {
  const result = applyFreightMonthlyOrderContext(
    [item({ itemName: "unrelated product", optionText: "green", quantity: 3 })],
    context,
  );

  assert.equal(result.matchedCount, 0);
  assert.equal(result.items[0].matchedBarcode, undefined);
});

test("monthly bridge preserves the selected draft id on the final freight URL", () => {
  const bridge = readFileSync(
    new URL(
      "../src/components/freight-barcode-request/FreightMonthlyOrderContextBridge.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const monthlyPage = readFileSync(
    new URL("../src/app/freight-barcode-request/monthly/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(bridge, /draft=\$\{encodeURIComponent\(context\.draftId\)\}/);
  assert.match(monthlyPage, /\.\.\.\(draftId \? \{ draftId \} : \{\}\)/);
});
