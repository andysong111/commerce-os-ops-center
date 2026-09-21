import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [engine, route, panel, page, monthlyPolicy, followup] = await Promise.all([
  readFile("src/lib/internalChinaReceipt.ts", "utf8"),
  readFile("src/app/api/china-order-manager/receipts/route.ts", "utf8"),
  readFile("src/components/china-order-manager/InternalChinaReceiptPanel.tsx", "utf8"),
  readFile("src/app/china-order-manager/page.tsx", "utf8"),
  readFile("src/lib/monthlyPurchasePolicy.ts", "utf8"),
  readFile("src/lib/internalChinaReceiptFollowup.ts", "utf8"),
]);
test("China order manager exposes the calendar-month purchase and receipt cycle", () => {
  assert.ok(monthlyPolicy.includes('PURCHASE_RECOMMENDATION_CADENCE = "MONTHLY"'));
  assert.ok(page.includes("월별 발주·입고 관리")); assert.ok(page.includes("월 처리 단계"));
  assert.ok(page.includes("koreanMonthLabel(selectedMonth)")); assert.ok(page.includes("1688 주문·발주 마감"));
});
test("receipt UI supports full and partial receipt quantities on the existing China order route", () => {
  for (const value of ["입고 처리", "남은 수량 전부 채우기", "PARTIALLY_RECEIVED", "RECEIVED", "/api/china-order-manager/receipts"]) assert.ok(panel.includes(value));
  assert.ok(page.includes("InternalChinaReceiptPanel")); assert.ok(page.includes('title="입고"'));
});
test("receipt engine never receives more than the current open quantity", () => {
  assert.ok(engine.includes("receivedNow > commitment.openQuantity"));
  assert.ok(engine.includes("CHINA_RECEIPT_QUANTITY_EXCEEDED"));
  assert.ok(engine.includes("commitment.receivedQuantity + receivedNow"));
});
test("receipt engine writes ledger status and product purchase cost without the 1.45 forwarder estimate", () => {
  assert.ok(engine.includes('status: finished ? "RECEIVED" : "PARTIALLY_RECEIVED"'));
  // Original cache/canonical delivery invariants now belong to the cost-only
  // follow-up service. Runtime receipt, repeat and failure proofs are retained
  // in internalChinaReceiptFollowup.test.mjs, not replaced by weaker string checks.
  assert.ok(engine.includes("retryInternalChinaReceiptFollowup"));
  assert.ok(followup.includes("mergePriceAdjustmentReceiptCachePage"));
  assert.ok(followup.includes("buildCanonicalProductMasterSnapshot"));
  assert.ok(followup.includes("/api/integrations/internal-receipt-repair"));
  assert.ok(engine.includes("actualUnitCny * draft.exchangeRateKrwPerCny"));
  assert.equal(engine.includes("draft.internalOrderCostMultiplier"), false);
  assert.ok(engine.includes("배송대행지 청구액"));
});
test("receipt API is same-origin protected and reports product purchase cost separately", () => {
  assert.ok(route.includes("isSameOriginOpsRequest")); assert.ok(route.includes("recordInternalChinaReceipt"));
  assert.ok(route.includes("상품 매입원가")); assert.equal(route.includes("내부기준원가"), false);
});


test("receipt UI persists one request identity across a lost response and clears it only after success", () => {
  assert.ok(panel.includes("receiptRequestFingerprint"));
  assert.ok(panel.includes("receiptRequestStorageKey"));
  assert.ok(panel.includes("window.sessionStorage.getItem"));
  assert.ok(panel.includes("crypto.randomUUID()"));
  assert.ok(panel.includes("requestId: receiptRequest.requestId"));
  assert.ok(panel.indexOf("clearPendingReceiptRequest(receiptRequest)") > panel.indexOf("if (!response.ok || body.ok !== true)"));
});

test("receipt engine checks durable request replay before reading mutable open quantities", () => {
  assert.ok(engine.includes("readStoredReceiptReplay"));
  assert.ok(engine.includes("validReceiptRequestId(input.requestId) ?? randomUUID()"));
  assert.ok(engine.indexOf("const storedReplay = await readStoredReceiptReplay") < engine.indexOf("const ledger = await loadChinaOrderLedger()"));
  assert.ok(engine.includes('params.set("result_snapshot->>receiptId", "eq." + requestId)'));
  assert.ok(engine.includes("retryInternalChinaReceiptFollowup(receiptId)"));
});


test("receipt API distinguishes idempotency conflict and replay lookup outage", () => {
  assert.ok(route.includes("CHINA_RECEIPT_REQUEST_ID_INVALID"));
  assert.ok(route.includes("CHINA_RECEIPT_REQUEST_REPLAY_CONFLICT"));
  assert.ok(route.includes("CHINA_RECEIPT_REPLAY_LOOKUP_FAILED"));
  assert.ok(route.includes('code === "CHINA_RECEIPT_REQUEST_REPLAY_CONFLICT"'));
  assert.ok(route.includes("? 409"));
  assert.ok(route.includes("? 503"));
});
