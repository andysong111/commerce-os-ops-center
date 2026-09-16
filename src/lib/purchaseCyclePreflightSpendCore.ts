import { createHash } from "node:crypto";
import type { PurchaseMonthlySpendPin } from "./purchaseCyclePreflightCore";

type MonthlySpendRow = {
  source_event_id?: unknown;
  input_snapshot?: unknown;
  result_snapshot?: unknown;
  started_at?: unknown;
  updated_at?: unknown;
};
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === "string" ? value.normalize("NFKC").trim() : "";

export function purchaseCycleSpendMonthFilter(cycleMonth: string) {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(cycleMonth)) throw new Error("CYCLE_SPEND_MONTH_INVALID");
  // All three historical storage shapes are queried BEFORE any row limit.
  return [`result_snapshot->snapshot->>cycleMonth.eq.${cycleMonth}`, `result_snapshot->>cycleMonth.eq.${cycleMonth}`, `input_snapshot->>cycleMonth.eq.${cycleMonth}`].join(",");
}

export function verifiedPurchaseCycleSpend(
  cycleMonth: string,
  rows: MonthlySpendRow[],
  matchedCount: number | null,
  readAt: string,
): PurchaseMonthlySpendPin {
  purchaseCycleSpendMonthFilter(cycleMonth);
  if (!Number.isFinite(Date.parse(readAt))) throw new Error("CYCLE_SPEND_TIME_INVALID");
  // A bounded page, absent exact count, or silently truncated response cannot
  // establish either zero spend or the amount already paid in this month.
  if (!Array.isArray(rows) || !Number.isSafeInteger(matchedCount) || matchedCount! < 0 || matchedCount !== rows.length) {
    throw new Error("CYCLE_SPEND_SCAN_INCOMPLETE");
  }
  const drafts = new Map<string, number>();
  for (const row of rows) {
    const result = object(row.result_snapshot);
    const nested = object(result.snapshot);
    const snapshot = Object.keys(nested).length ? nested : Object.keys(result).length ? result : object(row.input_snapshot);
    const rowMonth = text(snapshot.cycleMonth);
    // The OR query can also match a superseded input snapshot; only the same
    // authoritative snapshot precedence as the existing summary is consumed.
    if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(rowMonth)) throw new Error("CYCLE_SPEND_ROW_MONTH_UNVERIFIED");
    if (rowMonth !== cycleMonth) continue;
    const draftId = text(snapshot.draftId) || text(row.source_event_id);
    if (!draftId) throw new Error("CYCLE_SPEND_DRAFT_ID_MISSING");
    if (drafts.has(draftId)) continue;
    const amount = snapshot.actualOrderPaidKrwAtInternalFx;
    if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0) {
      // Do not guess from quantity, selling prices, implicit FX or a malformed
      // snapshot. A verified recorded amount is needed, including explicit 0.
      throw new Error("CYCLE_SPEND_AMOUNT_UNVERIFIED");
    }
    drafts.set(draftId, amount);
  }
  const recordedSpendKrw = [...drafts.values()].reduce((total, amount) => {
    const next = total + amount;
    if (!Number.isSafeInteger(next)) throw new Error("CYCLE_SPEND_AMOUNT_OVERFLOW");
    return next;
  }, 0);
  return {
    cycleMonth, readAt, recordedSpendKrw,
    contentFingerprint: `sha256:${createHash("sha256").update(JSON.stringify({ cycleMonth, matchedCount, rows })).digest("hex")}`,
  };
}
