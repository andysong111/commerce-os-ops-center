import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildInternalChinaReceiptWorkspaceLines,
  hasActualOrderForReceiptWorkspace,
  resolveInternalChinaReceiptOrderEvidence,
} from "../src/lib/internalChinaReceiptWorkspace.ts";

const [engine, route, panel, page, monthlyPolicy, followup] = await Promise.all([
  readFile("src/lib/internalChinaReceipt.ts", "utf8"),
  readFile("src/app/api/china-order-manager/receipts/route.ts", "utf8"),
  readFile("src/components/china-order-manager/InternalChinaReceiptPanel.tsx", "utf8"),
  readFile("src/app/china-order-manager/page.tsx", "utf8"),
  readFile("src/lib/monthlyPurchasePolicy.ts", "utf8"),
  readFile("src/lib/internalChinaReceiptFollowup.ts", "utf8"),
]);
test("China order manager exposes the on-demand purchase-run and receipt cycle", () => {
  assert.ok(monthlyPolicy.includes('PURCHASE_RECOMMENDATION_CADENCE = "MONTHLY"'));
  assert.ok(page.includes("발주차시·입고 관리")); assert.ok(page.includes("발주차시 처리 단계"));
  assert.ok(page.includes("selectedRun.receiptConfirmedDate")); assert.ok(page.includes('title="1688 주문"'));
});
test("receipt UI supports full and partial receipt quantities on the existing China order route", () => {
  for (const value of ["입고 처리", "남은 수량 전부 채우기", "PARTIALLY_RECEIVED", "RECEIVED", "/api/china-order-manager/receipts"]) assert.ok(panel.includes(value));
  assert.ok(page.includes("InternalChinaReceiptPanel")); assert.ok(page.includes('title="입고"'));
});
test("stage 4 uses actual ledger order evidence even when the stored Draft snapshot is stale", () => {
  const commitments = [
    {
      barcode: "BBA1-1",
      orderedQuantity: 7,
      receivedQuantity: 2,
      cancelledQuantity: 0,
      committedQuantity: 7,
      openQuantity: 5,
      status: "PARTIALLY_RECEIVED",
    },
  ];
  const evidence = resolveInternalChinaReceiptOrderEvidence({
    cycleMonth: "2026-11",
    commitments,
    purchase: {
      cycleMonth: "2026-11",
      orderCount: 1,
      lineCount: 1,
      actualOrderPaidCny: 14,
      assignedLineCount: 1,
      unassignedLineCount: 0,
      lines: [{
        barcode: "BBA1-1", quantity: 7, goodsPaidCny: 14,
        orderNumber: "673842", supplierLink: "https://detail.1688.com/offer/1.html",
        chinaOption: "검정", assigned: true,
      }],
    },
    barcodeCompletion: {
      cycleMonth: "2026-11",
      itemCount: 1,
      matchedItemCount: 1,
    },
  });
  const staleDraftLines = [
    {
      barcode: "BBA1-1",
      modelNo: "AAA001",
      modelName: "원장 기준 상품",
      saleOption: "검정",
      orderedQuantity: 0,
    },
  ];
  assert.equal(hasActualOrderForReceiptWorkspace(evidence), true);
  assert.deepEqual(
    buildInternalChinaReceiptWorkspaceLines(evidence.lines, staleDraftLines, {}),
    [
      {
        barcode: "BBA1-1",
        modelNo: "AAA001",
        modelName: "원장 기준 상품",
        saleOption: "검정",
        orderedQuantity: 7,
        receivedQuantity: 2,
        openQuantity: 5,
        status: "PARTIALLY_RECEIVED",
      },
    ],
  );
});
test("completed barcode evidence recovers the real legacy paid-order fixture without trusting RESERVED alone", () => {
  const commitments = [
    {
      barcode: "BBA1-1", orderedQuantity: 0, receivedQuantity: 0,
      cancelledQuantity: 0, committedQuantity: 10, openQuantity: 10, status: "RESERVED",
    },
    {
      barcode: "BBB2-1", orderedQuantity: 0, receivedQuantity: 0,
      cancelledQuantity: 0, committedQuantity: 3, openQuantity: 3, status: "RESERVED",
    },
  ];
  const purchase = {
    cycleMonth: "2026-11", orderCount: 2, lineCount: 2,
    actualOrderPaidCny: 42, assignedLineCount: 2, unassignedLineCount: 0,
    lines: [
      { barcode: "BBA1-1", quantity: 5, goodsPaidCny: 10, orderNumber: "673842", supplierLink: "https://detail.1688.com/offer/1.html", chinaOption: "검정", assigned: true },
      { barcode: "BBB2-1", quantity: 8, goodsPaidCny: 32, orderNumber: "", supplierLink: "https://detail.1688.com/offer/2.html", chinaOption: "흰색", assigned: true },
    ],
  };
  const completion = { cycleMonth: "2026-11", itemCount: 2, matchedItemCount: 2 };
  const result = resolveInternalChinaReceiptOrderEvidence({
    cycleMonth: "2026-11", commitments, purchase, barcodeCompletion: completion,
  });
  assert.equal(result.ok, true);
  assert.equal(result.recoveredLegacyLineCount, 2);
  assert.deepEqual(result.lines.map((line) => [line.barcode, line.orderedQuantity, line.openQuantity]), [
    ["BBA1-1", 5, 5],
    ["BBB2-1", 8, 8],
  ]);
  assert.deepEqual(result.lines.map((line) => [line.ledgerOrderedQuantity, line.ledgerCancelledQuantity]), [
    [10, 5],
    [8, 0],
  ]);
  const mismatch = resolveInternalChinaReceiptOrderEvidence({
    cycleMonth: "2026-11",
    commitments: [{ ...commitments[0], receivedQuantity: 6 }],
    purchase: { ...purchase, lineCount: 1, assignedLineCount: 1, lines: [purchase.lines[0]], actualOrderPaidCny: 10 },
    barcodeCompletion: { ...completion, itemCount: 1, matchedItemCount: 1 },
  });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.error, "CHINA_RECEIPT_ACTUAL_ORDER_COMMITMENT_MISMATCH");
  const reservedOnly = resolveInternalChinaReceiptOrderEvidence({
    cycleMonth: "2026-11", commitments, purchase: null, barcodeCompletion: completion,
  });
  assert.equal(reservedOnly.ok, false);
  assert.equal(reservedOnly.error, "CHINA_RECEIPT_ACTUAL_ORDER_EVIDENCE_REQUIRED");
});
test("active receipt and actual-cost steps link to the visible purchase-run input workspace", () => {
  assert.ok(page.includes('id="purchase-run-input-workspace"'));
  assert.ok(page.includes('"#purchase-run-input-workspace"'));
  assert.ok(page.includes('"입고 처리로 이동"'));
  assert.ok(page.includes('"실제비용·원가 입력"'));
  assert.ok(page.includes("resolveInternalChinaReceiptOrderEvidence"));
  assert.ok(page.includes("hasActualOrderForReceiptWorkspace"));
  assert.equal(page.includes(".filter((draft) => draft.orderedQuantity > 0)"), false);
  assert.ok(panel.includes("openLines.length > 0 || !forwarderCost.actualCostKrw"));
});
test("receipt engine never receives more than the current open quantity", () => {
  assert.ok(engine.includes("receivedNow > effectiveOrder.openQuantity"));
  assert.ok(engine.includes("CHINA_RECEIPT_QUANTITY_EXCEEDED"));
  assert.ok(engine.includes("effectiveOrder.receivedQuantity + receivedNow"));
  assert.ok(engine.includes("orderedQuantity: effectiveOrder.ledgerOrderedQuantity"));
  assert.ok(engine.includes("cancelledQuantity: effectiveOrder.ledgerCancelledQuantity"));
});
test("receipt engine writes ledger status and product purchase cost without the 1.45 forwarder estimate", () => {
  assert.ok(engine.includes('status: finished ? "RECEIVED" : "PARTIALLY_RECEIVED"'));
  // Original cache/canonical delivery invariants now belong to the cost-only
  // follow-up service. Runtime receipt, repeat and failure proofs are retained
  // in internalChinaReceiptFollowup.test.mjs, not replaced by weaker string checks.
  assert.ok(engine.includes("retryInternalChinaReceiptFollowup"));
  assert.ok(followup.includes("mergePriceAdjustmentReceiptCachePage"));
  assert.ok(followup.includes("buildProductMasterSnapshotFromTrackerState"));
  assert.ok(followup.includes("items: costs.map"));
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
