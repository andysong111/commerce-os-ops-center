import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { create1688ImportedPaymentEvidence, create1688PaymentEvidence, create1688SettledPaymentEvidence, INTERNAL_CHINA_PAYMENT_SOURCE_PREFIX, read1688PaymentEvidence } from "../src/lib/internalChinaPaymentEvidence.ts";
import { purchaseBudgetCarryoverBasis, reconcilePurchaseSpendEvidence } from "../src/lib/purchaseCyclePreflightSpendCore.ts";
import { worldFirstFeeAtInternalFx } from "../src/lib/productDecisionEngine/purchaseCostPolicy.ts";
import { loadPurchaseCycleModule } from "./helpers/purchaseCycleHarness.mjs";

const draftId = "fast-purchase-draft:1234567890abcdef1234";
const cycleMonth = "2026-11";
const barcodeEvidenceHash = `sha256:${"a".repeat(64)}`;
const originalRows = "123456789012345678,BBA1-1,12,100.00,-2.50,0.20\n123456789012345679\tBBA1-1\t3\t25.00\t4.50\t0.00";
const expected = [
  { orderNo: "123456789012345678", barcode: "BBA1-1", quantity: 9 },
  { orderNo: "123456789012345678", barcode: "BBA1-1", quantity: 3 },
  { orderNo: "123456789012345679", barcode: "BBA1-1", quantity: 3 },
];
const input = { draftId, cycleMonth, barcodeEvidenceHash, originalRows, grandTotalCny: "127.20", expected };
const completion = {
  operation_type: "INTERNAL_CHINA_FREIGHT_BARCODE_COMPLETE",
  result_snapshot: { draftId, cycleMonth, evidenceHash: barcodeEvidenceHash },
};
const prep = {
  source_event_id: `prep:${draftId}`,
  result_snapshot: { snapshot: { draftId, cycleMonth, status: "DRAFT", externalOrderExecuted: false } },
};
const sourceEventId = INTERNAL_CHINA_PAYMENT_SOURCE_PREFIX + draftId;

test("paid import excludes cancelled old orders and verifies the replacement by its barcode order number", () => {
  const paidOrders = [
    { orderNo: "123456789012345677", status: "CANCELLED" },
    { orderNo: "123456789012345678", status: "PAID", paidTotalCny: "97.70" },
    { orderNo: "123456789012345679", status: "PAID", paidTotalCny: "29.50" },
  ];
  assert.deepEqual(create1688ImportedPaymentEvidence(input, paidOrders), create1688PaymentEvidence(input));
  assert.throws(
    () => create1688ImportedPaymentEvidence(input, [
      { ...paidOrders[1], status: "CANCELLED" },
      paidOrders[2],
      { ...paidOrders[1], orderNo: "123456789012345677" },
    ]),
    /PAYMENT_PAID_ORDER_NOT_SETTLED:123456789012345678/,
  );
  assert.throws(
    () => create1688ImportedPaymentEvidence(input, paidOrders.slice(0, 2)),
    /PAYMENT_PAID_ORDER_MISSING:123456789012345679/,
  );
});

test("paid import rejects offsetting order-total discrepancies and repeated or unrelated paid orders", () => {
  const first = { orderNo: "123456789012345678", status: "PAID", paidTotalCny: "97.70" };
  const second = { orderNo: "123456789012345679", status: "PAID", paidTotalCny: "29.50" };
  assert.throws(
    () => create1688ImportedPaymentEvidence(input, [
      { ...first, paidTotalCny: "97.60" }, { ...second, paidTotalCny: "29.60" },
    ]),
    /PAYMENT_PAID_ORDER_TOTAL_CONFLICT/,
  );
  assert.throws(() => create1688ImportedPaymentEvidence(input, [first, first, second]), /PAYMENT_PAID_ORDER_INVALID/);
  assert.throws(
    () => create1688ImportedPaymentEvidence(input, [first, second, { ...first, orderNo: "123456789012345677" }]),
    /PAYMENT_PAID_ORDER_UNEXPECTED/,
  );
});

