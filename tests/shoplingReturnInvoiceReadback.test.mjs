import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReturnPickupQnaEvidence,
  formatReturnPickupMemo,
  nextBusinessDayDate,
  runReturnInvoiceReadback,
} from "../local-agent/src/shopling-return-invoice-readback.mjs";

function audit(overrides = {}) {
  return {
    schemaVersion: 1,
    stage: "SHOPLING_RETURN_REGISTERED",
    actionKey: "cj-return-pickup:3501008:587625398174",
    claimKey: "58372",
    orderNo: "3501008",
    outboundInvoiceNo: "587625398174",
    updatedAt: "2026-10-02T03:00:00.000Z",
    ...overrides,
  };
}

test("next-business-day policy skips weekends", () => {
  assert.equal(nextBusinessDayDate("2026-10-02T03:00:00.000Z"), "2026-10-05");
  assert.equal(nextBusinessDayDate("2026-10-05T03:00:00.000Z"), "2026-10-06");
});

test("readback does not contact CJ before the next business day", async () => {
  let called = false;
  const result = await runReturnInvoiceReadback({
    audit: audit(),
    now: new Date("2026-10-04T03:00:00.000Z"),
  }, {
    cjAdapter: { lookupReturnInvoice: async () => { called = true; } },
  });
  assert.equal(result.status, "NOT_DUE");
  assert.equal(result.eligibleOn, "2026-10-05");
  assert.equal(called, false);
});

test("blank CJ return invoice stays pending without audit or Shopling writes", async () => {
  let writes = 0;
  const result = await runReturnInvoiceReadback({
    audit: audit(),
    now: new Date("2026-10-05T03:00:00.000Z"),
    execute: true,
  }, {
    cjAdapter: { lookupReturnInvoice: async () => ({
      status: "PENDING",
      outboundInvoiceNo: "587625398174",
      returnInvoiceNo: "",
      evidence: ["CJ_ORIGINAL_INVOICE_MATCHED"],
    }) },
    memoAdapter: { recordReturnInvoiceMemo: async () => { writes += 1; } },
    writeAudit: async () => { writes += 1; },
  });
  assert.equal(result.status, "RETURN_INVOICE_PENDING");
  assert.equal(writes, 0);
});

test("verified return invoice is recorded in exact Shopling memo and terminal audit", async () => {
  let savedMemo = "";
  let writtenAudit = null;
  const result = await runReturnInvoiceReadback({
    audit: audit(),
    now: new Date("2026-10-05T03:00:00.000Z"),
    execute: true,
  }, {
    cjAdapter: { lookupReturnInvoice: async () => ({
      status: "FOUND",
      outboundInvoiceNo: "587625398174",
      returnInvoiceNo: "844764751234",
      evidence: ["CJ_ORIGINAL_INVOICE_MATCHED", "CJ_RETURN_INVOICE_READBACK_VERIFIED"],
    }) },
    memoAdapter: { recordReturnInvoiceMemo: async (memo) => {
      savedMemo = memo;
      return { changed: true, orderNo: "3501008", category: "R" };
    } },
    writeAudit: async (_key, value) => { writtenAudit = value; },
  });
  assert.equal(result.status, "RETURN_INVOICE_RECORDED");
  assert.equal(result.externalWritesPerformed, true);
  assert.equal(savedMemo, formatReturnPickupMemo({
    outboundInvoiceNo: "587625398174",
    returnInvoiceNo: "844764751234",
  }));
  assert.equal(writtenAudit.stage, "SHOPLING_RETURN_INVOICE_RECORDED");
  assert.equal(writtenAudit.returnInvoiceReceipt.returnInvoiceNo, "844764751234");
  assert.equal(writtenAudit.shoplingMemoReceipt.category, "R");
  assert.equal(writtenAudit.shoplingMemoReceipt.memoHash.length, 64);
  const evidence = buildReturnPickupQnaEvidence(writtenAudit);
  assert.equal(evidence.orderNo, "3501008");
  assert.equal(evidence.code, "CURRENT_CLAIM_AND_PICKUP_STATUS");
  assert.match(evidence.replyText, /844764751234/);
});
