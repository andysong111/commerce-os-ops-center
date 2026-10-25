import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { applyProductLaunchTrackerMutation } from "../src/lib/productLaunchTrackerOptimized.ts";

const stability = await readFile(
  new URL("../public/product-launch-tracker-app/manual-detail-save-stability.js", import.meta.url),
  "utf8",
);
const page = await readFile(
  new URL("../src/app/product-launch-tracker/page.tsx", import.meta.url),
  "utf8",
);
const standaloneEditor = await readFile(
  new URL("../src/app/product-launch-editor/ProductLaunchStandaloneEditor.tsx", import.meta.url),
  "utf8",
);

test("상품상세 수동 기준판매가는 patch_item 저장 시 10원 단위로 올린다", () => {
  const state = {
    schemaVersion: 3,
    savedAt: "2026-08-25T00:00:00.000Z",
    items: [
      {
        id: "launch-price-test",
        modelNumber: "AAA481",
        productName: "스트라이프 버킷햇",
        barcode: "BEH2-1",
        orderOptions: [
          {
            id: "option-beh2-1",
            optionName: "옵션",
            saleOption: "단품",
            barcode: "BEH2-1",
            optionBarcodeNo: "000000000641",
            baseSalePriceKrw: 0,
            unitCostKrw: 0,
          },
        ],
        stages: {},
      },
    ],
  };

  const mutation = applyProductLaunchTrackerMutation(state, {
    operation: "patch_item",
    itemId: "launch-price-test",
    patch: {
      orderOptions: [
        {
          id: "option-beh2-1",
          optionName: "옵션",
          saleOption: "단품",
          barcode: "BEH2-1",
          optionBarcodeNo: "000000000641",
          baseSalePriceKrw: 2651,
          unitCostKrw: 1330,
        },
      ],
    },
    updatedBy: "manual-price-test",
  });

  const option = mutation.state.items[0].orderOptions[0];
  assert.equal(option.baseSalePriceKrw, 2660);
  assert.equal(option.unitCostKrw, 1330);
  assert.equal(option.barcode, "BEH2-1");
  assert.deepEqual(mutation.changedIds, ["launch-price-test"]);
});

test("독립 편집기에서 원가 입력은 기준판매가 x2 후 10원 올림을 기본값으로 만든다", () => {
  assert.match(standaloneEditor, /function salePriceFromUnitCost\(value: unknown\)/);
  assert.match(standaloneEditor, /return productLaunchSalePriceFromUnitCostKrw\(value\)/);
  assert.match(standaloneEditor, /baseSalePriceKrw: salePriceFromUnitCost\(unitCostKrw\)/);
  assert.match(standaloneEditor, /onChange=\{\(event\) => updateUnitCost\(index, event\.target\.value\)\}/);
  assert.match(standaloneEditor, /onChange=\{\(event\) => updateOption\(index, \{ baseSalePriceKrw:/);
  assert.match(standaloneEditor, /직접 입력한 가격도 저장할 때 같은 기준이 적용됩니다/);
});

test("수동 저장 안정화 계층은 화면 가격값을 강제 포함하고 서버 재조회 검증 후에만 성공한다", () => {
  assert.match(stability, /readDomOrderOptions/);
  assert.match(stability, /baseSalePriceKrw: nonNegativeInteger\(read\("baseSalePriceKrw"\)\)/);
  assert.match(stability, /unitCostKrw: nonNegativeInteger\(read\("unitCostKrw"\)\)/);
  assert.match(stability, /patch\.orderOptions = domOptions\.map/);
  assert.match(stability, /verifyPersistedOptions/);
  assert.match(stability, /compareOrderOptions/);
  assert.match(stability, /기준판매가가 서버 저장본과 다릅니다/);
  assert.match(stability, /원가가 서버 저장본과 다릅니다/);
  assert.match(stability, /상품출시진행관리 수동 가격 재확인/);
  assert.match(stability, /저장 확인 실패/);
});

test("저장 성공은 화면 중앙의 명확한 완료 팝업으로 표시한다", () => {
  assert.match(stability, /manual-detail-save-popup/);
  assert.match(stability, /✓ 저장 완료/);
  assert.match(stability, /기준판매가·원가 .*서버 반영 확인/);
  assert.match(stability, /z-index: 2147483647/);
  assert.match(page, /manual-price-verify-v1/);
});

test("수동 저장 브라우저 모듈은 문법 검사를 통과한다", () => {
  const checked = spawnSync(
    process.execPath,
    ["--check", "public/product-launch-tracker-app/manual-detail-save-stability.js"],
    { encoding: "utf8" },
  );
  assert.equal(checked.status, 0, checked.stderr || checked.stdout);
});
