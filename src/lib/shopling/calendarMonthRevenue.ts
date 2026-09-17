import {
  ABLY_FREE_SHIPPING_DEDUCTION_KRW,
  PURCHASE_BUDGET_REVENUE_POLICY_VERSION,
  calendarMonthPurchaseBudgetRevenue,
  calendarMonthRange,
  purchaseBudgetRevenuePolicyApplies,
  seoulCalendarMonth,
} from "@/lib/monthlyPurchasePolicy";
import {
  ShoplingReadClient,
  shoplingReadConfigFromEnv,
  splitShoplingDateRange,
} from "@/lib/shopling/shoplingReadClient";
import type { ShoplingRawRow } from "@/lib/shopling/shoplingNormalize";
import {
  createSupabaseAdminClient,
  createSupabaseAdminHeaders,
} from "@/lib/supabase/admin";

export const SHOPLING_CALENDAR_MONTH_REVENUE_OPERATION =
  "SHOPLING_CALENDAR_MONTH_REVENUE";

function shoplingEnvironment() {
  return {
    SHOPLING_LOGIN_ID: process.env.SHOPLING_LOGIN_ID,
    SHOPLING_COMPANY_ID: process.env.SHOPLING_COMPANY_ID,
    SHOPLING_API_AUTH_KEY: process.env.SHOPLING_API_AUTH_KEY,
    SHOPLING_PRODUCTS_API_URL: process.env.SHOPLING_PRODUCTS_API_URL,
    SHOPLING_ORDERS_API_URL: process.env.SHOPLING_ORDERS_API_URL,
    SHOPLING_CLAIMS_API_URL: process.env.SHOPLING_CLAIMS_API_URL,
  };
}