test("WorldFirst screenshot shows 0.8% after currency rounding", () => {
  assert.equal(worldFirstFeeAtInternalFx(59_893), 479);
  assert.equal(worldFirstFeeAtInternalFx(2_004), 16); // USD cents
});

test("1688 paid evidence includes platform fees once, supports signed adjustments and pins both fee and FX", () => {
  const paid = create1688PaymentEvidence(input);
  assert.equal(paid.actualOrderPaidKrwAtInternalFx, 29_256);
  assert.equal(paid.worldFirstFeeKrw, 234);
  assert.equal(paid.budgetSpendKrw, 29_490);
  assert.deepEqual(read1688PaymentEvidence(JSON.parse(JSON.stringify(paid)), sourceEventId), paid);
  assert.equal(create1688PaymentEvidence({ ...input, originalRows: originalRows.split("\n").reverse().join("\n") }).paymentEvidenceHash, paid.paymentEvidenceHash);
  for (const field of ["paymentFeeBps", "exchangeRateKrwPerCny", "worldFirstFeeKrw", "budgetSpendKrw"]) {
    assert.throws(() => read1688PaymentEvidence({ ...paid, [field]: paid[field] + 1 }, sourceEventId), /PAYMENT_EVIDENCE_HASH_INVALID/);
  }
});

test("a stale reservation, a missing or duplicate order row and a mismatched receipt total fail closed", () => {
  for (const rows of [
    originalRows.replace(",12,", ",100,"),
    originalRows.split("\n")[0],
    originalRows + "\n" + originalRows.split("\n")[0],
    originalRows.replace("123456789012345679", "123456789012345680"),
  ]) {
    assert.throws(() => create1688PaymentEvidence({ ...input, originalRows: rows }), /PAYMENT_ORDER_QUANTITY_CONFLICT/);
  }
  assert.throws(() => create1688PaymentEvidence({ ...input, grandTotalCny: "127.19" }), /PAYMENT_GRAND_TOTAL_CONFLICT/);
});

test("11/04-style DRAFT plus completed barcode blocks a false zero budget; verified proof supersedes it once", () => {
  assert.throws(() => reconcilePurchaseSpendEvidence(cycleMonth, [prep, completion]), /CYCLE_SPEND_PAYMENT_EVIDENCE_REQUIRED/);
  assert.throws(() => reconcilePurchaseSpendEvidence(cycleMonth, [{
    ...prep, result_snapshot: { snapshot: { ...prep.result_snapshot.snapshot, status: "ORDERED", actualOrderPaidKrwAtInternalFx: 6_782_344 } },
  }]), /CYCLE_SPEND_PAYMENT_EVIDENCE_REQUIRED/);
  const paid = { source_event_id: sourceEventId, result_snapshot: create1688PaymentEvidence(input) };
  const reconciled = reconcilePurchaseSpendEvidence(cycleMonth, [prep, completion, paid]);
  assert.equal(purchaseBudgetCarryoverBasis(cycleMonth, reconciled).recordedSpendKrw, 29_490);
  assert.throws(() => reconcilePurchaseSpendEvidence(cycleMonth, [prep, paid]), /CYCLE_SPEND_PAYMENT_EVIDENCE_REQUIRED/);
});

test("purchase run keeps unverified prices out of actual costs and hides the requested balance card", async () => {
  const page = await readFile("src/app/china-order-manager/page.tsx", "utf8");
  assert.match(page, /confirmedPurchase\.actualOrderPaidKrwAtInternalFx/);
  assert.match(page, /barcodeOrderCount \|\|/);
  assert.doesNotMatch(page, /최종비용 전 남은 한도/);
});

