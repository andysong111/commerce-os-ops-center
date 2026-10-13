export const PURCHASE_SALES_ROLLING_MAX_AGE_MS = 12 * 60 * 60 * 1000;

const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;

function seoulDate(timestampMs: number) {
  return new Date(timestampMs + SEOUL_OFFSET_MS).toISOString().slice(0, 10);
}

// A rolling candidate is ordinarily valid for 12 hours. Once its exact FULL
// snapshot has been read back and verified, the same frozen candidate remains
// usable until the end of that Seoul business day. This prevents a completed
// monthly preparation from expiring while the owner is reviewing it later the
// same day, without carrying yesterday's demand into a new operating day.
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
    seoulDate(observedAt) === seoulDate(input.nowMs);
}
