import type { InternalChinaFreightBarcodeReceiptEvidence } from "@/lib/internalChinaFreightBarcodeCompletion";
import type { InternalChinaMonthlyPurchaseSummary } from "@/lib/internalChinaMonthlyPurchaseSummary";
import type { InternalChinaPurchaseDraft } from "@/lib/internalChinaPurchaseDraft";
import { match1688PaymentQuantities } from "./internalChinaPaymentEvidence.ts";

function barcode(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function money(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Rebuilds the cost draft from the immutable final barcode file quantities and
 * the exact paid CNY lines. This prevents stale reservation/override quantities
 * from becoming receipt or landed-cost truth.
 */
export function buildInternalChinaActualPurchaseCostDraft(input: {
  baseDraft: InternalChinaPurchaseDraft;
  purchase: InternalChinaMonthlyPurchaseSummary;
  barcodeEvidence: InternalChinaFreightBarcodeReceiptEvidence;
}): InternalChinaPurchaseDraft {
  const { baseDraft, purchase, barcodeEvidence } = input;
  if (!purchase.paymentEvidenceHash || purchase.barcodeEvidenceHash !== barcodeEvidence.evidenceHash ||
      purchase.paymentFeeBps === undefined || purchase.worldFirstFeeKrw === undefined ||
      barcodeEvidence.draftId !== baseDraft.draftId ||
      purchase.lines.some(line => !line.assigned || line.draftId !== baseDraft.draftId)) {
    throw new Error("INTERNAL_CHINA_ACTUAL_COST_PAYMENT_EVIDENCE_REQUIRED");
  }
  if (
    purchase.cycleMonth !== barcodeEvidence.cycleMonth ||
    purchase.cycleMonth !== baseDraft.cycleMonth
  ) {
    throw new Error("INTERNAL_CHINA_ACTUAL_COST_CYCLE_CONFLICT");
  }
  match1688PaymentQuantities(
    purchase.lines.map(line => ({ orderNo: line.orderNumber, barcode: line.barcode, quantity: line.quantity })),
    barcodeEvidence.lines,
  );

  const quantityByBarcode = new Map<string, number>();
  for (const line of barcodeEvidence.lines) {
    const code = barcode(line.barcode);
    const quantity = Number(line.quantity);
    if (!code || !Number.isInteger(quantity) || quantity <= 0) {
      throw new Error("INTERNAL_CHINA_ACTUAL_COST_BARCODE_EVIDENCE_INVALID");
    }
    quantityByBarcode.set(code, (quantityByBarcode.get(code) ?? 0) + quantity);
  }

  const costByBarcode = new Map<
    string,
    {
      goodsPaidCny: number;
      domesticChinaFreightCny: number;
      serviceFeeCny: number;
      orderNumbers: Set<string>;
    }
  >();
  for (const line of purchase.lines) {
    const code = barcode(line.barcode);
    if (!quantityByBarcode.has(code)) continue;
    const current = costByBarcode.get(code) ?? {
      goodsPaidCny: 0,
      domesticChinaFreightCny: 0,
      serviceFeeCny: 0,
      orderNumbers: new Set<string>(),
    };
    current.goodsPaidCny += money(line.goodsPaidCny);
    current.domesticChinaFreightCny += money(line.domesticChinaFreightCny);
    current.serviceFeeCny += money(line.serviceFeeCny);
    if (line.orderNumber) current.orderNumbers.add(line.orderNumber);
    costByBarcode.set(code, current);
  }

  const baseByBarcode = new Map(
    baseDraft.lines.map((line) => [barcode(line.barcode), line] as const),
  );
  const lines = [...quantityByBarcode.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([code, quantity]) => {
      const base = baseByBarcode.get(code);
      const cost = costByBarcode.get(code);
      if (!base || !cost) {
        throw new Error(`INTERNAL_CHINA_ACTUAL_COST_LINE_MISSING:${code}`);
      }
      const paidCny =
        cost.goodsPaidCny +
        cost.domesticChinaFreightCny +
        cost.serviceFeeCny;
      if (paidCny <= 0) {
        throw new Error(`INTERNAL_CHINA_ACTUAL_COST_LINE_INVALID:${code}`);
      }
      return {
        ...base,
        quantity,
        unitPriceCny: cost.goodsPaidCny / quantity,
        freightGroupId: `actual-paid:${code}`,
        domesticChinaFreightCny:
          cost.domesticChinaFreightCny + cost.serviceFeeCny,
        orderNumber: [...cost.orderNumbers].sort().join(", "),
      };
    });

  const fx = purchase.exchangeRateKrwPerCny;
  const paidKrw = purchase.actualOrderPaidKrwAtInternalFx;
  return {
    ...baseDraft,
    status: "ORDERED",
    lineCount: lines.length,
    totalQuantity: lines.reduce((sum, line) => sum + line.quantity, 0),
    lines,
    exchangeRateKrwPerCny: fx,
    planningFx: undefined,
    paymentFeeMultiplier: 1 + purchase.paymentFeeBps / 10_000,
    actualOrderPaidKrwAtInternalFx: paidKrw,
    verifiedPayment: {
      evidenceHash: purchase.paymentEvidenceHash,
      goodsKrw: Math.round(purchase.goodsPaidCny * fx),
      domesticFreightKrw: Math.round(purchase.domesticChinaFreightCny * fx),
      serviceFeeKrw: Math.round(purchase.serviceFeeCny * fx),
      paidKrw,
      worldFirstFeeKrw: purchase.worldFirstFeeKrw,
    },
  };
}
