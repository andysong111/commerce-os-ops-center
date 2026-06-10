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

const looseTableText = `입력란에 하나의 트래킹만 입력\r\n颜色: 金色\r\n3307376352586591852\r\n2\r\nhttps://cbu01.alicdn.com/img/ibank/O1CN-test-gold.jpg\r\n200\r\nKey Ring\r\n\r\n입력란에 하나의 트래킹만 입력\r\n颜色: 银色\r\n3307376352586591852\r\n3\r\nhttps://cbu01.alicdn.com/img/ibank/O1CN-test-silver.jpg\r\n200\r\nKey Ring\r\n\r\n입력란에 하나의 트래킹만 입력\r\n颜色: 哑枪\r\n3307376352586591852\r\n4\r\nhttps://cbu01.alicdn.com/img/ibank/O1CN-test-black.jpg\r\n200\r\nKey Ring`;

const looseApplication = parseFreightApplicationText(looseTableText);

test("falls back to parsing loose freight table-copy rows", () => {
  assert.equal(looseApplication.applicationNo, "");
  assert.equal(looseApplication.items.length, 3);

  const [firstItem, secondItem, thirdItem] = looseApplication.items;
  assert.equal(firstItem.rowNo, 2);
  assert.match(firstItem.optionText, /金色/);
  assert.equal(firstItem.orderNo, "3307376352586591852");
  assert.equal(firstItem.quantity, 200);
  assert.equal(firstItem.itemName, "Key Ring");
  assert.equal(
    firstItem.detailUrl,
    "https://cbu01.alicdn.com/img/ibank/O1CN-test-gold.jpg",
  );
  assert.match(secondItem.optionText, /银色/);
  assert.match(thirdItem.optionText, /哑枪/);
});

test("allows loose table-copy input without an application number", () => {
  assert.equal(looseApplication.applicationNo, "");
  assert.equal(looseApplication.items.length, 3);
});

test("does not treat the tracking input placeholder as a tracking number", () => {
  assert.deepEqual(
    looseApplication.items.map((item) => item.trackingNo),
    [undefined, undefined, undefined],
  );
});

test("extracts an application number near its label in loose copied text", () => {
  const parsed = parseFreightApplicationText(`신청번호\n[나비]642247\n${looseTableText}`);

  assert.equal(parsed.applicationNo, "642247");
  assert.equal(parsed.items.length, 3);
});

test("keeps a real tracking number from loose copied text", () => {
  const parsed = parseFreightApplicationText(`YT123456789CN\n产品规格: 固定螺丝水碗\n3306760070065591852\n1\nhttps://cbu01.alicdn.com/test.jpg\n300\nPoultry Drinker`);

  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].trackingNo, "YT123456789CN");
});

test("creates a loose row when optional order, price, and HS code fields are missing", () => {
  const parsed = parseFreightApplicationText(`颜色: 金色\n5\nhttps://cbu01.alicdn.com/partial.jpg\n50\nDrilling Machine`);

  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].rowNo, 5);
  assert.equal(parsed.items[0].quantity, 50);
  assert.equal(parsed.items[0].itemName, "Drilling Machine");
  assert.equal(parsed.items[0].orderNo, undefined);
  assert.equal(parsed.items[0].unitPrice, undefined);
  assert.equal(parsed.items[0].hsCode, undefined);
});
