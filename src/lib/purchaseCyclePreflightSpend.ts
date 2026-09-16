import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { purchaseCycleSpendMonthColumns, purchaseCycleSpendMonthFilter, verifiedPurchaseCycleSpendPages } from "@/lib/purchaseCyclePreflightSpendCore";

export async function loadVerifiedPurchaseCycleSpend(cycleMonth: string) {
  purchaseCycleSpendMonthFilter(cycleMonth);
  const admin = await createSupabaseAdminClient();
  if (!admin) throw new Error("CYCLE_SPEND_DATABASE_UNAVAILABLE");
  // The project's REST adapter has eq(), not Supabase SDK or(). Keep the shared
  // transport unchanged and prove completeness for each historical shape.
  const results = await Promise.all(purchaseCycleSpendMonthColumns.map(column => admin.from("commerce_operation_runs")
    .select("id,source_event_id,input_snapshot,result_snapshot,started_at,updated_at", { count: "exact" })
    .eq("operation_type", "INTERNAL_CHINA_PURCHASE_PREP")
    .eq("status", "SUCCEEDED")
    .eq(column, cycleMonth)
    .order("started_at", { ascending: false })
    .limit(1000)));
  if (results.some(result => result.error)) throw new Error("CYCLE_SPEND_READ_FAILED");
  return verifiedPurchaseCycleSpendPages(cycleMonth, results.map(result => ({ rows: result.data, matchedCount: result.count })), new Date().toISOString());
}
