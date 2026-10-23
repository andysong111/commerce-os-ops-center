export type InternalChinaPurchaseOrderSpendLine = {
  quantity: number;
  unitPriceCny: number;
  domesticChinaFreightCny: number;
};

export function calculateInternalChinaOrderedSpendKrw(input: {
  lines: InternalChinaPurchaseOrderSpendLine[];
  exchangeRateKrwPerCny: number;
  internalOrderCostMultiplier: number;
}) {
  if (
    !Number.isFinite(input.exchangeRateKrwPerCny) ||
    input.exchangeRateKrwPerCny <= 0 ||
    !Number.isFinite(input.internalOrderCostMultiplier) ||
    input.internalOrderCostMultiplier <= 0 ||
    input.lines.length === 0
  ) {
    throw new Error("INTERNAL_CHINA_ORDER_SPEND_UNVERIFIED");
  }

  const totalCny = input.lines.reduce((sum, line) => {
    if (
      !Number.isSafeInteger(line.quantity) ||
      line.quantity <= 0 ||
      !Number.isFinite(line.unitPriceCny) ||
      line.unitPriceCny <= 0 ||
      !Number.isFinite(line.domesticChinaFreightCny) ||
      line.domesticChinaFreightCny < 0
    ) {
      throw new Error("INTERNAL_CHINA_ORDER_SPEND_UNVERIFIED");
    }
    return sum + line.unitPriceCny * line.quantity + line.domesticChinaFreightCny;
  }, 0);

  const amountKrw = Math.round(
    totalCny * input.exchangeRateKrwPerCny * input.internalOrderCostMultiplier,
  );
  if (!Number.isSafeInteger(amountKrw) || amountKrw <= 0) {
    throw new Error("INTERNAL_CHINA_ORDER_SPEND_UNVERIFIED");
  }
  return amountKrw;
}
