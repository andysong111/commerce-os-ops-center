export type MarketSafetyRow = {
  status?: unknown; market_status?: unknown; submit_armed_at?: unknown; reason_code?: unknown;
};
export function marketRowNeedsReview(row: MarketSafetyRow) {
  const status = String(row.status || "");
  const market = String(row.market_status || "");
  if (["sent", "already_registered"].includes(status) || ["sent", "already_registered"].includes(market)) return false;
  return Boolean(row.submit_armed_at)
    || ["confirm_needed", "submit_armed", "legacy_ignored"].includes(status)
    || ["confirm_needed", "submit_armed", "legacy_ignored"].includes(market)
    || /(?:manual_hold|stale_submit|confirm_reconcile|legacy_preflight)/i.test(String(row.reason_code || ""));
}
