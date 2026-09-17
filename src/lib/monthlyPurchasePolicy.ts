import {
  normalizeShoplingOrder,
  type ShoplingRawRow,
} from "./shopling/shoplingNormalize.ts";

const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;

export const PURCHASE_RECOMMENDATION_CADENCE = "MONTHLY" as const;
export const PRICE_GRADE_CADENCE = "DAILY" as const;
export const ABLY_SHOPLING_MALL_KEY = "SMALL_00112" as const;
export const ABLY_FREE_SHIPPING_DEDUCTION_KRW = 3_000;
export const ABLY_BUDGET_POLICY_EFFECTIVE_MONTH = "2026-09" as const;
export const PURCHASE_BUDGET_REVENUE_POLICY_VERSION =
  "ably-free-shipping-v1" as const;

export type CalendarMonthPurchaseBudgetRevenue = {
  month: string;
  grossRevenueKrw: number;
  revenueKrw: number;
  ablyGrossRevenueKrw: number;
  ablyOrderCount: number;
  ablyShippingDeductionKrw: number;
  shippingReservePerAblyOrderKrw: number;
  policyApplied: boolean;
  policyVersion: string;
};

function asDate(value: Date | string) {
  const date = value instanceof Date ? new Date(value.valueOf()) : new Date(value);
  if (!Number.isFinite(date.valueOf())) {
    throw new Error("MONTHLY_PURCHASE_DATE_INVALID");
  }
  return date;
}

export function seoulCalendarMonth(value: Date | string = new Date()) {
  return new Date(asDate(value).valueOf() + SEOUL_OFFSET_MS)
    .toISOString()
    .slice(0, 7);
}

export function previousCalendarMonth(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error("MONTHLY_PURCHASE_MONTH_INVALID");
  }
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 2, 1));
  return date.toISOString().slice(0, 7);
}

export function calendarMonthRange(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error("MONTHLY_PURCHASE_MONTH_INVALID");
  }
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return {
    start: `${month}-01`,
    end: `${month}-${String(lastDay).padStart(2, "0")}`,
  };
}

export function monthlyPurchaseCycleFor(
  value: Date | string = new Date(),
) {
  const cycleMonth = seoulCalendarMonth(value);
  const budgetMonth = previousCalendarMonth(cycleMonth);
  return {
    cycleMonth,
    budgetMonth,
    budgetRange: calendarMonthRange(budgetMonth),
  };
}

export function koreanMonthLabel(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) return month;
  const [year, monthNumber] = month.split("-");
  return `${Number(year)}년 ${Number(monthNumber)}월`;
}

export function validNormalSaleStatus(status: string) {
  const normalized = status.toLowerCase();
  return !["취소", "반품", "환불", "cancel", "return", "refund"].some(
    (keyword) => normalized.includes(keyword),
  );
}

export function purchaseBudgetRevenuePolicyApplies(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error("MONTHLY_PURCHASE_MONTH_INVALID");
  }
  return month >= ABLY_BUDGET_POLICY_EFFECTIVE_MONTH;
}

function rawMallKey(raw: ShoplingRawRow) {
  const direct = raw.mall_key ?? raw.mallKey;
  if (direct !== undefined && direct !== null && direct !== "") {
    return String(direct).normalize("NFKC").trim().toUpperCase();
  }
  const matched = Object.keys(raw).find(
    (key) => key.toLowerCase() === "mall_key" || key.toLowerCase() === "mallkey",
  );
  return matched
    ? String(raw[matched] ?? "").normalize("NFKC").trim().toUpperCase()
    : "";
}

/**
 * Purchase-budget revenue is normal Shopling merchandise revenue with one
 * operating correction: ABLY is sold as free shipping with the shipping charge
 * embedded in the product price. From 2026-09 onward, reserve 3,000 KRW once per
 * unique normal ABLY order before applying the existing 50% purchase budget.
 *
 * Revenue remains line-deduplicated exactly as before. Shipping is order-level,
 * so multiple item rows sharing one ord_no reserve shipping only once.
 */
export function calendarMonthPurchaseBudgetRevenue(
  rows: ShoplingRawRow[],
  month: string,
): CalendarMonthPurchaseBudgetRevenue {
  const policyApplied = purchaseBudgetRevenuePolicyApplies(month);
  const seenLines = new Set<string>();
  const ablyOrders = new Set<string>();
  let grossRevenueKrw = 0;
  let ablyGrossRevenueKrw = 0;

  for (const raw of rows) {
    const order = normalizeShoplingOrder(raw);
    if (!order.id || seenLines.has(order.id)) continue;
    seenLines.add(order.id);
    if (!order.orderNo || !validNormalSaleStatus(order.status)) continue;
    if (!order.orderedAt.slice(0, 7).startsWith(month)) continue;

    const lineRevenueKrw = Math.max(0, Number(order.paidAmount) || 0);
    grossRevenueKrw += lineRevenueKrw;
    if (rawMallKey(raw) === ABLY_SHOPLING_MALL_KEY) {
      ablyGrossRevenueKrw += lineRevenueKrw;
      ablyOrders.add(order.orderNo);
    }
  }

  grossRevenueKrw = Math.max(0, Math.round(grossRevenueKrw));
  ablyGrossRevenueKrw = Math.max(0, Math.round(ablyGrossRevenueKrw));
  const ablyOrderCount = policyApplied ? ablyOrders.size : 0;
  const ablyShippingDeductionKrw =
    ablyOrderCount * ABLY_FREE_SHIPPING_DEDUCTION_KRW;
  const revenueKrw = Math.max(
    0,
    grossRevenueKrw - ablyShippingDeductionKrw,
  );

  return {
    month,
    grossRevenueKrw,
    revenueKrw,
    ablyGrossRevenueKrw,
    ablyOrderCount,
    ablyShippingDeductionKrw,
    shippingReservePerAblyOrderKrw: ABLY_FREE_SHIPPING_DEDUCTION_KRW,
    policyApplied,
    policyVersion: policyApplied
      ? PURCHASE_BUDGET_REVENUE_POLICY_VERSION
      : "legacy-gross-normal-revenue",
  };
}

export function calendarMonthNormalRevenue(
  rows: ShoplingRawRow[],
  month: string,
) {
  return calendarMonthPurchaseBudgetRevenue(rows, month).revenueKrw;
}