test("the payment endpoint validates before writing, independently reads persistence, and keeps replay idempotent", async t => {
  let stored;
  let written = 0;
  let authenticated = false;
  let barcodeRows = expected;
  const api = loadPurchaseCycleModule("src/app/api/china-order-manager/payment-evidence/route.ts", {
    "@/lib/internalChinaPaymentEvidence": { create1688ImportedPaymentEvidence, create1688PaymentEvidence, create1688SettledPaymentEvidence, read1688PaymentEvidence, INTERNAL_CHINA_PAYMENT_SOURCE_PREFIX },
    "@/lib/internalChinaFreightBarcodeCompletion": {
      loadInternalChinaFreightBarcodeCompletion: async () => ({ cycleMonth, evidenceHash: barcodeEvidenceHash }),
      loadInternalChinaFreightBarcodeReceiptEvidence: async () => ({ lines: barcodeRows, evidenceHash: barcodeEvidenceHash }),
    },
    "@/lib/internalChinaForwarderStoredClose": { loadStoredInternalChinaForwarderClose: async () => null },
    "@/lib/internalChinaMonthlyPurchaseSummary": { INTERNAL_CHINA_PURCHASE_PREP_OPERATION_TYPE: "INTERNAL_CHINA_PURCHASE_PREP" },
    "@/lib/productLaunchTrackerServer": { resolveProductLaunchIdentity: async () => authenticated
      ? { ok: true, value: {} } : { ok: false, status: 403, body: {} } },
    "@/lib/chinaOrderLedger": { loadChinaOrderLedger: async () => ({ commitments: [
      { barcode: "BBA1-1", sourceSystem: "fast-purchase-mvp", sourceRunId: draftId },
    ] }) },
    "@/lib/supabase/admin": { createSupabaseAdminClient: async () => ({ from(table) {
      assert.equal(table, "commerce_operation_runs");
      const query = {
        upsert: async (row, options) => {
          assert.equal(options.ignoreDuplicates, true);
          assert.equal(options.onConflict, "source_event_id");
          assert.equal(row.source_event_id, sourceEventId);
          if (!stored) { written++; stored = structuredClone(row); }
          return { error: null };
        },
        select: () => query,
        eq: (_, value) => { assert.equal(value, sourceEventId); return query; },
        maybeSingle: async () => ({ data: stored, error: null }),
      };
      return query;
    } }) },
  });
  const request = (patch = {}) => new Request("https://fixture.test/api/china-order-manager/payment-evidence", {
    method: "POST", body: JSON.stringify({ draftId, barcodeEvidenceHash, rows: originalRows, grandTotalCny: "127.20", ...patch }),
  });
  assert.equal((await api.POST(request())).status, 403);
  const contextRequest = new Request(`https://fixture.test/api/china-order-manager/payment-evidence?draftId=${encodeURIComponent(draftId)}`);
  assert.equal((await api.GET(contextRequest)).status, 403);
  authenticated = true;
  const context = await api.GET(contextRequest);
  assert.equal(context.status, 200);
  assert.deepEqual((await context.json()).context, { draftId, evidenceHash: barcodeEvidenceHash, expectedRows: expected });
  assert.equal((await api.POST(request({ grandTotalCny: "127.21" }))).status, 409);
  assert.equal((await api.POST(request({ barcodeEvidenceHash: "stale" }))).status, 409);
  const paidOrders = [
    { orderNo: "123456789012345678", status: "PAID", paidTotalCny: "97.70" },
    { orderNo: "123456789012345679", status: "PAID", paidTotalCny: "29.50" },
  ];
  const cancelled = await api.POST(request({
    paidOrders: [{ ...paidOrders[0], status: "CANCELLED" }, paidOrders[1]],
  }));
  assert.equal(cancelled.status, 409);
  assert.equal((await cancelled.json()).code, "PAYMENT_PAID_ORDER_NOT_SETTLED");
  assert.equal((await api.POST(request({ paidOrders: [] }))).status, 409);
  assert.equal(written, 0);
  assert.equal((await api.POST(request({ paidOrders }))).status, 200);
  assert.equal((await api.POST(request())).status, 200);
  assert.equal((await api.POST(request({ rows: originalRows.replace("100.00", "101.00"), grandTotalCny: "128.20" }))).status, 409);
  assert.equal(written, 1);
  assert.equal(stored.input_snapshot.paidOrderTotalsVerified, true);
  assert.equal(stored.result_snapshot.paidTotalFen, 12_720);

  await t.test("5-5 keeps open refund requests on readback, deducts only the credited amount and records the settlement once", async () => {
    stored = null;
    written = 0;
    const paid = "9000000000000000001";
    const cancelled = "9000000000000000002";
    const refund = { refundId: "TQ100", requestedFen: 5000 };
    barcodeRows = [{ orderNo: paid, barcode: "BBA1-1", quantity: 2 }];
    const detailRequest = new Request(contextRequest.url + "&include=settlement");
    const read = async () => (await (await api.GET(detailRequest)).json()).context;
    authenticated = false;
    assert.equal((await api.GET(detailRequest)).status, 403);
    authenticated = true;
    assert.deepEqual(await read(), { draftId, evidenceHash: barcodeEvidenceHash, expectedRows: barcodeRows,
      recordedPayment: null, supportsPendingRefunds: true });
    const settlement = {
      orders: [
        { orderNo: paid, status: "PAID", paidFen: 10000, refundedFen: 1250, pendingRefunds: [refund, { ...refund }] },
        { orderNo: cancelled, status: "CANCELLED", paidFen: 3000, refundedFen: 0, pendingRefunds: [{ refundId: null, requestedFen: null }] },
      ],
      rows: [{ ...barcodeRows[0], goodsFen: 8000, freightFen: 750, serviceFen: 0 }],
      netTotalFen: 8750,
    };
    const conflict = structuredClone(settlement);
    conflict.orders[1].pendingRefunds = [refund];
    const rejected = await api.POST(request({ settlement: conflict }));
    assert.equal(rejected.status, 409);
    assert.equal((await rejected.json()).code, "PAYMENT_REFUND_REQUEST_CONFLICT");
    assert.equal(written, 0);
    assert.equal((await api.POST(request({ settlement }))).status, 200);
    assert.equal((await api.POST(request({ settlement }))).status, 200);
    assert.equal(written, 1);
    const proof = (await read()).recordedPayment;
    assert.deepEqual(proof, stored.result_snapshot);
    assert.deepEqual(proof.settledOrders[0].pendingRefunds, [refund]);
    assert.equal(proof.settledOrders[0].refundedFen, 1250);
    assert.equal(proof.rows.length, 1);
    assert.equal(proof.rows[0].quantity, 2);
    assert.equal(proof.paidTotalFen, 8750);
    assert.equal(proof.unreturnedCancelledFen, 3000);
    assert.equal(proof.cashOutflowFen, 11750);
    assert.equal(proof.budgetSpendKrw, 27241);
    assert.throws(() => read1688PaymentEvidence({ ...proof, cashOutflowFen: 8750 }, sourceEventId), /PAYMENT_EVIDENCE_HASH_INVALID/);
    const anotherDraft = "fast-purchase-draft:99999999999999999999";
    const row = { ...settlement.rows[0], orderNo: cancelled };
    const second = create1688SettledPaymentEvidence({ draftId: anotherDraft, cycleMonth, barcodeEvidenceHash, expected: [row] }, {
      orders: [{ orderNo: cancelled, status: "PAID", paidFen: 8750, refundedFen: 0 }], rows: [row], netTotalFen: 8750,
    });
    assert.throws(() => reconcilePurchaseSpendEvidence(cycleMonth, [completion, { source_event_id: sourceEventId, result_snapshot: proof },
      { ...completion, result_snapshot: { ...completion.result_snapshot, draftId: anotherDraft } },
      { source_event_id: INTERNAL_CHINA_PAYMENT_SOURCE_PREFIX + anotherDraft, result_snapshot: second }]), /CYCLE_SPEND_PAYMENT_EVIDENCE_REQUIRED/);
  });
});
