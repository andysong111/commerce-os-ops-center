const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function seoulDay(timestampMs: number) {
  return Math.floor((timestampMs + SEOUL_OFFSET_MS) / DAY_MS);
}

// Product Master inventory/cost evidence is a content-addressed snapshot.
// Keep that exact snapshot usable through the following Seoul day for the
// internal monthly Draft so an operator review does not expire after 15
// minutes. Any content fingerprint change still invalidates the plan, and
// actual 1688 order/payment remains outside this Draft-only calculation.
export function purchaseInventoryEvidenceFresh(input: {
  generatedAt: string | null | undefined;
  nowMs: number;
}) {
  const observedAt = Date.parse(String(input.generatedAt ?? ""));
  if (!Number.isFinite(observedAt)) return false;
  const ageMs = input.nowMs - observedAt;
  if (ageMs < 0) return false;
  return seoulDay(input.nowMs) - seoulDay(observedAt) <= 1;
}
