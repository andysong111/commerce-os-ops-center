import assert from "node:assert/strict";
import test from "node:test";

import {
  SHOPLING_CANONICAL_SALES_SOURCE,
  buildShoplingIncrementalReconcilePlan,
  buildShoplingIncrementalWindow,
  exactShoplingIncrementalSales,
} from "../src/lib/productMasterShoplingSalesIncrementalEngine.ts";

const planning = [
  { skuId: "sku-a", barcode: "BAA1-1", skuActive: true },
  { skuId: "sku-b", barcode: "BAA1-2", skuActive: true },
];

function sales(barcode, month, quantity, revenue = quantity * 100) {
  return {
    id: `shopling-sales-v1:${barcode}:${month}`,
    barcode,
    month,
    quantity,
    revenue,
    lastSaleAt: `${month}-20T10:00:00.000Z`,
    source: SHOPLING_CANONICAL_SALES_SOURCE,
  };
}

function existing(skuId, barcode, month, quantity, revenue = quantity * 100) {
  return {
    id: `shopling-sales-v1:${barcode}:${month}`,
    skuId,
    month,
    quantity,
    revenue,
    lastSaleAt: `${month}-20T10:00:00.000Z`,
    source: SHOPLING_CANONICAL_SALES_SOURCE,
    syncedAt: null,
  };
}

test("incremental window always begins on a month boundary and includes current month", () => {
  const window = buildShoplingIncrementalWindow(
    new Date("2026-08-07T12:00:00.000Z"),
    3,
  );
  assert.deepEqual(window, {
    startDate: "2026-05-01",
    endDate: "2026-08-07",
    months: ["2026-05", "2026-06", "2026-07", "2026-08"],
  });
});

test("same canonical row may be updated when quantity changed", () => {
  const plan = buildShoplingIncrementalReconcilePlan({
    freshRows: [sales("BAA1-1", "2026-08", 8)],
    existingRows: [existing("sku-a", "BAA1-1", "2026-08", 5)],
    planningRows: planning,
    months: ["2026-08"],
  });
  assert.equal(plan.blockers.length, 0);
  assert.equal(plan.freshRows.length, 1);
  assert.equal(plan.writeRows[0].quantity, 8);
});

test("existing canonical month that disappears from fresh result is zeroed", () => {
  const plan = buildShoplingIncrementalReconcilePlan({
    freshRows: [],
    existingRows: [existing("sku-a", "BAA1-1", "2026-08", 5)],
    planningRows: planning,
    months: ["2026-08"],
  });
  assert.equal(plan.blockers.length, 0);
  assert.deepEqual(plan.zeroRows, [
    {
      id: "shopling-sales-v1:BAA1-1:2026-08",
      barcode: "BAA1-1",
      skuId: "sku-a",
      month: "2026-08",
      quantity: 0,
      revenue: 0,
      lastSaleAt: null,
      source: SHOPLING_CANONICAL_SALES_SOURCE,
    },
  ]);
});

test("a renamed B-code updates the existing natural-key row without submitting a duplicate SKU-month", () => {
  const plan = buildShoplingIncrementalReconcilePlan({
    freshRows: [sales("BAA1-1", "2026-08", 8)],
    existingRows: [
      {
        ...existing("sku-a", "BAA9-9", "2026-08", 5),
        id: "shopling-sales-v1:BAA9-9:2026-08",
      },
    ],
    planningRows: planning,
    months: ["2026-08"],
  });
  assert.equal(plan.blockers.length, 0);
  assert.equal(plan.writeRows.length, 1);
  assert.equal(plan.zeroRows.length, 0);
  assert.deepEqual(
    plan.writeRows.map((row) => [row.id, row.quantity]),
    [["shopling-sales-v1:BAA9-9:2026-08", 8]],
  );
});

test("a renamed B-code still blocks when the preferred deterministic id belongs to another SKU", () => {
  const plan = buildShoplingIncrementalReconcilePlan({
    freshRows: [sales("BAA1-1", "2026-08", 8)],
    existingRows: [
      {
        ...existing("sku-a", "BAA9-9", "2026-08", 5),
        id: "shopling-sales-v1:BAA9-9:2026-08",
      },
      existing("sku-b", "BAA1-1", "2026-08", 3),
    ],
    planningRows: planning,
    months: ["2026-08"],
  });
  assert.equal(plan.writeRows.length, 0);
  assert.equal(plan.blockers[0].code, "TARGET_ROW_CONFLICT");
});

test("an unrecognized legacy row id still blocks automatic correction", () => {
  const plan = buildShoplingIncrementalReconcilePlan({
    freshRows: [],
    existingRows: [
      {
        ...existing("sku-a", "BAA1-1", "2026-08", 5),
        id: "unknown-row-id",
      },
    ],
    planningRows: planning,
    months: ["2026-08"],
  });
  assert.equal(plan.zeroRows.length, 0);
  assert.equal(plan.blockers[0].code, "TARGET_ROW_CONFLICT");
});

