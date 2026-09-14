import { randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { SalesEventActionError } from "@/lib/salesEventRefreshPolicy";

// Shared by ALL request creators/recovery and the gated canary/full route.
// DB lease is 10 minutes; the longest caller is a 300-second Vercel function.
// No process-local mutex, no retries after an ambiguous RPC result.
export async function withSalesEventMutationGuard<T>(work: () => Promise<T>): Promise<T> {
  const admin = await createSupabaseAdminClient();
  if (!admin) throw new SalesEventActionError("SALES_EVENT_LOCK_UNAVAILABLE", 503, "판매 후보 작업 잠금 저장소가 준비되지 않았습니다.");
  const token = randomUUID();
  const claim = await admin.rpc("claim_sales_event_mutation_lock", { p_token: token }).catch(() => ({ data: null, error: { message: "LOCK_RPC_FAILED" } }));
  if (claim.error || (claim.data !== true && claim.data !== false)) {
    throw new SalesEventActionError("SALES_EVENT_LOCK_UNAVAILABLE", 503, "판매 후보 작업 잠금을 확인하지 못했습니다. 잠시 후 다시 확인하세요.");
  }
  if (claim.data !== true) {
    throw new SalesEventActionError("SALES_EVENT_MUTATION_BUSY", 409, "판매 후보 수집·복구·원장 반영 중입니다. 완료 후 화면을 새로고침하세요.");
  }
  try {
    return await work();
  } finally {
    // Do not report a committed request as failed merely because release failed.
    // Ownership is token-checked; an unavailable release safely expires in DB.
    try {
      const release = await admin.rpc("release_sales_event_mutation_lock", { p_token: token });
      if (release.error || release.data !== true) console.warn("SALES_EVENT_LOCK_RELEASE_PENDING_EXPIRY");
    } catch {
      console.warn("SALES_EVENT_LOCK_RELEASE_PENDING_EXPIRY");
    }
  }
}
