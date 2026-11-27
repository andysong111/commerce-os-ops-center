import { createHash } from "node:crypto";
import { normalize1688RefundRequests, type RefundRequest } from "../../local-agent/src/alibaba1688-refund-requests.mjs";
import { WORLDFIRST_KUAJINGBAO_FEE_BPS } from "./productDecisionEngine/purchaseCostPolicy.ts";

export const INTERNAL_CHINA_PAYMENT_SOURCE_PREFIX = "internal-china-verified-payment:";
export const INTERNAL_CHINA_PAYMENT_FX = 230;
export const PAYMENT_EVIDENCE_SCHEMA = "1688-payment-v1";
export const PAYMENT_EVIDENCE_MAX_LENGTH = 100_000;

type OrderQuantity = { orderNo: string; barcode: string; quantity: number };
type PaidLine = OrderQuantity & {
  goodsFen: number;
  freightFen: number;
  serviceFen: number;
};
type SettledOrder = { orderNo: string; status: "PAID" | "CANCELLED"; paidFen: number; refundedFen: number; pendingRefunds?: RefundRequest[] };

const ORDER_NO = /^\d{6,32}$/;
const BARCODE = /^[A-Z]{3}\d+-\d+$/;
const HASH = /^sha256:[a-f0-9]{64}$/;
const key = (row: OrderQuantity) => `${row.orderNo}/${row.barcode}`;
const totalFen = (line: PaidLine) => line.goodsFen + line.freightFen + line.serviceFen;

function moneyFen(text: string, allowNegative = false) {
  const pattern = allowNegative ? /^-?\d{1,8}(?:\.\d{1,2})?$/ : /^\d{1,8}(?:\.\d{1,2})?$/;
  if (!pattern.test(text)) throw new Error("PAYMENT_CNY_INVALID");
  return Math.round(Number(text) * 100);
}

export function parse1688PaymentRows(value: unknown) {
  if (typeof value !== "string" || value.length > PAYMENT_EVIDENCE_MAX_LENGTH) {
    throw new Error("PAYMENT_ROWS_INVALID");
  }
  const rows = value.trim().split(/\r?\n/).filter(row => row.trim());
  if (!rows.length || rows.length > 2000) throw new Error("PAYMENT_ROWS_INVALID");
  return rows.map((row, index): PaidLine => {
    const fields = row.split(row.includes("\t") ? "\t" : ",").map(field => field.normalize("NFKC").trim());
    const [orderNo, rawBarcode, quantityText, goods, freight, service] = fields;
    const barcode = rawBarcode?.toUpperCase();
    const quantity = Number(quantityText);
    if (
      fields.length !== 6 || !ORDER_NO.test(orderNo) || !BARCODE.test(barcode) ||
      !/^\d{1,6}$/.test(quantityText) || quantity <= 0
    ) throw new Error(`PAYMENT_ROW_INVALID:${index + 1}`);
    try {
      return { orderNo, barcode, quantity, goodsFen: moneyFen(goods),
        freightFen: moneyFen(freight, true), serviceFen: moneyFen(service) };
    } catch {
      throw new Error(`PAYMENT_ROW_INVALID:${index + 1}`);
    }
  });
}

export function match1688PaymentQuantities(
  actual: readonly OrderQuantity[],
  expected: readonly OrderQuantity[],
) {
  const expectedByKey = new Map<string, number>();
  for (const row of expected) {
    if (!ORDER_NO.test(row.orderNo) || !BARCODE.test(row.barcode) ||
        !Number.isSafeInteger(row.quantity) || row.quantity <= 0) {
      throw new Error("PAYMENT_BARCODE_ORDER_INVALID");
    }
    expectedByKey.set(key(row), (expectedByKey.get(key(row)) ?? 0) + row.quantity);
  }
  if (!expectedByKey.size) throw new Error("PAYMENT_BARCODE_ORDER_INVALID");
  for (const row of actual) {
    const id = key(row);
    if (expectedByKey.get(id) !== row.quantity) throw new Error(`PAYMENT_ORDER_QUANTITY_CONFLICT:${id}`);
    expectedByKey.delete(id);
  }
  if (expectedByKey.size) throw new Error(`PAYMENT_ORDER_QUANTITY_CONFLICT:${expectedByKey.keys().next().value}`);
}

