export type InternalChinaPurchaseCostLine = {
  quantity: number;
  unitPriceCny: number;
  domesticChinaFreightCny: number;
};

export type InternalChinaPurchaseCostSummary = {
  productCny: number;
  domesticChinaAdjustmentCny: number;
  productCostKrwExact: number;
  domesticChinaAdjustmentKrwExact: number;
  actualOrderCostKrwExact: number;
  internalBaseCostKrwExact: number;
  productCostKrw: number;
  domesticChinaAdjustmentKrw: number;
  actualOrderCostKrw: number;
  internalBaseCostKrw: number;
  actualPriceCount: number;
};

function nonNegative(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function signed(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundedKrw(value: number) {
  return Math.max(0, Math.round(value));
}

/**
 * Canonical final-order calculator shared by the upper budget audit and the
 * lower order workspace. Keep full precision until the final KRW display so
 * quantity-level rounding cannot make the two sections disagree.
 */
export function calculateInternalChinaPurchaseCostSummary(input: {
  lines: InternalChinaPurchaseCostLine[];
  exchangeRateKrwPerCny: number;
  internalOrderCostMultiplier: number;
}): InternalChinaPurchaseCostSummary {
  const exchangeRateKrwPerCny = nonNegative(input.exchangeRateKrwPerCny);
  const internalOrderCostMultiplier = nonNegative(input.internalOrderCostMultiplier);
  let productCny = 0;
  let domesticChinaAdjustmentCny = 0;
  let actualPriceCount = 0;

  for (const line of input.lines) {
    const quantity = nonNegative(line.quantity);
    const unitPriceCny = nonNegative(line.unitPriceCny);
    productCny += quantity * unitPriceCny;
    domesticChinaAdjustmentCny += signed(line.domesticChinaFreightCny);
    if (unitPriceCny > 0) actualPriceCount += 1;
  }

  const productCostKrwExact = productCny * exchangeRateKrwPerCny;
  const domesticChinaAdjustmentKrwExact =
    domesticChinaAdjustmentCny * exchangeRateKrwPerCny;
  const actualOrderCostKrwExact = Math.max(
    0,
    productCostKrwExact + domesticChinaAdjustmentKrwExact,
  );
  const internalBaseCostKrwExact =
    actualOrderCostKrwExact * internalOrderCostMultiplier;

  return {
    productCny,
    domesticChinaAdjustmentCny,
    productCostKrwExact,
    domesticChinaAdjustmentKrwExact,
    actualOrderCostKrwExact,
    internalBaseCostKrwExact,
    productCostKrw: roundedKrw(productCostKrwExact),
    domesticChinaAdjustmentKrw: Math.round(domesticChinaAdjustmentKrwExact),
    actualOrderCostKrw: roundedKrw(actualOrderCostKrwExact),
    internalBaseCostKrw: roundedKrw(internalBaseCostKrwExact),
    actualPriceCount,
  };
}
