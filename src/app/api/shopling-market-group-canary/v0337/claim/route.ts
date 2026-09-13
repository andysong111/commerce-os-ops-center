import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { marketRowNeedsReview } from "@/lib/shoplingMarketSafety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const BRIDGE = "shopling-market-selection-all-v0.1";
const TABLE = "shopling_market_pipeline_ledger";
const CHANNELS: Record<string, [string, string]> = {
  wholesale1: ["DM1", "도매1"], wholesale2: ["DM2", "도매2"], wholesale3: ["DM3", "도매3"],
  wholesale4: ["DM4", "도매4"], retail1: ["SM1", "소매1"], retail2: ["SM2", "소매2"],
};
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown) { return String(value ?? "").trim(); }
function task(raw: unknown) {
  const row = record(raw), mapping = CHANNELS[text(row.product_group_key)];
  if (!mapping) return null;
  return { goodsKey: text(row.goods_key), launchItemId: text(row.launch_item_id), modelNumber: text(row.model_number),
    productGroupKey: text(row.product_group_key), searchCode: mapping[0], profile: mapping[1],
    ptnGoodsCd: text(row.ptn_goods_cd), registeredAt: text(row.registry_registered_at), claimEpoch: text(row.claimed_at) };
}
export async function POST(request: Request) {
  const body = record(await request.json().catch(() => null));
  const runId = text(body.runId), jobId = text(body.jobId);
  if (body.bridge !== BRIDGE || !/^canary-group-v030-[A-Za-z0-9._:-]{12,150}$/.test(runId) || runId.includes("-diagnostic-") || !/^[0-9a-f-]{36}$/i.test(jobId)) {
    return Response.json({ ok: false, error: "invalid_safe_market_claim" }, { status: 400 });
  }
  const db = await createSupabaseAdminClient();
  if (!db) return Response.json({ ok: false, error: "supabase_admin_unavailable" }, { status: 503 });
  const jobResult = await db.from("product_launch_upload_jobs").select("id,owner_id,launch_item_id,status,payload,result").eq("id", jobId).limit(1).maybeSingle();
  if (jobResult.error || !jobResult.data) return Response.json({ ok: false, error: "safe_claim_job_unavailable" }, { status: 409 });
  const job = record(jobResult.data), payload = record(job.payload);
  if (job.status !== "success" || !text(record(payload.seoFinal).source).startsWith("seo-bulk-cloud")) return Response.json({ ok: false, error: "safe_claim_upload_not_ready" }, { status: 409 });
  const source = record(job.result).rows;
  const rows = (Array.isArray(source) ? source : []).map(record).filter((row) => row.status === "success");
  const keys = rows.map((row) => text(row.goods_key || row.goodsKey));
  if (rows.length !== 6 || new Set(keys).size !== 6 || new Set(rows.map((row) => row.channel_key)).size !== 6 || rows.some((row) => !CHANNELS[text(row.channel_key)] || !/^\d{5,9}$/.test(text(row.goods_key || row.goodsKey)) || !text(row.ptn_goods_cd).startsWith(CHANNELS[text(row.channel_key)][0] + "_"))) {
    return Response.json({ ok: false, error: "safe_claim_identity_invalid" }, { status: 409 });
  }
  const latestResult = await db.from("product_launch_upload_jobs").select("id,payload").eq("owner_id", text(job.owner_id)).eq("launch_item_id", text(job.launch_item_id)).in("status", ["success", "partial_failure"]).order("completed_at", { ascending: false }).limit(8);
  const latest = (latestResult.data || []).map(record).find((row) => text(record(record(row.payload).seoFinal).source).startsWith("seo-bulk-cloud"));
  if (latestResult.error || text(latest?.id) !== jobId) return Response.json({ ok: false, error: "safe_claim_superseded_batch" }, { status: 409 });
  const owner = text(job.owner_id);
  const selection = "goods_key,launch_item_id,model_number,product_group_key,ptn_goods_cd,registry_registered_at,status,market_status,submit_armed_at,reason_code,claim_run_id,claimed_at";
  const read = await db.from(TABLE).select(selection).eq("owner_id", owner).in("goods_key", keys).limit(6);
  if (read.error || read.data?.length !== 6) return Response.json({ ok: false, error: "safe_claim_ledger_incomplete" }, { status: 409 });
  const ledger = read.data.map(record);
  for (const row of ledger) {
    const upload = rows.find((candidate) => text(candidate.goods_key || candidate.goodsKey) === text(row.goods_key));
    if (!upload || row.ptn_goods_cd !== upload.ptn_goods_cd || row.product_group_key !== upload.channel_key || row.launch_item_id !== job.launch_item_id) return Response.json({ ok: false, error: "safe_claim_ledger_identity_conflict" }, { status: 409 });
  }
  const held = ledger.filter(marketRowNeedsReview);
  if (held.length) return Response.json({ ok: false, error: "market_registration_review_required", message: "송신경계/확인필요 기록이 있습니다. 설정검사만 가능하며 계정별 등록여부 확인 전 잠금을 해제하지 않습니다.", reviewGoodsKeys: held.map((row) => text(row.goods_key)) }, { status: 409 });
  const otherBusy = ledger.some((row) => row.status === "claimed" && row.claim_run_id !== runId);
  if (otherBusy) return Response.json({ ok: false, error: "safe_claim_other_run_active" }, { status: 409 });
  const existing = ledger.filter((row) => row.status === "claimed" && row.market_status === "pending" && row.claim_run_id === runId && !row.submit_armed_at);
  const candidates = ledger.filter((row) => row.status === "queued" && row.market_status === "pending" && !row.submit_armed_at);
  let claimed: Record<string, unknown>[] = [];
  if (candidates.length) {
    const now = new Date().toISOString();
    const result = await db.from(TABLE).update({ status: "claimed", claim_run_id: runId, claimed_at: now, updated_at: now })
      .eq("owner_id", owner).in("goods_key", candidates.map((row) => text(row.goods_key)))
      .eq("status", "queued").eq("market_status", "pending").is("submit_armed_at", null).select(selection);
    if (result.error) return Response.json({ ok: false, error: "safe_claim_update_failed" }, { status: 503 });
    claimed = (result.data || []).map(record);
  }
  const tasks = [...existing, ...claimed].map(task).filter(Boolean);
  const done = ledger.filter((row) => ["sent", "already_registered"].includes(text(row.status)) || ["sent", "already_registered"].includes(text(row.market_status))).length;
  return Response.json({ ok: true, bridge: BRIDGE, runId, jobId, tasks, taskCount: tasks.length,
    summary: { successCount: done, totalCount: 6, completed: done === 6, pendingCount: candidates.length - claimed.length, busyCount: tasks.length, confirmNeededCount: 0 } });
}
