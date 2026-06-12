import assert from "node:assert/strict";
import test from "node:test";
import {
  findProductByModelNo,
  findProductsByText,
  getProductMasterItems,
} from "../src/lib/productMaster.ts";

test("finds a Product Master item by exact model number", () => {
  const product = findProductByModelNo(" AAA179 ");

  assert.equal(product?.modelNo, "aaa179");
  assert.equal(product?.modelName, "닭물통 니플형");
  assert.equal(product?.optionName, "단품");
});

test("finds Product Master items by model, display, and option text inclusion", () => {
  const modelMatches = findProductsByText("신청 품목: 무타공 스티커 후크");
  const optionMatches = findProductsByText("말발굽 고리링 골드 200개");

  assert.equal(modelMatches[0]?.modelNo, "aaa419");
  assert.equal(optionMatches.length, 1);
  assert.equal(optionMatches[0]?.id, "aaa270-gold");
  assert.match(optionMatches[0]?.displayName ?? "", /말발굽 고리링/);
});

test("returns an empty result for unmatched text", () => {
  assert.deepEqual(findProductsByText("등록되지 않은 완전히 새로운 상품"), []);
});

test("returns detached Product Master item records", () => {
  const items = getProductMasterItems();
  const originalModelName = items[0].modelName;
  items[0].modelName = "changed locally";

  assert.equal(getProductMasterItems()[0].modelName, originalModelName);
});
