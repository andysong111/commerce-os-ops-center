import assert from "node:assert/strict";
// Owner-authorized readback of the canonical production domain. No secrets,
// no state-changing endpoints, and no production test data insertion.
const origin = "https://commerce-os-ops-center.vercel.app";
const response = await fetch(`${origin}/api/china-order-manager/reentry-shadow`, {
  method: "GET", headers: { accept: "application/json", origin, referer: `${origin}/china-order-manager/reentry-shadow` },
  signal: AbortSignal.timeout(180000),
});
const payload = await response.json();
assert.ok([200, 503].includes(response.status), `unexpected HTTP ${response.status}`);
assert.ok(payload.report, "expected a source-backed read-only report, not an authentication/error page");
const report = payload.report;
assert.equal(report.version, "purchase-reentry-shadow-v1");
assert.equal(report.mode, "SHADOW_READ_ONLY");
assert.equal(report.writesEnabled, false); assert.equal(report.actualPurchaseExecuted, false); assert.equal(report.approvalGranted, false);
assert.equal(report.cashBudgetKrw, null); assert.ok(report.rows.every((row) => row.allocatedQuantity === 0));
assert.ok(report.rows.every((row) => row.candidateQuantity === null || (row.inventoryBasis === "EXACT" && row.issues.length === 0)));
// BLOCKED is a valid safety result, not proof that production recommendations are ready.
// Log the distinction and aggregates only; never dump the user's full product data.
console.log(JSON.stringify({ contractVerified: true, operationalReadiness: report.state, httpStatus: response.status,
  generatedAt: report.generatedAt, targetCycleMonth: report.targetCycleMonth, demandAsOf: report.demandAsOf,
  managedSkuCount: report.managedSkuCount, quarantinedSkuCount: report.quarantinedSkuCount, demandSourceState: report.demandSourceState,
  recovery: report.recovery?.map(({ id, state }) => ({ id, state })),
  summary: report.summary, sourceFingerprint: report.sourceFingerprint, blockerCodes: report.blockers.map((value) => value.code),
  rowIssueCounts: report.rows.flatMap((row) => row.issues).reduce((counts, row) => { counts[row.code] = (counts[row.code] ?? 0) + 1; return counts; }, {}),
  writeRequests: 0, actualPurchaseExecuted: false }, null, 2));
