import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { MONTHLY_PRICE_POLICY, type MonthlyPriceCandidate, type MonthlyPricePlan } from "@/lib/monthlyPriceCore";
import type { MonthlyPriceSources } from "@/lib/monthlyPriceSource";

export type MonthlyItemState = "QUEUED" | "PREPARED" | "WRITING" | "VERIFY_PENDING" | "VERIFIED" | "RESENDING" | "TRANSMITTED" | "HELD" | "BLOCKED" | "UNCERTAIN";
export type MonthlyPriceItem = { id: string; run_id: string; goods_key: string; state: MonthlyItemState; candidate: MonthlyPriceCandidate; plan: MonthlyPricePlan | null; write_index: number; claim_token: string | null; claim_until: string | null; error_code: string | null; transmission: { token: string; fingerprint: string; claimedAt: string; finishedAt?: string; result?: string } | null; updated_at: string };
export type MonthlyPriceRun = { id: string; cycle_month: string; source_hash: string; policy_version: string; source_snapshot: MonthlyPriceSources; created_at: string };
export async function monthlyDb() {
  const db = await createSupabaseAdminClient();
  if (!db) throw new Error("MONTHLY_PRICE_DATABASE_REQUIRED");
  return db;
}
function fail(error: unknown) { if (error) throw new Error("MONTHLY_PRICE_STORE_FAILED"); }
export async function loadMonthlyPriceRun(runId: string) {
  const db = await monthlyDb();
  const result = await db.from("commerce_monthly_price_runs").select("*").eq("id", runId).single();
  fail(result.error); return result.data as MonthlyPriceRun;
}
export async function loadMonthlyPriceStatus(month: string) {
  const db = await monthlyDb();
  const result = await db.from("commerce_monthly_price_runs").select("*").eq("cycle_month", month).eq("policy_version", MONTHLY_PRICE_POLICY).order("created_at", { ascending: false }).limit(1).maybeSingle();
  fail(result.error);
  if (!result.data) return { run: null, items: [] as MonthlyPriceItem[] };
  return loadMonthlyPriceRunStatus(result.data as MonthlyPriceRun);
}
export async function loadMonthlyPriceRunStatus(run: MonthlyPriceRun) {
  const db = await monthlyDb();
  const result = await db.from("commerce_monthly_price_items").select("*").eq("run_id", run.id).order("goods_key").limit(1001);
  fail(result.error);
  const items = (result.data ?? []) as MonthlyPriceItem[];
  if (items.length > 1000) throw new Error("MONTHLY_PRICE_ITEM_LIMIT_EXCEEDED");
  return { run, items };
}
export async function createMonthlyPriceRun(source: MonthlyPriceSources) {
  if (!source.candidates.length || source.candidates.length > 1000) throw new Error("MONTHLY_PRICE_CANDIDATE_SCOPE_INVALID");
  // Do not strand a pending transmission when a new receipt/source revision
  // appears. Finish/check the immutable older run before creating a replacement.
  const previous = await loadMonthlyPriceStatus(source.month);
  if (previous.run && previous.run.source_hash !== source.sourceHash && previous.items.some((item) => !["BLOCKED", "HELD", "TRANSMITTED"].includes(item.state))) return previous;
  const db = await monthlyDb();
  const result = await db.from("commerce_monthly_price_runs").upsert({ cycle_month: source.month, policy_version: MONTHLY_PRICE_POLICY, source_hash: source.sourceHash, source_snapshot: source }, { onConflict: "cycle_month,policy_version,source_hash", ignoreDuplicates: true });
  fail(result.error);
  const stored = await db.from("commerce_monthly_price_runs").select("*").eq("cycle_month", source.month).eq("policy_version", MONTHLY_PRICE_POLICY).eq("source_hash", source.sourceHash).single();
  fail(stored.error);
  const run = stored.data as MonthlyPriceRun;
  const items = await db.from("commerce_monthly_price_items").upsert(source.candidates.map((candidate) => ({ run_id: run.id, goods_key: candidate.goodsKey, candidate, state: candidate.reason ? "BLOCKED" : "QUEUED", error_code: candidate.reason })), { onConflict: "run_id,goods_key", ignoreDuplicates: true });
  fail(items.error);
  const status = await loadMonthlyPriceRunStatus(run);
  for (const item of status.items) {
    if (item.state !== "BLOCKED" || item.candidate.reason || item.write_index !== 0) continue;
    // Only an explicit new click may retry a pre-write failure. Lease/CAS guards
    // prevent resetting another tab's in-flight item; unknown writes never reset.
    await withMonthlyPriceItem(item.id, run.id, async (locked) => {
      if (locked.state !== "BLOCKED" || locked.write_index !== 0 || locked.candidate.reason) return;
      locked.state = "QUEUED"; locked.plan = null; locked.error_code = null;
      await auditMonthlyPrice(locked, "EXPLICIT_PREFLIGHT_RETRY", {});
    });
  }
  return loadMonthlyPriceRunStatus(run);
}
export async function claimMonthlyPriceItem(id: string) {
  const db = await monthlyDb();
  const result = await db.rpc("claim_monthly_price_item", { p_item_id: id });
  if (result.error) {
    const message = result.error.message;
    throw new Error(/MONTHLY_PRICE_[A-Z_]+/.exec(message)?.[0] || "MONTHLY_PRICE_CLAIM_FAILED");
  }
  const item = result.data?.[0] as MonthlyPriceItem | undefined;
  if (!item?.claim_token) throw new Error("MONTHLY_PRICE_CLAIM_FAILED");
  return item;
}
export async function saveMonthlyPriceItem(item: MonthlyPriceItem, release = false) {
  const db = await monthlyDb();
  const now = new Date().toISOString();
  const result = await db.from("commerce_monthly_price_items").update({ state: item.state, plan: item.plan, write_index: item.write_index, error_code: item.error_code, transmission: item.transmission, claim_until: release ? null : item.claim_until, claim_token: release ? null : item.claim_token, updated_at: now }).eq("id", item.id).eq("claim_token", item.claim_token!).select("id");
  fail(result.error);
  if (result.data?.length !== 1) throw new Error("MONTHLY_PRICE_LEASE_LOST");
  item.updated_at = now;
}
export async function auditMonthlyPrice(item: MonthlyPriceItem, event: string, evidence: unknown) {
  const db = await monthlyDb();
  const result = await db.from("commerce_monthly_price_audit").insert({ item_id: item.id, event, evidence });
  fail(result.error);
}
export async function withMonthlyPriceItem<T>(id: string, runId: string, work: (item: MonthlyPriceItem, run: MonthlyPriceRun) => Promise<T>) {
  const item = await claimMonthlyPriceItem(id);
  try {
    if (item.run_id !== runId) throw new Error("MONTHLY_PRICE_ITEM_SCOPE_INVALID");
    const run = await loadMonthlyPriceRun(item.run_id);
    if (run.policy_version !== MONTHLY_PRICE_POLICY) throw new Error("MONTHLY_PRICE_POLICY_STALE");
    return await work(item, run);
  } finally {
    // A timeout before release retains a short lease. WRITING is persisted before
    // I/O; an expired lease never means the external write is safe to repeat.
    await saveMonthlyPriceItem(item, true);
  }
}
