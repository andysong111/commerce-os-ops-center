import assert from "node:assert/strict";
import test from "node:test";
import { allowedLiveRequest, safeCycleSummary, waitForProduction } from "../scripts/verify-purchase-cycle-live-readonly.mjs";

const month = "2026-09";
function fixture() {
  return { ok: true, report: {
    cycleMonth: month, actualPurchaseExecuted: false, state: "NEEDS_ACTION", nextAction: "OPEN_STOCK_CONTROL",
    stages: ["order", "receipt", "master", "inventory", "sale", "cost", "funding", "next"].map((id) => ({ id, state: "PENDING" })),
    receivedQuantity: 7, openQuantity: 0, verifiedReceiptCount: 0, pendingReceiptCount: 1, missingBaselineCount: 1,
    followups: [{ state: "PENDING", receiptId: "private-receipt-id", barcode: "private-barcode", unitCost: 12345 }],
    warnings: ["private upstream message"], message: "private operator data",
  } };
}

test("production browser allowlist admits only the bootstrap and exact read-only monthly status route", () => {
  const base = "https://commerce-os-ops-center.vercel.app";
  for (const method of ["GET", "HEAD"]) {
    assert.equal(allowedLiveRequest(`${base}/robots.txt`, method), true);
    assert.equal(allowedLiveRequest(`${base}/api/china-order-manager/cycle-status?month=${month}`, method), true);
  }
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) assert.equal(allowedLiveRequest(`${base}/api/china-order-manager/cycle-status?month=${month}`, method), false);
  for (const path of ["/api/china-order-manager/receipts/followup", "/api/inventory-stock-control", "/api/china-order-manager/cycle-status", "/api/china-order-manager/cycle-status?month=2026-13", "/api/china-order-manager/cycle-status?month=2026-09&month=2026-08", "/api/china-order-manager/cycle-status?month=2026-09&action=REFRESH_STOCK_EVIDENCE", "/robots.txt?redirect=elsewhere"]) assert.equal(allowedLiveRequest(base + path, "GET"), false);
  assert.equal(allowedLiveRequest("https://elsewhere.example/robots.txt", "GET"), false);
  assert.equal(allowedLiveRequest("not-a-url", "GET"), false);
});

test("valid blocked business state is reported honestly without publishing raw operational data", () => {
  const summary = safeCycleSummary(200, fixture(), month);
  assert.equal(summary.readbackVerified, true); assert.equal(summary.businessCycleReady, false);
  assert.equal(summary.hasPendingReceipts, true); assert.equal(summary.hasMissingInventoryBaseline, true);
  assert.doesNotMatch(JSON.stringify(summary), /private|12345|receivedQuantity|receiptId/);
});

test("401, wrong month, malformed stages and false completion never pass the live evidence check", () => {
  assert.throws(() => safeCycleSummary(401, fixture(), month), /LIVE_HTTP_401/);
  assert.throws(() => safeCycleSummary(200, fixture(), "2026-08"), /LIVE_REPORT_INVALID/);
  const duplicate = fixture(); duplicate.report.stages[0].id = "next";
  assert.throws(() => safeCycleSummary(200, duplicate, month), /LIVE_STAGES_INVALID/);
  const falseReady = fixture(); falseReady.report.state = "READY_FOR_NEXT_CALCULATION";
  assert.throws(() => safeCycleSummary(200, falseReady, month), /LIVE_FALSE_COMPLETION/);
  const falseEmpty = fixture(); falseEmpty.report.state = "NO_ORDER_CLOSED";
  assert.throws(() => safeCycleSummary(200, falseEmpty, month), /LIVE_FALSE_NO_ORDER/);
});

test("deployment waiter uses exact SHA, a fixed read endpoint and waits for successful Vercel status", async () => {
  const sha = "a".repeat(40); let calls = 0, pauses = 0, heads = 0;
  await waitForProduction(sha, "fixture-token", async (url, options) => {
    if (url.endsWith("/git/ref/heads/main")) {
      heads++; return Response.json({ object: { sha } });
    }
    assert.equal(url, `https://api.github.com/repos/andysong111/commerce-os-ops-center/commits/${sha}/status`);
    assert.equal(options.redirect, "error"); assert.equal(options.method || "GET", "GET");
    calls++; return Response.json({ statuses: [{ context: "Vercel", state: calls === 1 ? "pending" : "success" }] });
  }, async () => { pauses++; });
  assert.equal(calls, 2); assert.equal(pauses, 1); assert.equal(heads, 1);
  await assert.rejects(waitForProduction(sha, "fixture-token", async (url) => Response.json(url.endsWith("/git/ref/heads/main") ? { object: { sha: "b".repeat(40) } } : { statuses: [{ context: "Vercel", state: "success" }] })), /LIVE_DEPLOYMENT_SUPERSEDED/);
  await assert.rejects(waitForProduction("bad", "fixture-token", async () => { throw new Error("must not fetch"); }), /LIVE_DEPLOYMENT_CONTEXT_REQUIRED/);
  await assert.rejects(waitForProduction(sha, "fixture-token", async () => Response.json({ statuses: [{ context: "Vercel", state: "failure" }] })), /LIVE_DEPLOYMENT_FAILED/);
});
