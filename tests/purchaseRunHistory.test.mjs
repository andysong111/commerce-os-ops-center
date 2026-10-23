import assert from "node:assert/strict";
import test from "node:test";

const { buildPurchaseRunHistory, selectPurchaseRun } = await import(
  new URL("../src/lib/purchaseRunHistory.ts", import.meta.url)
);

const draft = (overrides = {}) => ({
  draftId: "draft-a",
  createdAt: "2026-10-01T00:00:00.000Z",
  cycleStartDate: "2026-10-01",
  previousCycleStartDate: "2026-09-01",
  receiptConfirmedAt: null,
  lineCount: 2,
  requestedQuantity: 20,
  orderedQuantity: 0,
  receivedQuantity: 0,
  cancelledQuantity: 0,
  openQuantity: 20,
  updatedAt: "2026-10-01T00:00:00.000Z",
  ...overrides,
});

test("active run is shown before receipt-confirmed history", () => {
  const rows = buildPurchaseRunHistory([
    draft({
      draftId: "received",
      orderedQuantity: 20,
      receivedQuantity: 20,
      openQuantity: 0,
      receiptConfirmedAt: "2026-10-18T15:01:00.000Z",
    }),
    draft({ draftId: "active", cycleStartDate: "2026-10-23" }),
  ]);
  assert.equal(rows[0].draftId, "active");
  assert.equal(rows[1].state, "RECEIVED");
  assert.equal(rows[1].receiptConfirmedDate, "2026-10-19");
});

test("released draft is not presented as receipt-confirmed", () => {
  const [row] = buildPurchaseRunHistory([
    draft({ requestedQuantity: 0, openQuantity: 0 }),
  ]);
  assert.equal(row.state, "RELEASED");
  assert.equal(row.receiptConfirmedDate, null);
});

test("fully cancelled order is not mislabeled as a receipt confirmation", () => {
  const [row] = buildPurchaseRunHistory([
    draft({ orderedQuantity: 20, cancelledQuantity: 20, openQuantity: 0 }),
  ]);
  assert.equal(row.state, "RELEASED");
  assert.equal(row.receiptConfirmedDate, null);
});

test("requested run is selected and missing id falls back to the first run", () => {
  const rows = buildPurchaseRunHistory([
    draft({ draftId: "older", cycleStartDate: "2026-09-01" }),
    draft({ draftId: "newer", cycleStartDate: "2026-10-01" }),
  ]);
  assert.equal(selectPurchaseRun(rows, "older")?.draftId, "older");
  assert.equal(selectPurchaseRun(rows, "missing")?.draftId, "newer");
});
