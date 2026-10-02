import { normalizeTrackingNumber } from "./shopling-unshipped-reconciliation.mjs";

export const SHOPLING_B12_COMPLETED_STATUS = "A04";
export const SHOPLING_B12_COMPLETED_LABEL = "택배사전송완료";
export const SHOPLING_B12_PENDING_LABEL = "택배사전송대기";

function fail(code, message, details = undefined) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  throw error;
}

function unique(values) {
  return [...new Set(values)];
}

function sameSet(left, right) {
  if (left.length !== right.length) return false;
  const expected = new Set(right);
  return left.every((value) => expected.has(value));
}

export function normalizeB12InvoiceDeletionCandidate(candidate = {}) {
  const invoiceNo = normalizeTrackingNumber(candidate.invoiceNo);
  const shoplingOrderNos = unique((candidate.shoplingOrderNos || [])
    .map((value) => String(value || "").trim())
    .filter(Boolean));
  if (!invoiceNo || !shoplingOrderNos.length) {
    fail(
      "B12_INVOICE_DELETION_IDENTITY_INCOMPLETE",
      "Invoice deletion requires one invoice number and at least one Shopling order number.",
    );
  }
  return {
    invoiceNo,
    shoplingOrderNos,
    expectedOrderCount: shoplingOrderNos.length,
    actionKey: `b12-delete-invoice:${invoiceNo}`,
  };
}

function normalizedRows(snapshot = {}) {
  return Array.isArray(snapshot.rows)
    ? snapshot.rows.map((row) => ({
      shoplingOrderNo: String(row.shoplingOrderNo || "").trim(),
      invoiceNo: normalizeTrackingNumber(row.invoiceNo || row.invoiceText),
      orderStatus: String(row.orderStatus || "").trim(),
      selected: row.selected === true,
    }))
    : [];
}

export function verifyCompletedInvoiceSnapshot(candidate, snapshot = {}) {
  const expected = normalizeB12InvoiceDeletionCandidate(candidate);
  const rows = normalizedRows(snapshot);
  if (!rows.length) {
    return {
      state: "NOT_PRESENT",
      invoiceNo: expected.invoiceNo,
      shoplingOrderNos: [],
    };
  }

  if (rows.some((row) => row.invoiceNo !== expected.invoiceNo)) {
    fail(
      "B12_INVOICE_SEARCH_NOT_EXACT",
      "The B12 invoice search returned a row for a different invoice number.",
      { resultCount: rows.length },
    );
  }
  if (rows.some((row) => !row.shoplingOrderNo)) {
    fail("B12_ORDER_ID_MISSING", "A B12 result row does not expose a Shopling order number.");
  }

  const actualOrderNos = rows.map((row) => row.shoplingOrderNo);
  if (unique(actualOrderNos).length !== actualOrderNos.length) {
    fail("B12_ORDER_ID_DUPLICATE", "The B12 result contains a duplicate Shopling order number.");
  }
  if (!sameSet(actualOrderNos, expected.shoplingOrderNos)) {
    fail(
      "B12_INVOICE_ORDER_SET_MISMATCH",
      "The orders currently linked to this invoice do not exactly match the approved set.",
      {
        expectedOrderCount: expected.shoplingOrderNos.length,
        actualOrderCount: actualOrderNos.length,
      },
    );
  }
  if (rows.some((row) => row.orderStatus !== SHOPLING_B12_COMPLETED_STATUS)) {
    fail(
      "B12_INVOICE_STATUS_MISMATCH",
      "At least one matched B12 order is not in courier-transfer-complete status.",
    );
  }

  return {
    state: "EXACT_MATCH",
    invoiceNo: expected.invoiceNo,
    shoplingOrderNos: actualOrderNos,
  };
}

export function verifyPendingOrderSnapshot(shoplingOrderNo, snapshot = {}) {
  const expectedOrderNo = String(shoplingOrderNo || "").trim();
  const rows = normalizedRows(snapshot);
  const matches = rows.filter((row) => row.shoplingOrderNo === expectedOrderNo);
  if (rows.length !== 1 || matches.length !== 1) {
    fail(
      "B12_PENDING_ORDER_READBACK_MISMATCH",
      "The deleted invoice order was not found exactly once in courier-transfer-pending status.",
      { resultCount: rows.length, exactMatchCount: matches.length },
    );
  }
  if (matches[0].invoiceNo) {
    fail(
      "B12_PENDING_INVOICE_NOT_EMPTY",
      "The order moved to courier-transfer-pending but still exposes an invoice number.",
    );
  }
  return {
    shoplingOrderNo: expectedOrderNo,
    verified: true,
  };
}

async function verifyPendingOrders(adapter, candidate) {
  const verified = [];
  for (const shoplingOrderNo of candidate.shoplingOrderNos) {
    const snapshot = await adapter.findPendingByOrder(shoplingOrderNo);
    verified.push(verifyPendingOrderSnapshot(shoplingOrderNo, snapshot));
  }
  return verified;
}

export async function runShoplingB12InvoiceDeletion(candidate, options = {}, dependencies = {}) {
  const expected = normalizeB12InvoiceDeletionCandidate(candidate);
  const adapter = dependencies.adapter;
  if (!adapter
    || typeof adapter.findCompletedByInvoice !== "function"
    || typeof adapter.findPendingByOrder !== "function"
    || typeof adapter.deleteExactInvoiceRows !== "function") {
    fail("B12_INVOICE_DELETION_ADAPTER_INVALID", "A complete B12 browser adapter is required.");
  }

  const before = await adapter.findCompletedByInvoice(expected.invoiceNo);
  const preflight = verifyCompletedInvoiceSnapshot(expected, before);
  if (preflight.state === "NOT_PRESENT") {
    const pendingOrders = await verifyPendingOrders(adapter, expected);
    return {
      schemaVersion: 1,
      mode: options.execute === true ? "EXECUTE" : "DRY_RUN",
      status: "ALREADY_DELETED_VERIFIED",
      ...expected,
      pendingOrderCount: pendingOrders.length,
      externalWritePerformed: false,
    };
  }

  if (options.execute !== true) {
    return {
      schemaVersion: 1,
      mode: "DRY_RUN",
      status: "PREFLIGHT_READY",
      ...expected,
      matchedOrderCount: preflight.shoplingOrderNos.length,
      externalWritePerformed: false,
    };
  }
  if (options.approvalKey !== expected.actionKey) {
    fail(
      "B12_INVOICE_DELETION_APPROVAL_REQUIRED",
      "Execution requires the exact invoice deletion action key.",
    );
  }

  await adapter.deleteExactInvoiceRows(expected);

  const after = await adapter.findCompletedByInvoice(expected.invoiceNo);
  const completedReadback = verifyCompletedInvoiceSnapshot(expected, after);
  if (completedReadback.state !== "NOT_PRESENT") {
    fail(
      "B12_INVOICE_DELETION_READBACK_FAILED",
      "The invoice is still present in courier-transfer-complete after deletion.",
    );
  }
  const pendingOrders = await verifyPendingOrders(adapter, expected);

  return {
    schemaVersion: 1,
    mode: "EXECUTE",
    status: "DELETED_AND_VERIFIED",
    ...expected,
    pendingOrderCount: pendingOrders.length,
    externalWritePerformed: true,
  };
}
