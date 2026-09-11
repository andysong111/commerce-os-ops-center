import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
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
    assert.equal(allowedLiveRequest(`${base}/shopling-stock-state-sync/README.txt`, method), true);
    assert.equal(allowedLiveRequest(`${base}/api/china-order-manager/cycle-status?month=${month}`, method), true);
  }
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) assert.equal(allowedLiveRequest(`${base}/api/china-order-manager/cycle-status?month=${month}`, method), false);
  for (const path of ["/robots.txt", "/api/china-order-manager/receipts/followup", "/api/inventory-stock-control", "/api/china-order-manager/cycle-status", "/api/china-order-manager/cycle-status?month=2026-13", "/api/china-order-manager/cycle-status?month=2026-09&month=2026-08", "/api/china-order-manager/cycle-status?month=2026-09&action=REFRESH_STOCK_EVIDENCE", "/shopling-stock-state-sync/README.txt?redirect=elsewhere"]) assert.equal(allowedLiveRequest(base + path, "GET"), false);
  assert.equal(allowedLiveRequest("https://elsewhere.example/shopling-stock-state-sync/README.txt", "GET"), false);
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

test("ready-for-next-calculation must not certify the next calculation itself as started or completed", () => {
  const ready = readyFixture();
  assert.equal(safeCycleSummary(200, ready, month).businessCycleReady, true);
  for (const invalidState of ["PENDING", "VERIFIED"]) {
    ready.report.stages.find((stage) => stage.id === "next").state = invalidState;
    assert.throws(() => safeCycleSummary(200, ready, month), /LIVE_FALSE_COMPLETION/);
  }
});

test("a genuine no-order close remains distinct from an executed receipt cycle", () => {
  const empty = fixture();
  Object.assign(empty.report, {
    state: "NO_ORDER_CLOSED", nextAction: "OPEN_NEXT_CALCULATION", receivedQuantity: 0,
    verifiedReceiptCount: 0, pendingReceiptCount: 0, missingBaselineCount: 0, warnings: [], followups: [],
  });
  empty.report.stages.forEach((stage) => { stage.state = stage.id === "order" ? "VERIFIED" : "NOT_STARTED"; });
  const summary = safeCycleSummary(200, empty, month);
  assert.equal(summary.readbackVerified, true); assert.equal(summary.businessCycleReady, false);
  assert.equal(summary.actualPurchaseExecuted, false);
});

function readyFixture() {
  const ready = fixture();
  Object.assign(ready.report, {
    state: "READY_FOR_NEXT_CALCULATION", nextAction: "OPEN_NEXT_CALCULATION",
    verifiedReceiptCount: 1, pendingReceiptCount: 0, missingBaselineCount: 0, warnings: [],
    followups: [{ receiptId: "00000000-0000-4000-8000-000000000001", draftId: "fast-purchase-draft:1234567890abcdef1234", state: "VERIFIED", cycleMonth: month, lineCount: 1, barcodes: ["BBA1-1"], receivedQuantity: 7, canRetry: false, errorCode: null, fingerprint: `sha256:${"a".repeat(64)}`, verifiedAt: "2026-09-11T12:00:00.000Z" }],
  });
  ready.report.stages.forEach((stage) => { stage.state = stage.id === "next" ? "NOT_STARTED" : "VERIFIED"; });
  return ready;
}

test("live readiness rejects duplicated, malformed, cross-month and quantity-inconsistent receipt proof", () => {
  for (const patch of [
    { receiptId: undefined }, { receiptId: "malformed" }, { draftId: "other-source" },
    { cycleMonth: "2026-08" }, { receivedQuantity: undefined }, { receivedQuantity: 0 },
    { receivedQuantity: -1 }, { receivedQuantity: 1.5 }, { receivedQuantity: 8 },
    { lineCount: 0 }, { lineCount: 2 }, { barcodes: [] }, { barcodes: ["invalid"] },
    { lineCount: 2, barcodes: ["BBA1-1", "BBA1-1"] }, { canRetry: true },
    { errorCode: "UNVERIFIED" }, { fingerprint: null }, { verifiedAt: "invalid" },
  ]) {
    const body = readyFixture(); Object.assign(body.report.followups[0], patch);
    assert.throws(() => safeCycleSummary(200, body, month), /LIVE_RECEIPT_EVIDENCE_INVALID/);
  }
  const duplicate = readyFixture();
  duplicate.report.followups.push({ ...duplicate.report.followups[0] });
  duplicate.report.verifiedReceiptCount = 2; duplicate.report.receivedQuantity = 14;
  assert.throws(() => safeCycleSummary(200, duplicate, month), /LIVE_RECEIPT_EVIDENCE_INVALID/);
  const valid = readyFixture();
  valid.report.followups.push({ ...valid.report.followups[0], receiptId: "00000000-0000-4000-8000-000000000002" });
  valid.report.verifiedReceiptCount = 2; valid.report.receivedQuantity = 14;
  assert.equal(safeCycleSummary(200, valid, month).businessCycleReady, true);
});


test("no-order closure rejects an inconsistent next action or nonzero inventory baseline obligation", () => {
  const empty = fixture();
  Object.assign(empty.report, {
    state: "NO_ORDER_CLOSED", nextAction: "OPEN_NEXT_CALCULATION", receivedQuantity: 0,
    verifiedReceiptCount: 0, pendingReceiptCount: 0, missingBaselineCount: 0, warnings: [], followups: [],
  });
  empty.report.stages.forEach((stage) => { stage.state = stage.id === "order" ? "VERIFIED" : "NOT_STARTED"; });
  for (const nextAction of ["RECHECK", "OPEN_WORKSPACE", "RETRY_RECEIPT_FOLLOWUP", "REFRESH_STOCK_EVIDENCE", "OPEN_STOCK_CONTROL", "OPEN_PRICE_REVIEW"]) {
    empty.report.nextAction = nextAction;
    assert.throws(() => safeCycleSummary(200, empty, month), /LIVE_FALSE_NO_ORDER/);
  }
  empty.report.nextAction = "OPEN_NEXT_CALCULATION";
  empty.report.missingBaselineCount = 1;
  assert.throws(() => safeCycleSummary(200, empty, month), /LIVE_FALSE_NO_ORDER/);
});

test("production proof is retriggered for report libraries, route, bootstrap and dependency changes", () => {
  const workflow = readFileSync(new URL("../.github/workflows/purchase-cycle-live-readonly.yml", import.meta.url), "utf8");
  const trigger = workflow.split("  workflow_dispatch:")[0];
  for (const path of ["src/lib/**", "src/app/api/china-order-manager/cycle-status/**", "public/shopling-stock-state-sync/README.txt", "package.json", "package-lock.json", "next.config.*", "vercel.json"]) {
    assert.ok(trigger.includes(`- '${path}'`), `live verification must track ${path}`);
  }
  assert.match(trigger, /branches: \[main\]/);
});
