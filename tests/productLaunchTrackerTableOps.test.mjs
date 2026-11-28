import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  alignTableRow,
  applyInlineOptionLabels,
  buildFrozenColumnGeometry,
  DEFAULT_TABLE_COLUMN_ORDER,
  frozenColumnKeys,
  moveColumn,
  normalizeColumnOrder,
  parseInlineOptionLabels,
} from "../public/product-launch-tracker-app/lib/table-inline-ops.mjs";
import { pruneLegacyWorkflowRow } from "../public/product-launch-tracker-app/workflow-stage-pruner.js";

test("열 순서는 선택 열을 첫 번째로 유지하고 누락 열을 복원한다", () => {
  const order = normalizeColumnOrder([
    "productName",
    "options",
    "productName",
    "unknown",
    "select",
  ]);
  assert.equal(order[0], "select");
  assert.equal(order[1], "productName");
  assert.equal(order[2], "options");
  assert.deepEqual(new Set(order), new Set(DEFAULT_TABLE_COLUMN_ORDER));
});

test("재고 열이 있는 행과 헤더에서 이전 단계를 빼도 선택 열과 값이 같은 위치에 유지된다", () => {
  const keys = ["select", "workBatch", "barcode", "modelNumber", "productName",
    "shoplingCategory", "options", "stock", "readiness", "detailPage",
    "priceKeyword", "shoplingUpload", "marketRegistration", "orderMapping",
    "inventoryReflection", "nextStage", "manage"];
  const layout = normalizeColumnOrder(["manage", "select", "workBatch", "barcode"]);
  function makeRow(order, keyed) {
    const row = {
      children: [],
      get cells() { return this.children; },
      moves: 0,
      insertBefore(cell, next) {
        this.moves++;
        this.children.splice(this.children.indexOf(cell), 1);
        this.children.splice(next ? this.children.indexOf(next) : this.children.length, 0, cell);
      },
    };
    row.children = order.map((key) => {
      const legacy = ["priceKeyword", "marketRegistration", "orderMapping", "inventoryReflection"].includes(key);
      const cell = {
        dataset: keyed || !legacy ? { columnKey: key } : {},
        querySelector: () => legacy ? { dataset: { stage: key } } : null,
        remove: () => row.children.splice(row.children.indexOf(cell), 1),
      };
      return cell;
    });
    return row;
  }
  const header = makeRow(keys, true);
  const row = makeRow(["stock", ...keys.filter((key) => key !== "stock")], false);
  for (const element of [header, row]) {
    pruneLegacyWorkflowRow(element);
    alignTableRow(element, layout);
    assert.deepEqual(element.children.map((cell) => cell.dataset.columnKey), layout);
    const { moves } = element;
    alignTableRow(element, layout);
    assert.equal(element.moves, moves);
  }
});

test("활성 상품출시 표는 상세페이지와 샵플링 업로드 두 단계만 유지한다", async () => {
  const pruner = await readFile(
    new URL(
      "../public/product-launch-tracker-app/workflow-stage-pruner.js",
      import.meta.url,
    ),
    "utf8",
  );
  const loader = await readFile(
    new URL(
      "../public/product-launch-tracker-app/table-inline-ops-loader.js",
      import.meta.url,
    ),
    "utf8",
  );
  assert.ok(DEFAULT_TABLE_COLUMN_ORDER.includes("detailPage"));
  assert.ok(DEFAULT_TABLE_COLUMN_ORDER.includes("shoplingUpload"));
  for (const legacy of [
    "priceKeyword",
    "marketRegistration",
    "orderMapping",
    "inventoryReflection",
  ]) {
    assert.equal(DEFAULT_TABLE_COLUMN_ORDER.includes(legacy), false);
    assert.match(pruner, new RegExp(legacy));
  }
  assert.match(loader, /workflow-stage-pruner\.js/);
  assert.match(pruner, /status: "제외"/);
  assert.match(pruner, /operation === "create_items"/);
  assert.match(pruner, /operation === "replace_item"/);
  assert.match(pruner, /rewriteProgressLabels/);
});

test("열 드래그 이동과 선택 열까지 고정 범위를 계산한다", () => {
  const moved = moveColumn(DEFAULT_TABLE_COLUMN_ORDER, "options", "modelNumber");
  assert.ok(moved.indexOf("options") < moved.indexOf("modelNumber"));
  assert.equal(moved[0], "select");
  assert.deepEqual(
    frozenColumnKeys(moved, "modelNumber"),
    moved.slice(0, moved.indexOf("modelNumber") + 1),
  );
  assert.deepEqual(frozenColumnKeys(moved, ""), []);
});

