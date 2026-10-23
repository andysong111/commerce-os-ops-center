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
type MonthlySpendScanPage = {
  rows: unknown;
  matchedCount: number | null;
};
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === "string" ? value.normalize("NFKC").trim() : "";
const seoulMonth = (value: unknown) => {
  const parsed = Date.parse(text(value));
  if (!Number.isFinite(parsed)) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit",
  }).formatToParts(new Date(parsed));
  const year = parts.find(part => part.type === "year")?.value ?? "";
  const month = parts.find(part => part.type === "month")?.value ?? "";
  return year && month ? `${year}-${month}` : "";
};

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
    if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(rowMonth)) {
      const observedMonths = [seoulMonth(row.started_at), seoulMonth(row.updated_at)].filter(Boolean);
      if (observedMonths.length === 0 || observedMonths.includes(cycleMonth)) {
        throw new Error("CYCLE_SPEND_ROW_MONTH_UNVERIFIED");
      }
      continue;
    }
    if (rowMonth !== cycleMonth) continue;
    const draftId = text(snapshot.draftId) || text(row.source_event_id);
    if (!draftId) throw new Error("CYCLE_SPEND_DRAFT_ID_MISSING");
    if (drafts.has(draftId)) continue;
    const storedAmount = snapshot.actualOrderPaidKrwAtInternalFx;
    const amount = storedAmount === undefined && text(snapshot.status) === "DRAFT" && snapshot.externalOrderExecuted === false
      ? 0
      : storedAmount;
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

export function combineCompletePurchaseCycleSpendScanPages(
  pages: MonthlySpendScanPage[],
  maximumRows = 20_000,
) {
  if (!Number.isSafeInteger(maximumRows) || maximumRows < 1) {
    throw new Error("CYCLE_SPEND_SCAN_LIMIT_INVALID");
  }
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error("CYCLE_SPEND_SCAN_INCOMPLETE");
  }
  const expectedCount = pages[0]?.matchedCount;
  if (!Number.isSafeInteger(expectedCount) || expectedCount! < 0 || expectedCount! > maximumRows) {
    throw new Error("CYCLE_SPEND_SCAN_INCOMPLETE");
  }
  const rows: MonthlySpendRow[] = [];
  const ids = new Set<string>();
  for (const page of pages) {
    if (page.matchedCount !== expectedCount || !Array.isArray(page.rows)) {
      throw new Error("CYCLE_SPEND_SCAN_CHANGED_DURING_READ");
    }
    for (const value of page.rows) {
      const row = object(value) as MonthlySpendRow;
      const id = text(row.id);
      if (!id || ids.has(id)) throw new Error("CYCLE_SPEND_SCAN_CHANGED_DURING_READ");
      ids.add(id);
      rows.push(row);
    }
  }
  if (rows.length !== expectedCount) throw new Error("CYCLE_SPEND_SCAN_INCOMPLETE");
  return rows;
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

function shiftMonth(month: string, delta: number) {
  purchaseCycleSpendMonthFilter(month);
  const [year, value] = month.split("-").map(Number);
  return new Date(Date.UTC(year, value - 1 + delta, 1)).toISOString().slice(0, 7);
}

export function purchaseBudgetCarryoverBasis(
  cycleMonth: string,
  rows: MonthlySpendRow[],
) {
  purchaseCycleSpendMonthFilter(cycleMonth);
  const snapshots = rows.map((row) => {
    const result = object(row.result_snapshot);
    const nested = object(result.snapshot);
    return {
      snapshot: Object.keys(nested).length
        ? nested
        : Object.keys(result).length
          ? result
          : object(row.input_snapshot),
      sourceEventId: text(row.source_event_id),
    };
  });
  const observedCycleMonths = snapshots
    .map((row) => text(row.snapshot.cycleMonth))
    .filter((month) => /^20\d{2}-(0[1-9]|1[0-2])$/.test(month) && month <= cycleMonth)
    .sort();
  const firstCycleMonth = observedCycleMonths[0] || cycleMonth;
  const accrualStartMonth = shiftMonth(firstCycleMonth, -1);
  const accrualEndMonth = shiftMonth(cycleMonth, -1);
  const accruedBudgetMonths: string[] = [];
  for (let month = accrualStartMonth; month <= accrualEndMonth; month = shiftMonth(month, 1)) {
    accruedBudgetMonths.push(month);
    if (accruedBudgetMonths.length > 120) throw new Error("CYCLE_BUDGET_ACCRUAL_RANGE_INVALID");
  }

  const orderedSpendByDraft = new Map<string, number>();
  for (const row of snapshots) {
    const rowMonth = text(row.snapshot.cycleMonth);
    if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(rowMonth) || rowMonth > cycleMonth) continue;
    const draftId = text(row.snapshot.draftId) || row.sourceEventId;
    if (!draftId || orderedSpendByDraft.has(draftId) || text(row.snapshot.status) !== "ORDERED") continue;
    let amount = Number(row.snapshot.actualOrderPaidKrwAtInternalFx);
    if (!Number.isSafeInteger(amount) && Array.isArray(row.snapshot.lines)) {
      const exchangeRate = Number(row.snapshot.exchangeRateKrwPerCny);
      const multiplier = Number(row.snapshot.internalOrderCostMultiplier);
      let complete = Number.isFinite(exchangeRate) && exchangeRate > 0 &&
        Number.isFinite(multiplier) && multiplier >= 1;
      const cnyTotal = row.snapshot.lines.reduce((total, value) => {
        const line = object(value);
        const quantity = Number(line.quantity);
        const unitPrice = Number(line.unitPriceCny);
        const freight = Number(line.domesticChinaFreightCny ?? 0);
        if (!Number.isInteger(quantity) || quantity < 1 || !Number.isFinite(unitPrice) || unitPrice <= 0 || !Number.isFinite(freight) || freight < 0) {
          complete = false;
          return total;
        }
        return total + quantity * unitPrice + freight;
      }, 0);
      if (complete) amount = Math.round(cnyTotal * exchangeRate * multiplier);
    }
    if (!Number.isSafeInteger(amount) || amount < 0) {
      throw new Error("CYCLE_SPEND_AMOUNT_UNVERIFIED");
    }
    orderedSpendByDraft.set(draftId, amount);
  }
  return {
    accrualStartMonth,
    accrualEndMonth,
    accruedBudgetMonths,
    recordedSpendKrw: [...orderedSpendByDraft.values()].reduce((total, amount) => total + amount, 0),
  };
}

export function purchaseBudgetCarryoverFingerprint(input: {
  monthlyFingerprint: string;
  recordedSpendKrw: number;
  revenues: Array<{ month: string; revenueKrw: number }>;
  accruedGrossBudgetKrw: number;
  availableCashKrw: number;
}) {
  return `sha256:${createHash("sha256").update(JSON.stringify(input)).digest("hex")}`;
}
