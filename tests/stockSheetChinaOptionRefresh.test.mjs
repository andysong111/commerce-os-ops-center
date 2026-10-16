import assert from "node:assert/strict";
import test from "node:test";
import {
  prepareStockSheetChinaOptionRefresh,
} from "../src/lib/stockSheetChinaOptionRefresh.ts";

function state(options) {
  return {
    schemaVersion: 3,
    savedAt: "2026-10-17T00:00:00.000Z",
    items: [{
      id: "item-aaa381",
      modelNumber: "AAA381",
      productName: "노른자쉐이커 색상랜덤",
      orderOptions: options,
    }],
  };
}

test("fills an empty China option from an exact model, product and sale-option match", () => {
  const result = prepareStockSheetChinaOptionRefresh(
    state([{ barcode: "BAC3-2", saleOption: "단품", chinaOption: "" }]),
    [{ rowNumber: 992, modelNumber: "aaa381", productName: "노른자쉐이커 색상랜덤", saleOption: "단품", chinaOption: "蓝黄色" }],
    "test-v1",
  );
  assert.equal(result.state.items[0].orderOptions[0].chinaOption, "蓝黄色");
  assert.equal(result.report.filledEmptyOptions, 1);
});

test("replaces a generic 단품 placeholder but preserves a specific existing Chinese option", () => {
  const rows = [{ rowNumber: 992, modelNumber: "AAA381", productName: "노른자쉐이커 색상랜덤", saleOption: "단품", chinaOption: "蓝黄色" }];
  const replaced = prepareStockSheetChinaOptionRefresh(
    state([{ barcode: "BAC3-2", saleOption: "단품", chinaOption: "단품" }]), rows, "test-v1",
  );
  assert.equal(replaced.state.items[0].orderOptions[0].chinaOption, "蓝黄色");
  assert.equal(replaced.report.replacedPlaceholderOptions, 1);

  const preserved = prepareStockSheetChinaOptionRefresh(
    state([{ barcode: "BAC3-2", saleOption: "단품", chinaOption: "粉色" }]), rows, "test-v1",
  );
  assert.equal(preserved.state.items[0].orderOptions[0].chinaOption, "粉色");
  assert.equal(preserved.report.changedOptions, 0);
});

test("maps aligned comma-separated sale and China options one by one", () => {
  const result = prepareStockSheetChinaOptionRefresh(
    state([
      { barcode: "BAC3-1", saleOption: "핑크", chinaOption: "" },
      { barcode: "BAC3-2", saleOption: "옐로우", chinaOption: "" },
    ]),
    [{
      rowNumber: 992,
      modelNumber: "AAA381",
      productName: "노른자쉐이커 색상랜덤",
      saleOption: "핑크, 옐로우",
      chinaOption: "粉色, 蓝黄色",
    }],
    "test-v1",
  );
  assert.deepEqual(
    result.state.items[0].orderOptions.map((option) => option.chinaOption),
    ["粉色", "蓝黄色"],
  );
  assert.equal(result.report.changedOptions, 2);
});

test("does not write when an exact key has conflicting source values", () => {
  const result = prepareStockSheetChinaOptionRefresh(
    state([{ barcode: "BAC3-2", saleOption: "단품", chinaOption: "" }]),
    [
      { rowNumber: 992, modelNumber: "AAA381", productName: "노른자쉐이커 색상랜덤", saleOption: "단품", chinaOption: "蓝黄色" },
      { rowNumber: 993, modelNumber: "AAA381", productName: "노른자쉐이커 색상랜덤", saleOption: "단품", chinaOption: "粉色" },
    ],
    "test-v1",
  );
  assert.equal(result.state.items[0].orderOptions[0].chinaOption, "");
  assert.equal(result.report.ambiguousOptionCount, 1);
});
