import assert from "node:assert/strict";
import test from "node:test";
import { parseFreightApplicationText } from "../src/lib/freightApplicationParser.ts";

const sampleText = `신청번호:642247

제품정보:(1)
품목: Poultry Drinker
옵션(색상,사이즈): 产品规格: 固定螺丝水碗
상품상세url: https://detail.1688.com/offer/552689871722.html
hs_code: 3926909000
단가: 0.61
수량: 300
오픈마켓 주문번호: 3306760070065591852

제품정보 (2)
품목: Key Ring
옵션(색상,사이즈): 颜色: 金色
상품상세url: https://detail.1688.com/offer/710684525681.html
HS CODE: 7326209000
단가: 0.35
수량: 200
오픈마켓 주문번호: 3307376352586591852

제품정보: (3)
품목: Key Ring
옵션(색상,사이즈): 颜色: 银色
상품상세url: https://detail.1688.com/offer/710684525681.html
hs_code: 7326209000
단가: 0.35
수량: 200
오픈마켓 주문번호: 3307376352586591852

제품정보:(4)
품목: Key Ring
옵션(색상,사이즈): 颜色: 哑枪
상품상세url: https://detail.1688.com/offer/710684525681.html
hs_code: 7326209000
단가: 0.35
수량: 200
오픈마켓 주문번호: 3307376352586591852`;

const application = parseFreightApplicationText(sampleText);

test("parses the application number and four product blocks", () => {
  assert.equal(application.applicationNo, "642247");
  assert.equal(application.items.length, 4);
});

test("extracts all requested fields from the first item", () => {
  const firstItem = application.items[0];

  assert.equal(firstItem.itemName, "Poultry Drinker");
  assert.match(firstItem.optionText, /固定螺丝水碗/);
  assert.equal(firstItem.hsCode, "3926909000");
  assert.equal(firstItem.unitPrice, 0.61);
  assert.equal(firstItem.quantity, 300);
  assert.equal(firstItem.orderNo, "3306760070065591852");
});

test("keeps Chinese color values for repeated Key Ring rows", () => {
  assert.deepEqual(
    application.items.slice(1).map((item) => item.optionText),
    ["颜色: 金色", "颜色: 银色", "颜色: 哑枪"],
  );
});

test("handles missing tracking numbers without failing", () => {
  assert.equal(application.items[0].trackingNo, undefined);
  assert.equal(application.items.length, 4);
});

import { findProductByModelNoOrModelName } from "../src/lib/productMaster.ts";

test("looks up Product Master by model number, exact name, and unique partial name", () => {
  assert.equal(findProductByModelNoOrModelName(" AAA179 ")?.modelName, "닭물통 니플형");
  assert.equal(findProductByModelNoOrModelName("말발굽 고리링")?.modelNo, "aaa270");
  assert.equal(findProductByModelNoOrModelName("스티커 후크")?.modelNo, "aaa419");
  assert.equal(findProductByModelNoOrModelName("없는 상품"), undefined);
});