export function calendarMonthRevenueSourceEventId(month: string) {
  return purchaseBudgetRevenuePolicyApplies(month)
    ? `shopling-calendar-month-revenue:${PURCHASE_BUDGET_REVENUE_POLICY_VERSION}:${month}`
    : `shopling-calendar-month-revenue:${month}`;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nonnegativeInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function closedCalendarMonth(month: string) {
  return month < seoulCalendarMonth();
}

async function readCached(month: string) {
  // Current/future months must remain live. Only a completed calendar month may
  // become the immutable funding basis for the next purchase cycle.
  if (!closedCalendarMonth(month)) return null;
  const admin = await createSupabaseAdminClient();
  if (!admin) return null;
  const result = await admin
    .from("commerce_operation_runs")
    .select("result_snapshot,started_at")
    .eq("operation_type", SHOPLING_CALENDAR_MONTH_REVENUE_OPERATION)
    .eq("source_event_id", calendarMonthRevenueSourceEventId(month))
    .eq("status", "SUCCEEDED")
    .maybeSingle();
  if (result.error || !result.data || typeof result.data !== "object") {
    return null;
  }
  const row = result.data as {
    result_snapshot?: unknown;
    started_at?: unknown;
  };
  const snapshot = object(row.result_snapshot);
  if (String(snapshot.month ?? "") !== month) return null;

  const policyApplied = purchaseBudgetRevenuePolicyApplies(month);
  if (
    policyApplied &&
    (snapshot.policyApplied !== true ||
      String(snapshot.budgetRevenuePolicyVersion ?? "") !==
        PURCHASE_BUDGET_REVENUE_POLICY_VERSION ||
      nonnegativeInteger(snapshot.shippingReservePerAblyOrderKrw) !==
        ABLY_FREE_SHIPPING_DEDUCTION_KRW)
  ) {
    return null;
  }

  const revenueKrw = nonnegativeInteger(snapshot.revenueKrw);
  const range = calendarMonthRange(month);
  return {
    month,
    range,
    grossRevenueKrw: policyApplied
      ? nonnegativeInteger(snapshot.grossRevenueKrw)
      : revenueKrw,
    revenueKrw,
    ablyGrossRevenueKrw: nonnegativeInteger(snapshot.ablyGrossRevenueKrw),
    ablyOrderCount: nonnegativeInteger(snapshot.ablyOrderCount),
    ablyShippingDeductionKrw: nonnegativeInteger(
      snapshot.ablyShippingDeductionKrw,
    ),
    shippingReservePerAblyOrderKrw: policyApplied
      ? ABLY_FREE_SHIPPING_DEDUCTION_KRW
      : 0,
    policyApplied,
    budgetRevenuePolicyVersion: policyApplied
      ? PURCHASE_BUDGET_REVENUE_POLICY_VERSION
      : "legacy-gross-normal-revenue",
    fetchedRows: nonnegativeInteger(snapshot.fetchedRows),
    chunkCount: nonnegativeInteger(snapshot.chunkCount),
    cached: true,
    frozenAt: String(snapshot.frozenAt ?? row.started_at ?? "") || null,
  };
}

async function storeCached(input: {
  month: string;
  range: { start: string; end: string };
  grossRevenueKrw: number;
  revenueKrw: number;
  ablyGrossRevenueKrw: number;
  ablyOrderCount: number;
  ablyShippingDeductionKrw: number;
  shippingReservePerAblyOrderKrw: number;
  policyApplied: boolean;
  budgetRevenuePolicyVersion: string;
  fetchedRows: number;
  chunkCount: number;
}) {
  if (!closedCalendarMonth(input.month)) return null;
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const secret = (
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  )?.trim();
  if (!baseUrl || !secret) return null;
  const now = new Date().toISOString();
  await fetch(
    `${baseUrl}/rest/v1/commerce_operation_runs?on_conflict=source_event_id&select=source_event_id`,
    {
      method: "POST",
      headers: {
        ...createSupabaseAdminHeaders(secret),
        Prefer: "resolution=ignore-duplicates,return=representation",
      },
      body: JSON.stringify([
        {
          operation_type: SHOPLING_CALENDAR_MONTH_REVENUE_OPERATION,
          status: "SUCCEEDED",
          source: "shopling-read-api",
          source_event_id: calendarMonthRevenueSourceEventId(input.month),
          correlation_id: `monthly-purchase-budget:${input.month}`,
          actor_type: "OPS_WORKER",
          input_snapshot: {
            month: input.month,
            range: input.range,
            budgetRevenuePolicyVersion: input.budgetRevenuePolicyVersion,
          },
          result_snapshot: {
            ...input,
            frozenAt: now,
            calendarMonthFrozen: true,
          },
          error_message: null,
          started_at: now,
          finished_at: now,
          updated_at: now,
        },
      ]),
      cache: "no-store",
    },
  ).catch(() => null);
  return now;
}

/**
 * Closed calendar-month revenue is frozen once for the next purchase cycle.
 * Starting with September 2026, ABLY free-shipping reserve is removed before
 * the existing revenue / 2 purchase budget is calculated. Open months remain
 * live and are never cached as final funding evidence.
 */
export async function loadCalendarMonthNormalRevenue(month: string) {
  const cached = await readCached(month);
  if (cached) return cached;

  const range = calendarMonthRange(month);
  const config = shoplingReadConfigFromEnv(shoplingEnvironment());
  const client = new ShoplingReadClient(config);
  const chunks = splitShoplingDateRange(range.start, range.end, 7);
  const allRows: ShoplingRawRow[] = [];
  for (const chunk of chunks) {
    const rows = await client.read("orders", chunk);
    allRows.push(...(rows as ShoplingRawRow[]));
  }
  const budgetRevenue = calendarMonthPurchaseBudgetRevenue(allRows, month);
  const result = {
    month,
    range,
    grossRevenueKrw: budgetRevenue.grossRevenueKrw,
    revenueKrw: budgetRevenue.revenueKrw,
    ablyGrossRevenueKrw: budgetRevenue.ablyGrossRevenueKrw,
    ablyOrderCount: budgetRevenue.ablyOrderCount,
    ablyShippingDeductionKrw: budgetRevenue.ablyShippingDeductionKrw,
    shippingReservePerAblyOrderKrw:
      budgetRevenue.shippingReservePerAblyOrderKrw,
    policyApplied: budgetRevenue.policyApplied,
    budgetRevenuePolicyVersion: budgetRevenue.policyVersion,
    fetchedRows: allRows.length,
    chunkCount: chunks.length,
    cached: false,
    frozenAt: null as string | null,
  };
  result.frozenAt = await storeCached(result);
  return result;
}
