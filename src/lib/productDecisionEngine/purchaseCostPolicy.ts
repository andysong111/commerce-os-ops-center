// Owner-approved policies are deliberately separate:
// - landed-cost multiplier: estimated forwarding/import/arrival cost to Korea
// - payment-fee multiplier: cash/payment processing cost at supplier payment time
export const DEFAULT_PURCHASE_COST_MULTIPLIER = 1.5;
export const WORLDFIRST_KUAJINGBAO_FEE_BPS = 80;
export const DEFAULT_PAYMENT_FEE_MULTIPLIER =
  1 + WORLDFIRST_KUAJINGBAO_FEE_BPS / 10_000;

export function worldFirstFeeAtInternalFx(paidKrw: number) {
  return Math.round(paidKrw * WORLDFIRST_KUAJINGBAO_FEE_BPS / 10_000);
}

export function worldFirstFeeLabel(multiplier = DEFAULT_PAYMENT_FEE_MULTIPLIER) {
  const percent = Number(((multiplier - 1) * 100).toFixed(3));
  return multiplier === DEFAULT_PAYMENT_FEE_MULTIPLIER
    ? `월드퍼스트 콰징바오 수수료 ${percent}%`
    : `저장 당시 결제수수료 ${percent}%`;
}
