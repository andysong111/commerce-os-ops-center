import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { alignChinaOptionMappingsToRegisteredOptions } from "../public/product-launch-tracker-app/lib/china-option-table-authority.mjs";

const [loader, workflowGate, extension, authorityUi, page] = await Promise.all([
  readFile("public/product-launch-tracker-app/app.js", "utf8"),
  readFile("public/product-launch-tracker-app/workflow-ui-gate.js", "utf8"),
  readFile(
    "public/product-launch-tracker-app/optimized-china-order-mapping.js",
    "utf8",
  ),
  readFile(
    "public/product-launch-tracker-app/china-option-table-authority.js",
    "utf8",
  ),
  readFile("src/app/product-launch-tracker/page.tsx", "utf8"),
]);

test("optimized product-launch path loads the B-code China option extensions after workflow health gate", () => {
  assert.match(loader, /workflow-ui-gate\.js/);
  assert.match(workflowGate, /import\("\.\/optimized-app\.js"\)/);
  assert.match(
    loader,
    /await import\("\.\/optimized-china-order-mapping\.js"\)/,
  );
  assert.match(
    loader,
    /await import\("\.\/model-bcode-option-guard\.js"\)/,
  );
  assert.match(
    loader,
    /await import\("\.\/china-option-table-authority\.js"\)/,
  );
  assert.match(page, /20260815-bidirectional-purchase-metadata-v1/);
});

test("active product detail stores only B-code China option while model fixed first link stays product-owned", () => {
  assert.match(extension, /B-code별 중국옵션/);
  assert.match(extension, /data-optimized-china-order-map-row/);
  assert.match(extension, /data-optimized-china-order-option-input/);
  assert.doesNotMatch(extension, /data-optimized-china-order-link-select/);
  assert.match(extension, /이 모델의 발주용 링크를 사용합니다/);
  assert.match(extension, /readChinaOrderOptionMappings/);
});

test("B-code별 중국옵션은 발주·입고 옵션가격에 등록된 B-code만 남긴다", () => {
  const aligned = alignChinaOptionMappingsToRegisteredOptions(
    [{ id: "real", barcode: "BAC2-2", saleOption: "색상랜덤" }],
    [
      {
        id: "blank",
        barcode: "",
        saleOption: "블랙1P,그레이1P",
        chinaOption: "잘못된 중국옵션",
      },
      {
        id: "wrong-1",
        barcode: "BCB6-2",
        saleOption: "블랙1P",
        chinaOption: "잘못된 중국옵션2",
      },
      {
        id: "right",
        barcode: "BAC2-2",
        saleOption: "색상랜덤",
        chinaOption: "灰色",
      },
    ],
  );
  assert.deepEqual(aligned, [
    {
      id: "right",
      barcode: "BAC2-2",
      saleOption: "색상랜덤",
      chinaOption: "灰色",
    },
  ]);
});

test("option-price table mutation and late detail loading mount and align the China option panel", () => {
  assert.match(authorityUi, /#detail-options/);
  assert.match(authorityUi, /\[data-field='barcode'\]/);
  assert.match(authorityUi, /\[data-field='saleOption'\]/);
  assert.match(authorityUi, /MutationObserver/);
  assert.match(authorityUi, /syncTimers = new Set/);
  assert.match(authorityUi, /ensureChinaOptionPanel/);
  assert.match(authorityUi, /readChinaOrderOptionMappings/);
  assert.match(authorityUi, /fetchItem/);
  assert.match(authorityUi, /alignChinaOptionMappingsToRegisteredOptions/);
  assert.match(authorityUi, /발주·입고 옵션가격에 바코드·위치코드가 등록된/);
  assert.doesNotMatch(authorityUi, /operation:\s*"patch_item"/);
  assert.doesNotMatch(authorityUi, /placeOrder|payOrder|checkout|fetch\([^)]*1688/i);
});

test("China option mapping persists only after the optimized main product save closes successfully", () => {
  assert.match(extension, /captureBeforeSave/);
  assert.match(extension, /waitForMainSave/);
  assert.match(extension, /if \(detailDialog\?\.open\)/);
  assert.match(extension, /applyChinaOrderOptionMappings/);
  assert.match(extension, /operation: "patch_item"/);
  assert.match(extension, /patch: \{ orderOptions: next\.orderOptions \}/);
});

test("mapping never changes fixed B-code sale options or exposes per-B-code link selection", () => {
  assert.doesNotMatch(extension, /patch:\s*\{[^}]*saleOption/s);
  assert.doesNotMatch(extension, /supplierLink:/);
  assert.doesNotMatch(extension, /placeOrder|payOrder|checkout|fetch\([^)]*1688/i);
});
