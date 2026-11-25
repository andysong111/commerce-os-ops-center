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
  paymentFeeKrwExact: number;
  actualOrderCostKrwExact: number;
  internalBaseCostKrwExact: number;
  productCostKrw: number;
  domesticChinaAdjustmentKrw: number;
  paymentFeeKrw: number;
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

export function allocatedLandedUnitCostKrw(
  productUnitKrw: number,
  freightPerUnitKrw: number,
  paymentFeeMultiplier: number,
  landedMultiplier: number,
) {
  const preFeeUnitKrw = Math.max(0, productUnitKrw + freightPerUnitKrw);
  return Math.max(1, Math.round(preFeeUnitKrw * paymentFeeMultiplier * landedMultiplier));
}

/**
 * Canonical final-order calculator shared by the upper budget audit and the
 * lower order workspace. Keep full precision until the final KRW display so
 * quantity-level rounding cannot make the two sections disagree.
 */
export function calculateInternalChinaPurchaseCostSummary(input: {
  lines: InternalChinaPurchaseCostLine[];
  exchangeRateKrwPerCny: number;
  paymentFeeMultiplier: number;
  internalOrderCostMultiplier: number;
}): InternalChinaPurchaseCostSummary {
  const exchangeRateKrwPerCny = nonNegative(input.exchangeRateKrwPerCny);
  const paymentFeeMultiplier = Math.max(1, nonNegative(input.paymentFeeMultiplier));
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
  const preFeeOrderCostKrwExact = Math.max(
    0,
    productCostKrwExact + domesticChinaAdjustmentKrwExact,
  );
  const actualOrderCostKrwExact =
    preFeeOrderCostKrwExact * paymentFeeMultiplier;
  const paymentFeeKrwExact =
    actualOrderCostKrwExact - preFeeOrderCostKrwExact;
  const internalBaseCostKrwExact =
    actualOrderCostKrwExact * internalOrderCostMultiplier;

  return {
    productCny,
    domesticChinaAdjustmentCny,
    productCostKrwExact,
    domesticChinaAdjustmentKrwExact,
    paymentFeeKrwExact,
    actualOrderCostKrwExact,
    internalBaseCostKrwExact,
    productCostKrw: roundedKrw(productCostKrwExact),
    domesticChinaAdjustmentKrw: Math.round(domesticChinaAdjustmentKrwExact),
    paymentFeeKrw: roundedKrw(paymentFeeKrwExact),
    actualOrderCostKrw: roundedKrw(actualOrderCostKrwExact),
    internalBaseCostKrw: roundedKrw(internalBaseCostKrwExact),
    actualPriceCount,
  };
}
