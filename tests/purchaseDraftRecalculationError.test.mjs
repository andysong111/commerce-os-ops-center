import assert from "node:assert/strict";
import test from "node:test";

const { parsePurchaseDraftRecalculationError } = await import(
  new URL("../src/lib/purchaseDraftRecalculationError.ts", import.meta.url)
);

test("saved-input recalculation failures expose the real nested cause and saved counts", () => {
  assert.deepEqual(
    parsePurchaseDraftRecalculationError(
      "PURCHASE_DRAFT_RECALCULATION_FAILED_AFTER_INPUT_SAVE:6:1:PURCHASE_DRAFT_REPLACEMENT_SOURCE_REVIEW_REQUIRED",
    ),
    {
      code: "PURCHASE_DRAFT_REPLACEMENT_SOURCE_REVIEW_REQUIRED",
      inputsSaved: true,
      savedStockBandCount: 6,
      savedDiscontinuationCount: 1,
    },
  );
});

test("ordinary recalculation failures remain unchanged", () => {
  assert.deepEqual(
    parsePurchaseDraftRecalculationError("FAST_PURCHASE_MONTHLY_CYCLE_CLOSED:detail"),
    {
      code: "FAST_PURCHASE_MONTHLY_CYCLE_CLOSED",
      inputsSaved: false,
      savedStockBandCount: 0,
      savedDiscontinuationCount: 0,
    },
  );
});
