import { createHash } from "node:crypto";
import type { PurchaseMonthlySpendPin } from "./purchaseCyclePreflightCore";

type MonthlySpendRow = {
  id?: unknown;
  source_event_id?: unknown;
  input_snapshot?: unknown;
  result_snapshot?: unknown;
  started_at?: unknown;
  updated_at?: unknown;
};
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === "string" ? value.normalize("NFKC").trim() : "";

export const purchaseCycleSpendMonthColumns = ["result_snapshot->snapshot->>cycleMonth", "result_snapshot->>cycleMonth", "input_snapshot->>cycleMonth"] as const;

export function purchaseCycleSpendMonthFilter(cycleMonth: string) {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(cycleMonth)) throw new Error("CYCLE_SPEND_MONTH_INVALID");
  // All three historical storage shapes are queried BEFORE any row limit.
  return purchaseCycleSpendMonthColumns.map(column => `${column}.eq.${cycleMonth}`).join(",");
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

export function verifiedPurchaseCycleSpendPages(
  cycleMonth: string,
  pages: Array<{ rows: unknown; matchedCount: number | null }>,
  readAt: string,
): PurchaseMonthlySpendPin {
  if (pages.length !== purchaseCycleSpendMonthColumns.length) throw new Error("CYCLE_SPEND_SHAPE_MISSING");
  const byId = new Map<string, MonthlySpendRow>();
  for (const page of pages) {
    if (!Array.isArray(page.rows) || !Number.isSafeInteger(page.matchedCount) || page.matchedCount !== page.rows.length) throw new Error("CYCLE_SPEND_SCAN_INCOMPLETE");
    for (const value of page.rows) {
      const row = object(value) as MonthlySpendRow;
      const id = text(row.id);
      if (!id || !Number.isFinite(Date.parse(text(row.started_at)))) throw new Error("CYCLE_SPEND_ROW_IDENTITY_UNVERIFIED");
      const previous = byId.get(id);
      if (previous && JSON.stringify(previous) !== JSON.stringify(row)) throw new Error("CYCLE_SPEND_ROW_CHANGED_DURING_READ");
      byId.set(id, row);
    }
  }
  // Deduplicate overlapping storage-shape reads and sort once; the project's
  // REST adapter overwrites repeated order() calls instead of appending them.
  const rows = [...byId.values()].sort((a, b) => Date.parse(text(b.started_at)) - Date.parse(text(a.started_at)) || text(b.id).localeCompare(text(a.id)));
  return verifiedPurchaseCycleSpend(cycleMonth, rows, rows.length, readAt);
}
