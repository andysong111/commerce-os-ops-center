import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_PINNED_EDIT_TABLE_COLUMN_IDS,
  EDIT_TABLE_COLUMNS,
  EDIT_TABLE_TOTAL_WIDTH,
  MAX_PINNED_EDIT_TABLE_COLUMNS,
  getOrderedPinnedColumns,
  getPinnedColumnOffset,
  isLastPinnedColumn,
  normalizePinnedColumnIds,
  togglePinnedColumnId,
} from "../src/lib/freightEditTableColumns.ts";

test("defaults pinned columns to image and itemName", () => {
  assert.deepEqual(DEFAULT_PINNED_EDIT_TABLE_COLUMN_IDS, ["image", "itemName"]);
  assert.deepEqual(normalizePinnedColumnIds("bad"), ["image", "itemName"]);
});

test("removes unknown column ids from saved pinned columns", () => {
  assert.deepEqual(normalizePinnedColumnIds(["image", "removedColumn", "barcode"]), [
    "image",
    "barcode",
  ]);
});

test("orders pinned columns by table order instead of selection order", () => {
  assert.deepEqual(
    getOrderedPinnedColumns(["barcode", "image", "itemName"]).map((column) => column.id),
    ["image", "itemName", "barcode"],
  );
});

test("calculates offsets for image, itemName, barcode, and labelPrintCount", () => {
  const pinnedColumnIds = ["image", "itemName", "barcode", "labelPrintCount"];

  assert.equal(getPinnedColumnOffset("image", pinnedColumnIds), 0);
  assert.equal(getPinnedColumnOffset("itemName", pinnedColumnIds), 88);
  assert.equal(getPinnedColumnOffset("barcode", pinnedColumnIds), 288);
  assert.equal(getPinnedColumnOffset("labelPrintCount", pinnedColumnIds), 488);
});

test("limits pinned columns to five", () => {
  const selected = ["rowNo", "image", "itemName", "optionText", "quantity"];

  assert.equal(selected.length, MAX_PINNED_EDIT_TABLE_COLUMNS);
  assert.deepEqual(togglePinnedColumnId(selected, "barcode"), selected);
  assert.deepEqual(normalizePinnedColumnIds([...selected, "barcode"]), selected);
});

test("toggles off a selected pinned column", () => {
  assert.deepEqual(togglePinnedColumnId(["image", "itemName"], "image"), ["itemName"]);
});

test("detects the last pinned column in table order", () => {
  const pinnedColumnIds = ["barcode", "image", "itemName"];

  assert.equal(isLastPinnedColumn("barcode", pinnedColumnIds), true);
  assert.equal(isLastPinnedColumn("itemName", pinnedColumnIds), false);
});

test("total table width equals sum of column widths", () => {
  assert.equal(
    EDIT_TABLE_TOTAL_WIDTH,
    EDIT_TABLE_COLUMNS.reduce((sum, column) => sum + column.width, 0),
  );
});