export function build1688PaymentOrderTemplate(lines: readonly OrderQuantity[]) {
  const byOrderLine = new Map<string, OrderQuantity>();
  for (const row of lines) {
    const previous = byOrderLine.get(key(row));
    byOrderLine.set(key(row), {
      orderNo: row.orderNo,
      barcode: row.barcode,
      quantity: (previous?.quantity ?? 0) + row.quantity,
    });
  }
  return [...byOrderLine.values()].map(row =>
    [row.orderNo, row.barcode, row.quantity, "", "", ""].join("\t")).join("\n");
}

function snapshotHash(payload: object) {
  return `sha256:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`;
}

function normalizeSettledOrders(value: unknown, rows: readonly PaidLine[]): SettledOrder[] {
  if (!Array.isArray(value) || !value.length || value.length > 2000) throw new Error("PAYMENT_SETTLEMENT_INVALID");
  const remaining = new Map<string, number>();
  for (const row of rows) remaining.set(row.orderNo, (remaining.get(row.orderNo) ?? 0) + totalFen(row));
  const seen = new Set<string>();
  const refundOwners = new Map<string, string>();
  const orders = value.map((raw): SettledOrder => {
    if (!raw || typeof raw !== "object") throw new Error("PAYMENT_SETTLEMENT_INVALID");
    const { orderNo, status, paidFen, refundedFen } = raw;
    if (typeof orderNo !== "string" || !/^\d{19}$/.test(orderNo) || seen.has(orderNo) ||
        !Number.isSafeInteger(paidFen) || !Number.isSafeInteger(refundedFen) ||
        refundedFen < 0 || paidFen >= 10_000_000_000 || refundedFen > paidFen) {
      throw new Error("PAYMENT_SETTLEMENT_INVALID");
    }
    seen.add(orderNo);
    const pendingRefunds = raw.pendingRefunds === undefined ? undefined : normalize1688RefundRequests(raw.pendingRefunds);
    for (const { refundId } of pendingRefunds ?? []) {
      if (!refundId) continue;
      if (refundOwners.has(refundId) && refundOwners.get(refundId) !== orderNo) throw new Error("PAYMENT_REFUND_REQUEST_CONFLICT");
      refundOwners.set(refundId, orderNo);
    }
    const expected = remaining.get(orderNo);
    if (status === "PAID" && expected !== undefined && paidFen - refundedFen === expected) {
      remaining.delete(orderNo);
    } else if (status !== "CANCELLED" || expected !== undefined || (paidFen !== refundedFen && !pendingRefunds)) {
      throw new Error("PAYMENT_SETTLEMENT_ORDER_CONFLICT:" + orderNo);
    }
    return { orderNo, status, paidFen, refundedFen, ...(pendingRefunds ? { pendingRefunds } : {}) };
  });
  if (remaining.size) throw new Error("PAYMENT_PAID_ORDER_MISSING:" + remaining.keys().next().value);
  return orders.sort((a, b) => a.orderNo.localeCompare(b.orderNo, "en"));
}

