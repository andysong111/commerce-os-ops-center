import assert from "node:assert/strict";
import test from "node:test";

const {
  buildPurchaseRunCycleBasis,
  inferPurchaseRunCycleBasis,
  isPurchaseRunCycleBasis,
} = await import(new URL("../src/lib/purchaseRunCycle.ts", import.meta.url));

const draft = (overrides = {}) => ({
  draftId: "fast-purchase-draft:11111111111111111111",
  createdAt: "2026-09-20T01:00:00.000Z",
  cycleStartDate: null,
  previousCycleStartDate: null,
  cycleKey: null,
  receiptConfirmedAt: null,
  orderedQuantity: 10,
  receivedQuantity: 0,
  openQuantity: 10,
  ...overrides,
});

test("on-demand cycle uses previous purchase start through the day before this start", () => {
  const result = buildPurchaseRunCycleBasis({
    previousCycleStartDate: "2026-09-20",
    cycleStartDate: "2026-10-23",
  });
  assert.deepEqual(result, {
    mode: "ON_DEMAND",
    cycleKey: "purchase-run:2026-09-20:2026-10-23",
    cycleStartDate: "2026-10-23",
    previousCycleStartDate: "2026-09-20",
    revenueRangeStartDate: "2026-09-20",
    revenueRangeEndDate: "2026-10-22",
    bootstrap: false,
  });
  assert.equal(isPurchaseRunCycleBasis(result), true);
});

test("recalculating a draft keeps its original cycle boundaries", () => {
  const result = inferPurchaseRunCycleBasis({
    targetDate: "2026-10-25",
    replaceDraftId: "fast-purchase-draft:22222222222222222222",
    drafts: [
      draft(),
      draft({
        draftId: "fast-purchase-draft:22222222222222222222",
        createdAt: "2026-10-23T03:00:00.000Z",
        cycleStartDate: "2026-10-23",
        previousCycleStartDate: "2026-09-20",
        cycleKey: "purchase-run:2026-09-20:2026-10-23",
        orderedQuantity: 0,
      }),
    ],
  });
  assert.equal(result.cycleStartDate, "2026-10-23");
  assert.equal(result.previousCycleStartDate, "2026-09-20");
  assert.equal(result.bootstrap, false);
});

test("starting a new run uses the day after the latest receipt-confirmed run start", () => {
  const result = inferPurchaseRunCycleBasis({
    targetDate: "2026-10-26",
    replaceDraftId: "fast-purchase-draft:33333333333333333333",
    startNewRun: true,
    drafts: [
      draft({
        draftId: "fast-purchase-draft:22222222222222222222",
        cycleStartDate: "2026-10-05",
        orderedQuantity: 10,
        receivedQuantity: 10,
        openQuantity: 0,
        receiptConfirmedAt: "2026-10-18T08:30:00.000Z",
      }),
      draft({
        draftId: "fast-purchase-draft:33333333333333333333",
        createdAt: "2026-10-23T03:00:00.000Z",
        cycleStartDate: "2026-10-23",
        previousCycleStartDate: "2026-09-20",
        orderedQuantity: 0,
        receivedQuantity: 0,
        openQuantity: 20,
      }),
    ],
  });

  assert.equal(result.cycleStartDate, "2026-10-26");
  assert.equal(result.previousCycleStartDate, "2026-10-06");
  assert.equal(result.revenueRangeStartDate, "2026-10-06");
  assert.equal(result.revenueRangeEndDate, "2026-10-25");
  assert.equal(result.bootstrap, false);
});

test("a replacement cannot be relabeled as a new run without a later start date", () => {
  assert.throws(
    () => inferPurchaseRunCycleBasis({
      targetDate: "2026-10-23",
      replaceDraftId: "fast-purchase-draft:33333333333333333333",
      startNewRun: true,
      drafts: [draft({
        draftId: "fast-purchase-draft:33333333333333333333",
        cycleStartDate: "2026-10-23",
        orderedQuantity: 0,
      })],
    }),
    /PURCHASE_RUN_CYCLE_NEW_RUN_DATE_INVALID/,
  );
});

test("new cycle starts the day after the prior receipt-confirmed calculation start", () => {
  const result = inferPurchaseRunCycleBasis({
    targetDate: "2026-10-23",
    drafts: [
      draft({ createdAt: "2026-08-10T01:00:00.000Z" }),
      draft({
        draftId: "fast-purchase-draft:33333333333333333333",
        createdAt: "2026-10-05T01:00:00.000Z",
        receiptConfirmedAt: "2026-10-18T08:30:00.000Z",
        receivedQuantity: 10,
        openQuantity: 0,
      }),
    ],
  });
  assert.equal(result.previousCycleStartDate, "2026-10-06");
  assert.equal(result.revenueRangeStartDate, "2026-10-06");
  assert.equal(result.revenueRangeEndDate, "2026-10-22");
  assert.equal(result.bootstrap, false);
});

test("ordered-only and abandoned drafts never advance the next sales boundary", () => {
  const result = inferPurchaseRunCycleBasis({
    targetDate: "2026-10-25",
    drafts: [
      draft({
        draftId: "fast-purchase-draft:22222222222222222222",
        createdAt: "2026-10-05T01:00:00.000Z",
        cycleStartDate: "2026-10-05",
        orderedQuantity: 10,
      }),
      draft({
        draftId: "fast-purchase-draft:33333333333333333333",
        createdAt: "2026-10-23T01:00:00.000Z",
        cycleStartDate: "2026-10-23",
        orderedQuantity: 0,
        receivedQuantity: 0,
        openQuantity: 20,
      }),
    ],
  });

  assert.equal(result.previousCycleStartDate, "2026-09-25");
  assert.equal(result.revenueRangeStartDate, "2026-09-25");
  assert.equal(result.revenueRangeEndDate, "2026-10-24");
  assert.equal(result.bootstrap, true);
});

test("unfinished receipt does not become the next cycle boundary", () => {
  const result = inferPurchaseRunCycleBasis({
    targetDate: "2026-10-23",
    drafts: [
      draft({
        cycleStartDate: "2026-10-05",
        receiptConfirmedAt: "2026-10-20T08:30:00.000Z",
        receivedQuantity: 5,
        openQuantity: 5,
      }),
    ],
  });
  assert.equal(result.previousCycleStartDate, "2026-09-23");
  assert.equal(result.bootstrap, true);
});

test("first on-demand cycle uses an explicit visible 30-day bootstrap", () => {
  const result = inferPurchaseRunCycleBasis({ targetDate: "2026-10-23", drafts: [] });
  assert.equal(result.previousCycleStartDate, "2026-09-23");
  assert.equal(result.revenueRangeEndDate, "2026-10-22");
  assert.equal(result.bootstrap, true);
});

test("same-day boundaries are rejected instead of inventing zero demand", () => {
  assert.throws(
    () => buildPurchaseRunCycleBasis({ previousCycleStartDate: "2026-10-23", cycleStartDate: "2026-10-23" }),
    /PURCHASE_RUN_CYCLE_RANGE_EMPTY/,
  );
});
