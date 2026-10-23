import {
  normalizeCompletedCalendarMonthSales,
  type CalendarMonthSales,
} from "./purchaseStrategyPolicy.ts";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function quantity(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

export function planningCalendarMonthlySales(
  value: unknown,
): CalendarMonthSales[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("PURCHASE_STRATEGY_MONTHLY_SALES_INVALID");
    }
    const row = item as Record<string, unknown>;
    return {
      month: text(row.month),
      units: quantity(row.quantity ?? row.units),
      revenue: quantity(row.revenue),
    };
  });
}

/**
 * Product Master's canonical salesMonthly ledger is the source of truth for
 * completed calendar-month strategy. purchaseStrategyMonthly is retained as a
 * compatibility fallback for snapshots that predate the canonical ledger
 * field. The fallback stays strict so an incomplete compatibility payload
 * cannot silently turn missing months into zero sales.
 */
export function planningCompletedCalendarMonthlySales(
  purchaseStrategyValue: unknown,
  asOf: string,
  canonicalSalesValue?: unknown,
) {
  const canonicalRows = planningCalendarMonthlySales(canonicalSalesValue);
  if (canonicalRows.length > 0) {
    return normalizeCompletedCalendarMonthSales(canonicalRows, asOf);
  }

  const rows = planningCalendarMonthlySales(purchaseStrategyValue);
  const expected = normalizeCompletedCalendarMonthSales(rows, asOf);
  const suppliedMonths = new Set(rows.map((row) => row.month));
  if (
    rows.length !== 12 ||
    suppliedMonths.size !== 12 ||
    expected.some((row) => !suppliedMonths.has(row.month))
  ) {
    throw new Error("PURCHASE_STRATEGY_MONTHLY_HISTORY_INCOMPLETE");
  }
  return expected;
}