export function build1688PaymentEvidence(input: {
  draftId: string;
  cycleMonth: string;
  barcodeEvidenceHash: string;
  rows: readonly PaidLine[];
  paidTotalFen: number;
  settledOrders?: unknown;
  paymentFeeBps?: number;
  exchangeRateKrwPerCny?: number;
}) {
  const { draftId, cycleMonth, barcodeEvidenceHash, paidTotalFen,
    paymentFeeBps = WORLDFIRST_KUAJINGBAO_FEE_BPS,
    exchangeRateKrwPerCny = INTERNAL_CHINA_PAYMENT_FX } = input;
  if (!/^fast-purchase-draft:[a-f0-9]{20}$/.test(draftId) ||
      !/^20\d{2}-(0[1-9]|1[0-2])$/.test(cycleMonth) || !HASH.test(barcodeEvidenceHash) ||
      !Array.isArray(input.rows) || !input.rows.length || input.rows.length > 2000 ||
      !Number.isSafeInteger(paymentFeeBps) || paymentFeeBps < 0 || paymentFeeBps > 1000 ||
      !Number.isSafeInteger(exchangeRateKrwPerCny) || exchangeRateKrwPerCny < 1 || exchangeRateKrwPerCny > 1000) {
    throw new Error("PAYMENT_EVIDENCE_INVALID");
  }
  const seen = new Set<string>();
  const rows = input.rows.map(row => {
    if (!row || typeof row !== "object") throw new Error("PAYMENT_SETTLEMENT_INVALID");
    const { orderNo, barcode, quantity, goodsFen, freightFen, serviceFen } = row;
    if (typeof orderNo !== "string" || !ORDER_NO.test(orderNo) || typeof barcode !== "string" || !BARCODE.test(barcode) ||
        !Number.isSafeInteger(quantity) || quantity <= 0 ||
        ![goodsFen, freightFen, serviceFen].every(value => Number.isSafeInteger(value) && Math.abs(value) < 10_000_000_000) ||
        goodsFen <= 0 || serviceFen < 0 || totalFen(row) <= 0 || seen.has(key(row))) {
      throw new Error(`PAYMENT_LINE_INVALID_OR_DUPLICATE:${key(row)}`);
    }
    seen.add(key(row));
    return { orderNo, barcode, quantity, goodsFen, freightFen, serviceFen };
  }).sort((a, b) => key(a).localeCompare(key(b), "en"));
  if (!Number.isSafeInteger(paidTotalFen) || paidTotalFen <= 0 ||
      rows.reduce((sum, row) => sum + totalFen(row), 0) !== paidTotalFen) {
    throw new Error("PAYMENT_GRAND_TOTAL_CONFLICT");
  }
  const payload = { schema: PAYMENT_EVIDENCE_SCHEMA, draftId, cycleMonth, barcodeEvidenceHash, rows, paidTotalFen,
    paymentFeeBps, exchangeRateKrwPerCny,
    ...(input.settledOrders === undefined ? {} : { settledOrders: normalizeSettledOrders(input.settledOrders, rows) }) };
  const actualOrderPaidKrwAtInternalFx = Math.round(paidTotalFen * exchangeRateKrwPerCny / 100);
  const worldFirstFeeKrw = Math.round(actualOrderPaidKrwAtInternalFx * paymentFeeBps / 10_000);
  // A closed original has no incoming units. Its outstanding payment still consumes cash.
  const unreturnedCancelledFen = (payload.settledOrders ?? []).reduce((sum, order) =>
    sum + (order.status === "CANCELLED" ? order.paidFen - order.refundedFen : 0), 0);
  const cashOutflowFen = paidTotalFen + unreturnedCancelledFen;
  const cashOutflowKrw = Math.round(cashOutflowFen * exchangeRateKrwPerCny / 100);
  return {
    ...payload,
    paymentEvidenceHash: snapshotHash(payload),
    actualOrderPaidKrwAtInternalFx,
    worldFirstFeeKrw,
    ...(unreturnedCancelledFen ? { unreturnedCancelledFen, cashOutflowFen } : {}),
    budgetSpendKrw: cashOutflowKrw + Math.round(cashOutflowKrw * paymentFeeBps / 10_000),
  };
}

export function create1688PaymentEvidence(input: {
  draftId: string;
  cycleMonth: string;
  barcodeEvidenceHash: string;
  originalRows: unknown;
  grandTotalCny: unknown;
  expected: readonly OrderQuantity[];
}) {
  const rows = parse1688PaymentRows(input.originalRows);
  match1688PaymentQuantities(rows, input.expected);
  const paidTotalFen = moneyFen(String(input.grandTotalCny ?? "").trim());
  return build1688PaymentEvidence({ ...input, rows, paidTotalFen });
}

export function create1688SettledPaymentEvidence(
  input: Pick<Parameters<typeof create1688PaymentEvidence>[0], "draftId" | "cycleMonth" | "barcodeEvidenceHash" | "expected">,
  raw: unknown,
) {
  if (!raw || typeof raw !== "object") throw new Error("PAYMENT_SETTLEMENT_INVALID");
  const settlement = raw as Record<string, unknown>;
  if (!Array.isArray(settlement.orders)) throw new Error("PAYMENT_SETTLEMENT_INVALID");
  const paid = build1688PaymentEvidence({ ...input, rows: settlement.rows as PaidLine[],
    paidTotalFen: settlement.netTotalFen as number, settledOrders: settlement.orders });
  match1688PaymentQuantities(paid.rows, input.expected);
  return paid;
}

