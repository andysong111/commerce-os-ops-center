// Exercises the existing operational closure calculator, not a replacement
// simulator. These fixtures are never persisted or sent to any purchase API.
import test from "node:test";
import assert from "node:assert/strict";
import { buildPurchaseCycleClosureReport } from "../src/lib/purchaseCycleClosureCore.ts";

const fixture = () => ({
  cycleMonth: "2026-10", orderClosed: true, orderCount: 1, unassignedLineCount: 0,
  orderedQuantity: 5, receivedQuantity: 5, openQuantity: 0,
  receiptState: "COMPLETE", landedCostState: "COMPLETE", fundingState: "COMPLETE",
  approvedPriceCheckPending: false, warnings: [],
  followups: [{ receiptId: "simulation-receipt-1", cycleMonth: "2026-10", receivedQuantity: 5,
    lineCount: 1, barcodes: ["BAA1-1"], state: "VERIFIED", canRetry: false }],
  stock: { state: "READY", rows: [{ barcode: "BAA1-1", salesCoverageReady: true,
    exactInventoryQuantity: 7, syncNeeded: false, syncBlocked: false, latestSyncOutcome: "SUCCEEDED" }] },
});
const verify = input => {
  const original = structuredClone(input);
  const result = buildPurchaseCycleClosureReport(input);
  assert.deepEqual(input, original);
  assert.equal(result.actualPurchaseExecuted, false);
  return result;
};

test("October canary rehearsal follows order -> partial receipt -> master -> stock -> costs -> funding", () => {
  const input = fixture();
  input.orderClosed = false;
  assert.equal(verify(input).nextAction, "OPEN_WORKSPACE");
  input.orderClosed = true; input.receivedQuantity = 2; input.openQuantity = 3;
  input.followups[0].receivedQuantity = 2; input.receiptState = "PARTIAL";
  assert.equal(verify(input).state, "NEEDS_ACTION");
  input.receivedQuantity = 5; input.openQuantity = 0; input.followups[0].receivedQuantity = 5; input.receiptState = "COMPLETE";
  input.followups[0].state = "PENDING"; input.followups[0].canRetry = true;
  assert.equal(verify(input).nextAction, "RETRY_RECEIPT_FOLLOWUP");
  input.followups[0].state = "VERIFIED"; input.stock.rows[0].salesCoverageReady = false;
  assert.equal(verify(input).nextAction, "REFRESH_STOCK_EVIDENCE");
  input.stock.rows[0].salesCoverageReady = true; input.stock.rows[0].syncNeeded = true;
  assert.equal(verify(input).nextAction, "OPEN_STOCK_CONTROL");
  input.stock.rows[0].syncNeeded = false; input.landedCostState = "PENDING";
  assert.equal(verify(input).state, "NEEDS_ACTION");
  input.landedCostState = "COMPLETE"; input.fundingState = "PENDING";
  assert.equal(verify(input).state, "NEEDS_ACTION");
  input.fundingState = "COMPLETE";
  assert.equal(verify(input).state, "READY_FOR_NEXT_CALCULATION");
});
test("re-reading a receipt never adds the quantity again", () => {
  const input = fixture(); const one = verify(input); const two = verify(input);
  assert.equal(one.receivedQuantity, 5); assert.equal(two.receivedQuantity, 5);
  assert.equal(two.verifiedReceiptCount, 1);
});
test("duplicate receipt identity is not counted twice", () => {
  const input = fixture(); input.followups.push({ ...input.followups[0] });
  assert.equal(verify(input).state, "BLOCKED");
});
test("wrong cycle receipt cannot complete the October cycle", () => {
  const input = fixture(); input.followups[0].cycleMonth = "2026-09";
  assert.equal(verify(input).state, "BLOCKED");
});
test("receipt sums inconsistent with source ledger block completion", () => {
  const input = fixture(); input.followups[0].receivedQuantity = 4;
  assert.equal(verify(input).state, "BLOCKED");
});
test("unassigned order line remains an explicit action, not a completed cycle", () => {
  const input = fixture(); input.unassignedLineCount = 1;
  assert.equal(verify(input).state, "NEEDS_ACTION");
});
test("duplicate baseline blocks exact inventory confirmation", () => {
  const input = fixture(); input.stock.rows.push({ ...input.stock.rows[0] });
  assert.equal(verify(input).state, "BLOCKED");
});
test("missing baseline retains accumulation policy rather than forcing a whole-warehouse count", () => {
  const input = fixture(); input.stock.rows = [];
  const result = verify(input);
  assert.equal(result.missingBaselineCount, 1);
  assert.equal(result.state, "READY_FOR_NEXT_CALCULATION");
  assert.match(result.message, /추정재고|축적/);
});
test("approved price change readback stays pending without inventing a new price action", () => {
  const input = fixture(); input.approvedPriceCheckPending = true;
  assert.equal(verify(input).nextAction, "OPEN_PRICE_REVIEW");
});
test("month closed with no order is not presented as an actual completed order", () => {
  const input = fixture();
  Object.assign(input, { orderCount: 0, orderedQuantity: 0, receivedQuantity: 0, openQuantity: 0, followups: [] });
  const result = verify(input);
  assert.equal(result.state, "NO_ORDER_CLOSED");
  assert.ok(result.stages.filter(row => row.id !== "order").every(row => row.state === "NOT_STARTED"));
});
test("failed source read blocks cycle closure even when downstream flags look complete", () => {
  const input = fixture(); input.warnings = ["SIMULATED_SOURCE_FAILURE"];
  assert.equal(verify(input).state, "BLOCKED");
});
