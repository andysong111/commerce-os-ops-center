import assert from "node:assert/strict";
import test from "node:test";
import {
  prepareUserChinaPurchaseRules20261017,
} from "../src/lib/userChinaPurchaseRules20261017.ts";

const option = (barcode, saleOption, chinaOption = "") => ({ barcode, saleOption, chinaOption });

function fixture() {
  return {
    schemaVersion: 3,
    savedAt: "2026-10-17T00:00:00.000Z",
    items: [
      { id: "aaa127", modelNumber: "AAA127", productName: "똑딱이 펀칭기", orderOptions: [option("BCB3-1", "단품")] },
      { id: "aaa015", modelNumber: "AAA015", productName: "투구 골무", orderOptions: [option("BCD6-2", "M"), option("BCD6-1", "S")] },
      { id: "aaa022", modelNumber: "AAA022", productName: "공병", orderOptions: [option("BDE5-2", "회색", "浅灰"), option("BDE5-3", "하늘"), option("BDE6-1", "진청"), option("BDE6-2", "연두"), option("BDE6-3", "황토")] },
      { id: "aaa186", modelNumber: "AAA186", productName: "오븐장갑", orderOptions: [option("BCB6-3", "그레이 1쌍"), option("BCB6-2", "블랙 1쌍")] },
      { id: "aaa318", modelNumber: "AAA318", productName: "발세척매트", chinaProductLinks: ["https://detail.1688.com/offer/old.html"], orderOptions: [option("BAC1-1", "그레이"), option("BAC1-3", "화이트"), option("BAC2-1", "핑크")] },
      { id: "aaa483", modelNumber: "AAA483", productName: "반달쿠션", orderOptions: [option("BEE5-1", "색상랜덤")] },
    ],
  };
}

test("applies exact user mappings and packaging rules without changing counterintuitive size mapping", () => {
  const result = prepareUserChinaPurchaseRules20261017(fixture(), "2026-10-17T01:00:00.000Z");
  const byModel = new Map(result.state.items.map((item) => [item.modelNumber, item]));
  assert.deepEqual(byModel.get("AAA015").orderOptions.map((row) => row.chinaOption), [
    "玫瑰粉色（100个倍数）,S号",
    "玫瑰粉色（100个倍数）,M号",
  ]);
  assert.deepEqual(byModel.get("AAA127").orderOptions[0].purchasePolicy.components, [
    { chinaOption: "金属钳子", quantityMultiplier: 1 },
    { chinaOption: "空心银色50套", quantityMultiplier: 1 },
  ]);
  assert.deepEqual(byModel.get("AAA186").orderOptions.map((row) => row.purchasePolicy.quantityMultiplier), [2, 2]);
  assert.equal(byModel.get("AAA483").orderOptions[0].purchasePolicy.optionSelection, "ANY_AVAILABLE");
});

test("marks only the four requested AAA022 options discontinued and replaces supplier offer first", () => {
  const result = prepareUserChinaPurchaseRules20261017(fixture(), "2026-10-17T01:00:00.000Z");
  const byModel = new Map(result.state.items.map((item) => [item.modelNumber, item]));
  const aaa022 = byModel.get("AAA022");
  assert.equal(aaa022.orderOptions[0].purchasePolicy, undefined);
  assert.deepEqual(
    aaa022.orderOptions.slice(1).map((row) => row.purchasePolicy.status),
    ["DISCONTINUED", "DISCONTINUED", "DISCONTINUED", "DISCONTINUED"],
  );
  assert.match(byModel.get("AAA318").chinaProductLinks[0], /1063136870043/);
  assert.equal(result.report.missingModels.length > 0, true);
});

