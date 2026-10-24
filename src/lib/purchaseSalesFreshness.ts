export const PURCHASE_SALES_ROLLING_MAX_AGE_MS = 12 * 60 * 60 * 1000;

const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function seoulDay(timestampMs: number) {
  return Math.floor((timestampMs + SEOUL_OFFSET_MS) / DAY_MS);
}

// A rolling candidate is ordinarily valid for 12 hours. Once its exact FULL
// snapshot has been read back and verified, the same frozen candidate remains
// usable through the following Seoul business day for internal Draft
// preparation. This lets one on-demand purchase-run preparation feed the next
// operator review without running the 360-day sales collection again. A second
// day still requires a refresh, and actual 1688 order/payment remains outside
// this Draft-only gate.
export function purchaseSalesSourceFresh(input: {
  analysisAsOf: string | null | undefined;
  nowMs: number;
  fullReadbackVerified: boolean;
}) {
  const observedAt = Date.parse(String(input.analysisAsOf ?? ""));
  if (!Number.isFinite(observedAt)) return false;
  const ageMs = input.nowMs - observedAt;
  if (ageMs < 0) return false;
  if (ageMs <= PURCHASE_SALES_ROLLING_MAX_AGE_MS) return true;
  return input.fullReadbackVerified &&
    seoulDay(input.nowMs) - seoulDay(observedAt) <= 1;
}
