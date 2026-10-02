import assert from "node:assert/strict";
import test from "node:test";
import {
  runShoplingB12InvoiceDeletion,
  verifyCompletedInvoiceSnapshot,
} from "../local-agent/src/shopling-b12-invoice-deletion.mjs";

const candidate = {
  invoiceNo: "5876-2537-5225",
  shoplingOrderNos: ["3493809"],
};

function completedRows(orderNos = ["3493809"], invoiceNo = "587625375225") {
  return {
    rows: orderNos.map((shoplingOrderNo) => ({
      shoplingOrderNo,
      invoiceNo,
      orderStatus: "A04",
    })),
  };
}

function adapter(overrides = {}) {
  const calls = [];
  return {
    calls,
    async findCompletedByInvoice(invoiceNo) {
      calls.push(["completed", invoiceNo]);
      return completedRows();
    },
    async findPendingByOrder(orderNo) {
      calls.push(["pending", orderNo]);
      return { rows: [{ shoplingOrderNo: orderNo, invoiceNo: "", orderStatus: "A03" }] };
    },
    async deleteExactInvoiceRows(expected) {
      calls.push(["delete", expected.invoiceNo, expected.shoplingOrderNos]);
    },
    ...overrides,
  };
}

test("dry-run verifies an exact invoice/order set and never clicks delete", async () => {
  const browser = adapter();
  const result = await runShoplingB12InvoiceDeletion(candidate, {}, { adapter: browser });
  assert.equal(result.status, "PREFLIGHT_READY");
  assert.equal(result.externalWritePerformed, false);
  assert.deepEqual(browser.calls, [["completed", "587625375225"]]);
});

test("combined-package deletion requires the complete approved order set", () => {
  const combined = {
    invoiceNo: "587625375225",
    shoplingOrderNos: ["3493809", "3493810"],
  };
  assert.equal(
    verifyCompletedInvoiceSnapshot(combined, completedRows(["3493810", "3493809"])).state,
    "EXACT_MATCH",
  );
  assert.throws(
    () => verifyCompletedInvoiceSnapshot(combined, completedRows(["3493809"])),
    { code: "B12_INVOICE_ORDER_SET_MISMATCH" },
  );
  assert.throws(
    () => verifyCompletedInvoiceSnapshot(candidate, completedRows(["3493809", "3493810"])),
    { code: "B12_INVOICE_ORDER_SET_MISMATCH" },
  );
});

test("a fuzzy search result containing a different invoice is rejected", () => {
  assert.throws(
    () => verifyCompletedInvoiceSnapshot(candidate, completedRows(["3493809"], "587625375310")),
    { code: "B12_INVOICE_SEARCH_NOT_EXACT" },
  );
});

test("execution requires the exact action approval key", async () => {
  const browser = adapter();
  await assert.rejects(
    runShoplingB12InvoiceDeletion(candidate, { execute: true, approvalKey: "wrong" }, { adapter: browser }),
    { code: "B12_INVOICE_DELETION_APPROVAL_REQUIRED" },
  );
  assert.equal(browser.calls.some(([operation]) => operation === "delete"), false);
});

test("approved deletion succeeds only after completed and pending readback", async () => {
  let completedReads = 0;
  const browser = adapter({
    async findCompletedByInvoice(invoiceNo) {
      this.calls.push(["completed", invoiceNo]);
      completedReads += 1;
      return completedReads === 1 ? completedRows() : { rows: [] };
    },
  });
  const result = await runShoplingB12InvoiceDeletion(candidate, {
    execute: true,
    approvalKey: "b12-delete-invoice:587625375225",
  }, { adapter: browser });
  assert.equal(result.status, "DELETED_AND_VERIFIED");
  assert.equal(result.externalWritePerformed, true);
  assert.deepEqual(browser.calls, [
    ["completed", "587625375225"],
    ["delete", "587625375225", ["3493809"]],
    ["completed", "587625375225"],
    ["pending", "3493809"],
  ]);
});

test("already-deleted retry verifies pending state and never deletes again", async () => {
  const browser = adapter({
    async findCompletedByInvoice(invoiceNo) {
      this.calls.push(["completed", invoiceNo]);
      return { rows: [] };
    },
  });
  const result = await runShoplingB12InvoiceDeletion(candidate, {
    execute: true,
    approvalKey: "b12-delete-invoice:587625375225",
  }, { adapter: browser });
  assert.equal(result.status, "ALREADY_DELETED_VERIFIED");
  assert.equal(result.externalWritePerformed, false);
  assert.equal(browser.calls.some(([operation]) => operation === "delete"), false);
});

test("missing pending readback leaves execution in a failed state", async () => {
  let completedReads = 0;
  const browser = adapter({
    async findCompletedByInvoice() {
      completedReads += 1;
      return completedReads === 1 ? completedRows() : { rows: [] };
    },
    async findPendingByOrder() {
      return { rows: [] };
    },
  });
  await assert.rejects(
    runShoplingB12InvoiceDeletion(candidate, {
      execute: true,
      approvalKey: "b12-delete-invoice:587625375225",
    }, { adapter: browser }),
    { code: "B12_PENDING_ORDER_READBACK_MISMATCH" },
  );
});