/** Match independent, per-order paid amounts before the existing receipt can be stored. */
export function create1688ImportedPaymentEvidence(
  input: Parameters<typeof create1688PaymentEvidence>[0],
  paidOrders: unknown,
) {
  const evidence = create1688PaymentEvidence(input);
  if (!Array.isArray(paidOrders) || !paidOrders.length || paidOrders.length > 2000) {
    throw new Error("PAYMENT_PAID_ORDERS_REQUIRED");
  }
  const expectedByOrder = new Map<string, number>();
  for (const line of evidence.rows) {
    expectedByOrder.set(line.orderNo, (expectedByOrder.get(line.orderNo) ?? 0) + totalFen(line));
  }
  const seen = new Set<string>();
  for (const raw of paidOrders) {
    if (!raw || typeof raw !== "object") throw new Error("PAYMENT_PAID_ORDER_INVALID");
    const order = raw as Record<string, unknown>;
    const orderNo = typeof order.orderNo === "string" ? order.orderNo.trim() : "";
    if (!ORDER_NO.test(orderNo) || seen.has(orderNo)) {
      throw new Error(`PAYMENT_PAID_ORDER_INVALID:${orderNo}`);
    }
    seen.add(orderNo);
    const expected = expectedByOrder.get(orderNo);
    if (expected === undefined) {
      if (order.status === "CANCELLED") continue;
      throw new Error(`PAYMENT_PAID_ORDER_UNEXPECTED:${orderNo}`);
    }
    if (order.status !== "PAID") throw new Error(`PAYMENT_PAID_ORDER_NOT_SETTLED:${orderNo}`);
    const amount = moneyFen(String(order.paidTotalCny ?? "").trim());
    if (amount !== expected) throw new Error(`PAYMENT_PAID_ORDER_TOTAL_CONFLICT:${orderNo}`);
    expectedByOrder.delete(orderNo);
  }
  if (expectedByOrder.size) {
    throw new Error(`PAYMENT_PAID_ORDER_MISSING:${expectedByOrder.keys().next().value}`);
  }
  return evidence;
}

export function read1688PaymentEvidence(snapshot: Record<string, unknown>, sourceEventId: unknown) {
  if (typeof sourceEventId !== "string" || !sourceEventId.startsWith(INTERNAL_CHINA_PAYMENT_SOURCE_PREFIX)) return null;
  const evidence = build1688PaymentEvidence({
    draftId: String(snapshot.draftId ?? ""),
    cycleMonth: String(snapshot.cycleMonth ?? ""),
    barcodeEvidenceHash: String(snapshot.barcodeEvidenceHash ?? ""),
    rows: snapshot.rows as PaidLine[],
    paidTotalFen: snapshot.paidTotalFen as number,
    paymentFeeBps: snapshot.paymentFeeBps as number,
    exchangeRateKrwPerCny: snapshot.exchangeRateKrwPerCny as number,
    settledOrders: snapshot.settledOrders,
  });
  if (snapshot.schema !== PAYMENT_EVIDENCE_SCHEMA || snapshot.paymentEvidenceHash !== evidence.paymentEvidenceHash ||
      sourceEventId !== INTERNAL_CHINA_PAYMENT_SOURCE_PREFIX + evidence.draftId ||
      snapshot.actualOrderPaidKrwAtInternalFx !== evidence.actualOrderPaidKrwAtInternalFx ||
      snapshot.worldFirstFeeKrw !== evidence.worldFirstFeeKrw ||
      snapshot.budgetSpendKrw !== evidence.budgetSpendKrw ||
      snapshot.unreturnedCancelledFen !== evidence.unreturnedCancelledFen || snapshot.cashOutflowFen !== evidence.cashOutflowFen) {
    throw new Error("PAYMENT_EVIDENCE_HASH_INVALID");
  }
  return evidence;
}
