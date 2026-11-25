import { createHash } from "node:crypto";
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

export function build1688PaymentEvidence(input: {
  draftId: string;
  cycleMonth: string;
  barcodeEvidenceHash: string;
  rows: readonly PaidLine[];
  paidTotalFen: number;
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
    const { orderNo, barcode, quantity, goodsFen, freightFen, serviceFen } = row;
    if (!ORDER_NO.test(orderNo) || !BARCODE.test(barcode) || !Number.isSafeInteger(quantity) || quantity <= 0 ||
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
    paymentFeeBps, exchangeRateKrwPerCny };
  const actualOrderPaidKrwAtInternalFx = Math.round(paidTotalFen * exchangeRateKrwPerCny / 100);
  const worldFirstFeeKrw = Math.round(actualOrderPaidKrwAtInternalFx * paymentFeeBps / 10_000);
  return {
    ...payload,
    paymentEvidenceHash: snapshotHash(payload),
    actualOrderPaidKrwAtInternalFx,
    worldFirstFeeKrw,
    budgetSpendKrw: actualOrderPaidKrwAtInternalFx + worldFirstFeeKrw,
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
  });
  if (snapshot.schema !== PAYMENT_EVIDENCE_SCHEMA || snapshot.paymentEvidenceHash !== evidence.paymentEvidenceHash ||
      sourceEventId !== INTERNAL_CHINA_PAYMENT_SOURCE_PREFIX + evidence.draftId ||
      snapshot.actualOrderPaidKrwAtInternalFx !== evidence.actualOrderPaidKrwAtInternalFx ||
      snapshot.worldFirstFeeKrw !== evidence.worldFirstFeeKrw ||
      snapshot.budgetSpendKrw !== evidence.budgetSpendKrw) {
    throw new Error("PAYMENT_EVIDENCE_HASH_INVALID");
  }
  return evidence;
}
