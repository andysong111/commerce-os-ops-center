import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadPurchaseCycleModule as load, receiptId, draftId, barcode, at, stockFixture } from "./helpers/purchaseCycleHarness.mjs";
const core = load("src/lib/purchaseCycleClosureCore.ts");
const evidence = load("src/lib/purchaseCycleStockEvidence.ts");
function input() {
  return { cycleMonth: "2026-09", orderClosed: true, orderCount: 1, unassignedLineCount: 0, orderedQuantity: 7, receivedQuantity: 7, openQuantity: 0, receiptState: "COMPLETE", landedCostState: "COMPLETE", fundingState: "COMPLETE", approvedPriceCheckPending: false, followups: [{ receiptId, draftId, cycleMonth: "2026-09", lineCount: 1, barcodes: [barcode], receivedQuantity: 7, state: "VERIFIED", canRetry: false, errorCode: null, verifiedAt: at, fingerprint: "fixture" }], stock: stockFixture(), warnings: [] };
}
test("complete receipt, cost, current stock and sale evidence permits next calculation but never executes it", () => {
  const report = core.buildPurchaseCycleClosureReport(input());
  assert.equal(report.state, "READY_FOR_NEXT_CALCULATION");
  assert.equal(report.actualPurchaseExecuted, false);
  assert.equal(report.stages.find((stage) => stage.id === "next").state, "NOT_STARTED");
});
test("partial proof, wrong month, duplicated receipt and invalid aggregates cannot falsely close a cycle", () => {
  const values = [];
  let value = input(); value.followups[0].receivedQuantity = 6; values.push(value);
  value = input(); value.followups[0].cycleMonth = "2026-08"; values.push(value);
  value = input(); value.followups.push(value.followups[0]); values.push(value);
  value = input(); value.receivedQuantity = NaN; values.push(value);
  value = input(); value.warnings.push("database read unavailable"); values.push(value);
  for (const item of values) assert.equal(core.buildPurchaseCycleClosureReport(item).state, "BLOCKED");
});
test("next action distinguishes receipt retry, actual partial receipt, baseline and sale-status obligations", () => {
  let value = input(); value.followups[0].state = "PENDING"; value.followups[0].canRetry = true;
  const pending = core.buildPurchaseCycleClosureReport(value);
  assert.equal(pending.nextAction, "RETRY_RECEIPT_FOLLOWUP"); assert.equal(pending.receiptId, receiptId);
  value = input(); value.openQuantity = 3; value.orderedQuantity = 10; value.receiptState = "NEEDS_CHECK";
  assert.equal(core.buildPurchaseCycleClosureReport(value).nextAction, "OPEN_WORKSPACE");
  value = input(); value.stock.rows = [];
  assert.equal(core.buildPurchaseCycleClosureReport(value).missingBaselineCount, 1);
  assert.equal(core.buildPurchaseCycleClosureReport(value).nextAction, "OPEN_STOCK_CONTROL");
  value = input(); value.stock.rows[0].salesCoverageReady = false;
  assert.equal(core.buildPurchaseCycleClosureReport(value).nextAction, "REFRESH_STOCK_EVIDENCE");
  for (const outcome of ["STARTED", "UNCERTAIN", "FAILED"]) {
    value = input(); value.stock.rows[0].latestSyncOutcome = outcome;
    assert.equal(core.buildPurchaseCycleClosureReport(value).nextAction, "OPEN_STOCK_CONTROL");
  }
});
test("missing final cost, prior approved price check and funding remain explicit outstanding steps", () => {
  let value = input(); value.landedCostState = "NEEDS_CHECK";
  assert.match(core.buildPurchaseCycleClosureReport(value).message, /최종 원가/);
  value = input(); value.approvedPriceCheckPending = true;
  assert.equal(core.buildPurchaseCycleClosureReport(value).nextAction, "OPEN_PRICE_REVIEW");
  value = input(); value.fundingState = "NOT_AVAILABLE";
  assert.match(core.buildPurchaseCycleClosureReport(value).message, /자금 마감/);
});
test("zero-order month and December rollover do not manufacture receipt or sale work", () => {
  const value = input(); Object.assign(value, { orderCount: 0, orderedQuantity: 0, receivedQuantity: 0, followups: [] });
  const report = core.buildPurchaseCycleClosureReport(value);
  assert.equal(report.state, "NO_ORDER_CLOSED");
  assert.ok(report.stages.filter((stage) => stage.id !== "order").every((stage) => stage.state === "NOT_STARTED"));
  assert.equal(core.followingPurchaseCycleMonth("2026-12"), "2027-01");
  for (const month of ["2026-00", "2026-13", "2026-1", "2026-09&x=1"]) assert.throws(() => core.followingPurchaseCycleMonth(month));
});
test("source observation coverage, not fresh render time, gates exact inventory", () => {
  const now = Date.parse(at) + 20 * 60_000;
  const fresh = { coverageStartAt: at, coverageEndAt: new Date(now).toISOString() };
  const stale = { ...fresh, coverageEndAt: new Date(now - 600_001).toISOString() };
  const report = stockFixture(); report.generatedAt = new Date(now).toISOString();
  assert.equal(evidence.validatePurchaseCycleStockEvidence(report, new Map(), fresh, now).state, "READY");
  assert.equal(evidence.validatePurchaseCycleStockEvidence(report, new Map(), stale, now).state, "BLOCKED");
  assert.equal(evidence.validatePurchaseCycleStockEvidence(report, new Map(), { ...fresh, coverageEndAt: new Date(now - 600_000).toISOString() }, now).state, "READY");
  const wrongTail = new Map([["reset-1", { ...fresh, resetEventId: "reset-1", resetAt: at, barcode: "BBB9-1" }]]);
  assert.equal(evidence.validatePurchaseCycleStockEvidence(report, wrongTail, undefined, now).state, "BLOCKED");
  wrongTail.get("reset-1").barcode = barcode;
  assert.equal(evidence.validatePurchaseCycleStockEvidence(report, wrongTail, undefined, now).state, "READY");
});
test("duplicate inventory identity, future baseline, invalid quantity and a silent base blocker fail closed", () => {
  const now = Date.parse(at) + 1000;
  const coverage = { coverageStartAt: at, coverageEndAt: new Date(now).toISOString() };
  for (const mutation of [(report) => report.rows.push(report.rows[0]), (report) => { report.rows[0].resetAt = new Date(now + 1000).toISOString(); }, (report) => { report.rows[0].exactInventoryQuantity = -1; }, (report) => { report.state = "BLOCKED"; }]) {
    const report = stockFixture(); mutation(report);
    const result = evidence.validatePurchaseCycleStockEvidence(report, new Map(), coverage, now);
    assert.equal(result.state, "BLOCKED"); assert.ok(result.blockers.length > 0);
  }
});
test("resolved purchase stock passes Product Master zero reset into the canonical inventory engine before stocktake and tail overlays", async () => {
  const steps = []; const report = stockFixture();
  const supplemental = [{ eventId: "pm-zero", barcode: "BAB3-1", productKind: "SINGLE", modelNo: "AAA231", occurredAt: at, note: "fixture" }];
  const service = load("src/lib/purchaseCycleStockReport.ts", {
    "@/lib/inventoryStockControl": { loadInventoryStockControlReport: async (options) => { steps.push("base"); assert.equal(options.supplementalResetEvents.length, 1); assert.equal(options.supplementalResetEvents[0].eventId, "pm-zero"); assert.equal(options.supplementalResetEvents[0].barcode, "BAB3-1"); return report; } },
    "@/lib/inventoryStockResetCorrections": { overlayInventoryStockControlReportWithResetCorrections: async (value) => { steps.push("corrections"); return value; } },
    "@/lib/inventoryStockSalesTail": { overlayInventoryStockControlReportWithTail: async (value) => { steps.push("tail"); return value; }, loadLatestInventoryStockSalesTailSnapshots: async () => new Map() },
    "@/lib/inventoryStockSalesTailCoverage": { ensureExactInventoryStockSalesTailCoverage: async () => { steps.push("refresh"); return { refreshed: false }; } },
    "@/lib/inventoryStocktakeBaselines": { overlayInventoryStockControlReportWithStocktakeBaselines: async (value) => { steps.push("stocktake"); return value; } },
    "@/lib/productMasterVerifiedInventoryBaselines": { loadProductMasterVerifiedZeroResetEvents: async () => { steps.push("product-master-zero"); return supplemental; } },
    "@/lib/inventoryStockSyncResolution": { normalizeRetryableShoplingSyncReportWithEvidence: async (value) => { steps.push("resolution"); return value; } },
    "@/lib/stage8CanonicalSalesEventSnapshot": { loadStage8CanonicalSalesEventSnapshot: async () => ({ state: "READY_READ_ONLY" }) },
    "@/lib/purchaseCycleStockEvidence": { validatePurchaseCycleStockEvidence: (value) => { steps.push("validate"); return value; } },
  });
  await service.loadPurchaseCycleStockReport();
  assert.deepEqual(steps, ["product-master-zero", "base", "stocktake", "tail", "corrections", "stocktake", "resolution", "validate"]);
  steps.length = 0; await service.loadPurchaseCycleStockReport({ refreshSales: true });
  assert.equal(steps.filter((step) => step === "refresh").length, 1);
  const cash = await readFile("src/lib/fastPurchaseCashEnvelope.ts", "utf8");
  assert.ok(cash.includes("loadPurchaseCycleStockReport({ refreshSales: true })"));
  assert.equal(cash.includes("loadInventoryStockControlReport()"), false);
});
test("actual cycle GET stays read-only while POST only opts into evidence refresh with strict input", async () => {
  const calls = [];
  const route = load("src/app/api/china-order-manager/cycle-status/route.ts", {
    "@/lib/opsLoginBypass": { isSameOriginOpsRequest: (request) => request.headers.get("origin") === "https://ops.example" },
    "@/lib/monthlyPurchasePolicy": { seoulCalendarMonth: () => "2026-09" },
    "@/lib/purchaseCycleClosureCore": core,
    "@/lib/purchaseCycleClosure": { loadPurchaseCycleClosure: async (...args) => { calls.push(args); return core.buildPurchaseCycleClosureReport(input()); } },
  });
  const request = (method, suffix = "", body, auth = true) => new Request(`https://ops.example/cycle${suffix}`, { method, headers: auth ? { origin: "https://ops.example" } : {}, ...(method === "POST" ? { body: JSON.stringify(body) } : {}) });
  assert.equal((await route.GET(request("GET", "", null, false))).status, 401);
  assert.equal((await route.GET(request("GET", "?month=2026-09&month=2026-08"))).status, 400);
  assert.equal(calls.length, 0);
  assert.equal((await route.GET(request("GET", "?month=2026-09"))).status, 200);
  assert.deepEqual(calls[0], ["2026-09"]);
  assert.equal((await route.POST(request("POST", "", { month: "2026-09", action: "REFRESH_STOCK_EVIDENCE", quantity: 7 }))).status, 400);
  assert.equal((await route.POST(request("POST", "", { month: "2026-09", action: "REFRESH_STOCK_EVIDENCE" }))).status, 200);
  assert.deepEqual(calls[1], ["2026-09", true]);
});
