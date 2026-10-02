import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { combineCompletePurchaseCycleSpendScanPages, purchaseCycleSpendMonthFilter, verifiedPurchaseCycleSpend } from "@/lib/purchaseCyclePreflightSpendCore";

const PAGE_SIZE = 500;
const MAXIMUM_ROWS = 20_000;

export async function loadVerifiedPurchaseCycleSpend(cycleMonth: string) {
  purchaseCycleSpendMonthFilter(cycleMonth);
  const admin = await createSupabaseAdminClient();
  if (!admin) throw new Error("CYCLE_SPEND_DATABASE_UNAVAILABLE");
  const pages: Array<{ rows: unknown; matchedCount: number | null }> = [];
  for (let from = 0; from <= MAXIMUM_ROWS; from += PAGE_SIZE) {
    // Filter on the indexed operation columns first. Month extraction happens
    // after a complete scan so unindexed JSON paths cannot time out PostgREST.
    const result = await admin.from("commerce_operation_runs")
      .select("id,source_event_id,input_snapshot,result_snapshot,started_at,updated_at", { count: "exact" })
      .eq("operation_type", "INTERNAL_CHINA_PURCHASE_PREP")
      .eq("status", "SUCCEEDED")
      .order("started_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (result.error) throw new Error("CYCLE_SPEND_READ_FAILED");
    pages.push({ rows: result.data, matchedCount: result.count });
    if (!Number.isSafeInteger(result.count) || result.count! > MAXIMUM_ROWS) {
      throw new Error("CYCLE_SPEND_SCAN_INCOMPLETE");
    }
    const rowCount = Array.isArray(result.data) ? result.data.length : 0;
    if (from + rowCount >= result.count!) break;
    if (rowCount !== PAGE_SIZE) throw new Error("CYCLE_SPEND_SCAN_INCOMPLETE");
  }
  const rows = combineCompletePurchaseCycleSpendScanPages(pages, MAXIMUM_ROWS);
  return verifiedPurchaseCycleSpend(cycleMonth, rows, rows.length, new Date().toISOString());
}
