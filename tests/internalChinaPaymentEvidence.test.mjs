import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { create1688PaymentEvidence, INTERNAL_CHINA_PAYMENT_SOURCE_PREFIX, read1688PaymentEvidence } from "../src/lib/internalChinaPaymentEvidence.ts";
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

test("the payment endpoint validates before writing, independently reads persistence, and keeps replay idempotent", async () => {
  let stored;
  let written = 0;
  let authenticated = false;
  const api = loadPurchaseCycleModule("src/app/api/china-order-manager/payment-evidence/route.ts", {
    "@/lib/internalChinaPaymentEvidence": { create1688PaymentEvidence, read1688PaymentEvidence, INTERNAL_CHINA_PAYMENT_SOURCE_PREFIX },
    "@/lib/internalChinaFreightBarcodeCompletion": {
      loadInternalChinaFreightBarcodeCompletion: async () => ({ cycleMonth, evidenceHash: barcodeEvidenceHash }),
      loadInternalChinaFreightBarcodeReceiptEvidence: async () => ({ lines: expected }),
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
  authenticated = true;
  assert.equal((await api.POST(request({ grandTotalCny: "127.21" }))).status, 409);
  assert.equal((await api.POST(request({ barcodeEvidenceHash: "stale" }))).status, 409);
  assert.equal(written, 0);
  assert.equal((await api.POST(request())).status, 200);
  assert.equal((await api.POST(request())).status, 200);
  assert.equal((await api.POST(request({ rows: originalRows.replace("100.00", "101.00"), grandTotalCny: "128.20" }))).status, 409);
  assert.equal(written, 1);
  assert.equal(stored.result_snapshot.paidTotalFen, 12_720);
});
