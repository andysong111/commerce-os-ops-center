import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { purchaseCycleSpendMonthFilter, verifiedPurchaseCycleSpend } from "@/lib/purchaseCyclePreflightSpendCore";

export async function loadVerifiedPurchaseCycleSpend(cycleMonth: string) {
  const filter = purchaseCycleSpendMonthFilter(cycleMonth);
  const admin = await createSupabaseAdminClient();
  if (!admin) throw new Error("CYCLE_SPEND_DATABASE_UNAVAILABLE");
  const result = await admin.from("commerce_operation_runs")
    .select("source_event_id,input_snapshot,result_snapshot,started_at,updated_at", { count: "exact" })
    .eq("operation_type", "INTERNAL_CHINA_PURCHASE_PREP")
    .eq("status", "SUCCEEDED")
    .or(filter)
    .order("started_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1000);
  if (result.error || !Array.isArray(result.data)) throw new Error("CYCLE_SPEND_READ_FAILED");
  return verifiedPurchaseCycleSpend(cycleMonth, result.data, result.count, new Date().toISOString());
}
