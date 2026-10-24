import assert from "node:assert/strict";
import test from "node:test";

const {
  replaceablePriorPurchaseRun,
  sameDayPurchaseRun,
} = await import(new URL("../src/lib/purchaseRunStartPolicy.ts", import.meta.url));

const draft = (overrides = {}) => ({
  draftId: "fast-purchase-draft:11111111111111111111",
  cycleStartDate: "2026-10-23",
  createdAt: "2026-10-23T01:00:00.000Z",
  updatedAt: "2026-10-23T01:00:00.000Z",
  orderedQuantity: 0,
  receivedQuantity: 0,
  openQuantity: 10,
  ...overrides,
});

test("same-day start reuses the existing active draft", () => {
  assert.equal(
    sameDayPurchaseRun([draft()], "2026-10-23")?.draftId,
    "fast-purchase-draft:11111111111111111111",
  );
});

test("a later start replaces only an older unordered draft", () => {
  const unordered = draft();
  const ordered = draft({
    draftId: "fast-purchase-draft:22222222222222222222",
    cycleStartDate: "2026-10-22",
    orderedQuantity: 5,
    openQuantity: 5,
  });
  assert.equal(
    replaceablePriorPurchaseRun([ordered, unordered], "2026-10-24")?.draftId,
    unordered.draftId,
  );
});

test("an ordered in-transit run is preserved when a new run starts", () => {
  assert.equal(
    replaceablePriorPurchaseRun([
      draft({ orderedQuantity: 5, openQuantity: 5 }),
    ], "2026-10-24"),
    null,
  );
});