test("does not zero rows outside the rolling months", () => {
  const plan = buildShoplingIncrementalReconcilePlan({
    freshRows: [],
    existingRows: [existing("sku-a", "BAA1-1", "2026-04", 12)],
    planningRows: planning,
    months: ["2026-05", "2026-06", "2026-07", "2026-08"],
  });
  assert.equal(plan.zeroRows.length, 0);
  assert.equal(plan.writeRows.length, 0);
});

test("blocks another source with positive sales in same sku-month", () => {
  const plan = buildShoplingIncrementalReconcilePlan({
    freshRows: [sales("BAA1-1", "2026-08", 8)],
    existingRows: [
      {
        id: "legacy:sku-a:2026-08",
        skuId: "sku-a",
        month: "2026-08",
        quantity: 3,
        revenue: 300,
        lastSaleAt: null,
        source: "legacy",
      },
    ],
    planningRows: planning,
    months: ["2026-08"],
  });
  assert.equal(plan.writeRows.length, 0);
  assert.equal(plan.blockers[0].code, "LEGACY_MONTH_OVERLAP");
});

test("blocks canonical id that points at a different sku", () => {
  const plan = buildShoplingIncrementalReconcilePlan({
    freshRows: [sales("BAA1-1", "2026-08", 8)],
    existingRows: [
      {
        ...existing("sku-b", "BAA1-1", "2026-08", 5),
      },
    ],
    planningRows: planning,
    months: ["2026-08"],
  });
  assert.equal(plan.writeRows.length, 0);
  assert.equal(plan.blockers[0].code, "TARGET_ROW_CONFLICT");
});

test("blocks fresh row whose barcode is no longer a current sku", () => {
  const plan = buildShoplingIncrementalReconcilePlan({
    freshRows: [sales("ZZZ9-9", "2026-08", 8)],
    existingRows: [],
    planningRows: planning,
    months: ["2026-08"],
  });
  assert.equal(plan.writeRows.length, 0);
  assert.equal(plan.blockers[0].code, "SKU_NOT_CURRENT");
});

test("blocks an implausible rolling collapse before zeroing a large canonical ledger", () => {
  const plan = buildShoplingIncrementalReconcilePlan({
    freshRows: [sales("BAA1-1", "2026-08", 10)],
    existingRows: [existing("sku-a", "BAA1-1", "2026-08", 100)],
    planningRows: planning,
    months: ["2026-08"],
  });
  assert.equal(
    plan.blockers.some((blocker) => blocker.code === "UNEXPECTED_ROLLING_DROP"),
    true,
  );
});

test("does not block normal rolling corrections below the collapse threshold", () => {
  const plan = buildShoplingIncrementalReconcilePlan({
    freshRows: [sales("BAA1-1", "2026-08", 70)],
    existingRows: [existing("sku-a", "BAA1-1", "2026-08", 100)],
    planningRows: planning,
    months: ["2026-08"],
  });
  assert.equal(
    plan.blockers.some((blocker) => blocker.code === "UNEXPECTED_ROLLING_DROP"),
    false,
  );
});

test("verification compares full canonical values", () => {
  const expected = {
    ...sales("BAA1-1", "2026-08", 8),
    skuId: "sku-a",
  };
  assert.equal(
    exactShoplingIncrementalSales(expected, {
      ...existing("sku-a", "BAA1-1", "2026-08", 8),
    }),
    true,
  );
  assert.equal(
    exactShoplingIncrementalSales(expected, {
      ...existing("sku-a", "BAA1-1", "2026-08", 7),
    }),
    false,
  );
});


test("verification treats equivalent timestamptz representations as the same instant", () => {
  const expected = {
    ...sales("BAA1-1", "2026-08", 8),
    skuId: "sku-a",
    lastSaleAt: "2026-08-20T10:00:00.000Z",
  };
  const actual = {
    ...existing("sku-a", "BAA1-1", "2026-08", 8),
    lastSaleAt: "2026-08-20T10:00:00+00:00",
  };
  assert.equal(exactShoplingIncrementalSales(expected, actual), true);
});

test("verification still rejects a genuinely different sale timestamp", () => {
  const expected = {
    ...sales("BAA1-1", "2026-08", 8),
    skuId: "sku-a",
    lastSaleAt: "2026-08-20T10:00:00.000Z",
  };
  const actual = {
    ...existing("sku-a", "BAA1-1", "2026-08", 8),
    lastSaleAt: "2026-08-20T10:00:01+00:00",
  };
  assert.equal(exactShoplingIncrementalSales(expected, actual), false);
});