test("고정 열은 헤더와 행 중 가장 넓은 폭으로 빈틈 없는 좌표를 만든다", () => {
  const geometry = buildFrozenColumnGeometry([
    { key: "select", widths: [42, 42] },
    { key: "workBatch", widths: [78, 92] },
    { key: "barcode", widths: [120, 240] },
    { key: "modelNumber", widths: [90, 168] },
    { key: "productName", widths: [64, 176] },
  ]);
  assert.deepEqual(geometry, [
    { key: "select", left: 0, width: 42, right: 42 },
    { key: "workBatch", left: 42, width: 92, right: 134 },
    { key: "barcode", left: 134, width: 240, right: 374 },
    { key: "modelNumber", left: 374, width: 168, right: 542 },
    { key: "productName", left: 542, width: 176, right: 718 },
  ]);
});

test("표 옵션 입력은 쉼표 구분·중복 제거 후 기존 가격과 바코드를 순서대로 유지한다", () => {
  const labels = parseInlineOptionLabels("블랙, 화이트\n블랙, 대형");
  assert.deepEqual(labels, ["블랙", "화이트", "대형"]);
  const applied = applyInlineOptionLabels(
    [
      {
        id: "a",
        optionName: "색상",
        saleOption: "기존1",
        barcode: "BAA1-1",
        baseSalePriceKrw: 10000,
        unitCostKrw: 5000,
      },
      {
        id: "b",
        optionName: "색상",
        saleOption: "기존2",
        barcode: "BAA1-2",
        baseSalePriceKrw: 12000,
        unitCostKrw: 6000,
      },
    ],
    labels,
  );
  assert.equal(applied[0].saleOption, "블랙");
  assert.equal(applied[0].barcode, "BAA1-1");
  assert.equal(applied[0].baseSalePriceKrw, 10000);
  assert.equal(applied[1].saleOption, "화이트");
  assert.equal(applied[1].barcode, "BAA1-2");
  assert.equal(applied[2].saleOption, "대형");
  assert.equal(applied[2].barcode, "");
});

test("진행관리 표 UI는 직접입력·열 드래그·열 고정·선택 일괄 불러오기를 포함한다", async () => {
  const source = await readFile(
    new URL(
      "../public/product-launch-tracker-app/table-inline-ops.js",
      import.meta.url,
    ),
    "utf8",
  );
  const loader = await readFile(
    new URL(
      "../public/product-launch-tracker-app/table-inline-ops-loader.js",
      import.meta.url,
    ),
    "utf8",
  );
  const frozenFix = await readFile(
    new URL(
      "../public/product-launch-tracker-app/table-frozen-columns-fix.js",
      import.meta.url,
    ),
    "utf8",
  );
  const app = await readFile(
    new URL("../public/product-launch-tracker-app/app.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /inline-category-editor/);
  assert.match(source, /inline-options-editor/);
  assert.match(source, /column-drag-handle/);
  assert.match(source, /freeze-through-column/);
  assert.match(source, /bulk-china-order-sync-button/);
  assert.match(source, /china-order-options\?/);
  assert.match(source, /TRACKER_STATE_ENDPOINT/);
  assert.match(loader, /safeObserver\.disconnect/);
  assert.match(loader, /dispatchEvent\(new Event\("resize"\)\)/);
  assert.match(frozenFix, /buildFrozenColumnGeometry/);
  assert.match(frozenFix, /cell\.offsetWidth/);
  assert.match(frozenFix, /cell\.style\.minWidth = width/);
  assert.match(frozenFix, /cell\.style\.maxWidth = width/);
  assert.match(frozenFix, /background-clip: border-box !important/);
  assert.match(frozenFix, /tableHead\.style\.zIndex = "100"/);
  assert.match(frozenFix, /row === headRow \? "120" : "20"/);
  assert.match(
    frozenFix,
    /#launch-table-head\s*\{[^}]*z-index: 100 !important/s,
  );
  assert.match(
    frozenFix,
    /#launch-table-head > tr > th\.is-frozen-table-column\s*\{[^}]*z-index: 120 !important/s,
  );
  assert.match(app, /table-inline-ops-loader\.js/);
  assert.match(app, /table-frozen-columns-fix\.js/);
});
