import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BRIDGE = "shopling-market-selection-all-v0.1";
const JOB_TABLE = "product_launch_upload_jobs";
const LEDGER_TABLE = "shopling_market_pipeline_ledger";
const STALE_PRE_SUBMIT_MS = 2 * 60 * 1000;
const ORDER: Record<string, number> = { wholesale1: 1, wholesale2: 2, wholesale3: 3, wholesale4: 4, retail1: 5, retail2: 6 };
const CHANNELS: Record<string, { searchCode: string; profile: string }> = {
  wholesale1: { searchCode: "DM1", profile: "도매1" },
  wholesale2: { searchCode: "DM2", profile: "도매2" },
  wholesale3: { searchCode: "DM3", profile: "도매3" },
  wholesale4: { searchCode: "DM4", profile: "도매4" },
  retail1: { searchCode: "SM1", profile: "소매1" },
  retail2: { searchCode: "SM2", profile: "소매2" },
};

function text(value: unknown) { return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim(); }
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function validRunId(runId: string) { return /^canary-group-v030-[A-Za-z0-9._:-]{12,150}$/.test(runId); }
function isSeoBulkJob(job: Record<string, unknown>) { return text(record(record(job.payload).seoFinal).source).startsWith("seo-bulk-cloud"); }

function taskRows(job: Record<string, unknown>) {
  const payload = record(job.payload);
  const launchItemId = text(job.launch_item_id);
  const modelNumber = text(payload.modelNumber);
  const registeredAt = text(job.completed_at || job.created_at);
  const source = Array.isArray(record(job.result).rows) ? record(job.result).rows as unknown[] : [];
  return source.map(record).filter((row) => text(row.status) === "success").map((row) => {
    const productGroupKey = text(row.channel_key);
    const map = CHANNELS[productGroupKey];
    const goodsKey = text(row.goods_key || row.goodsKey);
    const ptnGoodsCd = text(row.ptn_goods_cd);
    if (!map || !/^\d{5,9}$/.test(goodsKey) || !ptnGoodsCd || !launchItemId) return null;
    if (!ptnGoodsCd.toUpperCase().startsWith(`${map.searchCode}_`)) return null;
    return { ownerId: text(job.owner_id), goodsKey, launchItemId, modelNumber, productGroupKey, searchCode: map.searchCode, profile: map.profile, ptnGoodsCd, registeredAt };
  }).filter(Boolean) as Array<{ ownerId: string; goodsKey: string; launchItemId: string; modelNumber: string; productGroupKey: string; searchCode: string; profile: string; ptnGoodsCd: string; registeredAt: string }>;
}

function sortTasks<T extends { productGroupKey: string; goodsKey: string }>(items: T[]) {
  return [...items].sort((a, b) => (ORDER[a.productGroupKey] ?? 99) - (ORDER[b.productGroupKey] ?? 99) || a.goodsKey.localeCompare(b.goodsKey));
}

function taskFromLedger(raw: unknown) {
  const row = record(raw);
  const productGroupKey = text(row.product_group_key);
  const map = CHANNELS[productGroupKey];
  const goodsKey = text(row.goods_key);
  const ptnGoodsCd = text(row.ptn_goods_cd);
  if (!map || !/^\d{5,9}$/.test(goodsKey) || !ptnGoodsCd || !ptnGoodsCd.toUpperCase().startsWith(`${map.searchCode}_`)) return null;
  return {
    goodsKey,
    launchItemId: text(row.launch_item_id),
    modelNumber: text(row.model_number),
    productGroupKey,
    searchCode: map.searchCode,
    profile: map.profile,
    ptnGoodsCd,
    registeredAt: text(row.registry_registered_at),
    claimEpoch: text(row.claimed_at),
  };
}

const CLAIM_SELECT = "owner_id,goods_key,launch_item_id,model_number,product_group_key,profile,ptn_goods_cd,search_prefix,registry_registered_at,claimed_at";

export async function POST(request: Request) {
  const payload = record(await request.json().catch(() => null));
  if (text(payload.bridge) !== BRIDGE) return Response.json({ ok: false, error: "unsupported_shopling_market_selection_all_bridge" }, { status: 400 });
  const runId = text(payload.runId);
  const jobId = text(payload.jobId);
  if (!validRunId(runId)) return Response.json({ ok: false, error: "invalid_group_canary_run_id" }, { status: 400 });
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return Response.json({ ok: false, error: "invalid_shopling_upload_job_id" }, { status: 400 });

  const supabase = await createSupabaseAdminClient();
  if (!supabase) return Response.json({ ok: false, error: "supabase_admin_unavailable" }, { status: 503 });
  const jobResult = await supabase.from(JOB_TABLE).select("id,owner_id,launch_item_id,status,payload,result,created_at,completed_at").eq("id", jobId).limit(1).maybeSingle();
  if (jobResult.error) return Response.json({ ok: false, error: "shopling_selected_job_read_failed", message: jobResult.error.message }, { status: 503 });
  if (!jobResult.data) return Response.json({ ok: false, error: "shopling_selected_job_not_found" }, { status: 404 });
  const job = record(jobResult.data);
  if (!isSeoBulkJob(job) || text(job.status) !== "success") return Response.json({ ok: false, error: "shopling_selected_job_not_ready" }, { status: 409 });
  const tasksFromJob = sortTasks(taskRows(job));
  if (tasksFromJob.length !== 6 || new Set(tasksFromJob.map((task) => task.productGroupKey)).size !== 6) return Response.json({ ok: false, error: "shopling_selected_job_six_channel_identity_invalid" }, { status: 409 });

  const latest = await supabase.from(JOB_TABLE).select("id,launch_item_id,status,payload,completed_at,created_at").eq("launch_item_id", text(job.launch_item_id)).in("status", ["success", "partial_failure"]).order("completed_at", { ascending: false }).limit(8);
  if (latest.error) return Response.json({ ok: false, error: "shopling_selected_latest_job_lookup_failed", message: latest.error.message }, { status: 503 });
  const latestSeo = (Array.isArray(latest.data) ? latest.data : []).map(record).find(isSeoBulkJob);
  if (text(latestSeo?.id) !== jobId) return Response.json({ ok: false, error: "shopling_selected_job_superseded" }, { status: 409 });

  const now = new Date().toISOString();
  const ownerId = tasksFromJob[0].ownerId;
  const keys = tasksFromJob.map((task) => task.goodsKey);
  const seeds = tasksFromJob.map((task) => ({ owner_id: task.ownerId, goods_key: task.goodsKey, launch_item_id: task.launchItemId, model_number: task.modelNumber, product_group_key: task.productGroupKey, profile: task.profile, ptn_goods_cd: task.ptnGoodsCd, search_prefix: task.searchCode, registry_registered_at: task.registeredAt || now, status: "queued", title_status: "pending", market_status: "pending", created_at: now, updated_at: now }));
  const hydrated = await supabase.from(LEDGER_TABLE).upsert(seeds, { onConflict: "owner_id,goods_key", ignoreDuplicates: true });
  if (hydrated.error) return Response.json({ ok: false, error: "shopling_selected_ledger_hydration_failed", message: hydrated.error.message }, { status: 503 });

  await supabase.from(LEDGER_TABLE).update({ status: "queued", title_status: "pending", market_status: "pending", claim_run_id: "", claimed_at: null, submit_armed_at: null, reason_code: "selected_legacy_preflight_reconcile_v0328", message: "선택 실행에서 A18 미등록 정확조회로 실등록 여부를 다시 확인합니다.", completed_at: null, updated_at: now }).eq("owner_id", ownerId).in("goods_key", keys).eq("status", "legacy_ignored").eq("market_status", "legacy_ignored");
  await supabase.from(LEDGER_TABLE).update({ status: "queued", title_status: "pending", market_status: "pending", claim_run_id: "", claimed_at: null, submit_armed_at: null, reason_code: "selected_confirm_reconcile_v0328", message: "확인필요 채널을 사용자가 다시 선택했습니다. A18 미등록 정확조회에서 실제 미등록일 때만 송신합니다.", completed_at: null, updated_at: now }).eq("owner_id", ownerId).in("goods_key", keys).eq("status", "confirm_needed").eq("market_status", "confirm_needed");

  const staleSubmitCutoff = new Date(Date.now() - 3 * 60 * 1000).toISOString();
  await supabase.from(LEDGER_TABLE).update({ status: "queued", title_status: "pending", market_status: "pending", claim_run_id: "", claimed_at: null, submit_armed_at: null, reason_code: "selected_stale_submit_reconcile_v0328", message: "이전 송신경계 상태가 3분 이상 미확정되어 사용자의 재선택으로 A18 미등록 정확조회부터 안전하게 재검증합니다.", completed_at: null, updated_at: now }).eq("owner_id", ownerId).in("goods_key", keys).eq("status", "claimed").eq("market_status", "submit_armed").lt("submit_armed_at", staleSubmitCutoff);

  const staleCutoff = new Date(Date.now() - STALE_PRE_SUBMIT_MS).toISOString();
  await supabase.from(LEDGER_TABLE).update({ status: "queued", market_status: "pending", claim_run_id: "", claimed_at: null, reason_code: "stale_selected_claim_released_v0332", message: "이전 Worker가 2분 이상 송신경계를 넘지 못해 새 claim 세대로 안전 복구했습니다.", updated_at: now }).eq("owner_id", ownerId).in("goods_key", keys).eq("status", "claimed").eq("market_status", "pending").lt("claimed_at", staleCutoff).is("submit_armed_at", null);

  const recovered = await supabase.from(LEDGER_TABLE).select(CLAIM_SELECT).eq("owner_id", ownerId).eq("claim_run_id", runId).eq("status", "claimed").eq("market_status", "pending").in("goods_key", keys).limit(6);
  if (recovered.error) return Response.json({ ok: false, error: "shopling_selected_claim_recovery_failed", message: recovered.error.message }, { status: 503 });
  const recoveredTasks = sortTasks((Array.isArray(recovered.data) ? recovered.data : []).map(taskFromLedger).filter(Boolean) as NonNullable<ReturnType<typeof taskFromLedger>>[]);
  const recoveredKeys = new Set(recoveredTasks.map((task) => task.goodsKey));

  const candidates = await supabase.from(LEDGER_TABLE).select(CLAIM_SELECT).eq("owner_id", ownerId).in("goods_key", keys).eq("status", "queued").eq("market_status", "pending").limit(6);
  if (candidates.error) return Response.json({ ok: false, error: "shopling_selected_candidate_failed", message: candidates.error.message }, { status: 503 });
  const candidateTasks = sortTasks((Array.isArray(candidates.data) ? candidates.data : []).map(taskFromLedger).filter(Boolean) as NonNullable<ReturnType<typeof taskFromLedger>>[]).filter((task) => !recoveredKeys.has(task.goodsKey));
  let claimedTasks: NonNullable<ReturnType<typeof taskFromLedger>>[] = [];
  if (candidateTasks.length) {
    const claimAt = new Date().toISOString();
    const claimed = await supabase.from(LEDGER_TABLE).update({ status: "claimed", claim_run_id: runId, claimed_at: claimAt, updated_at: claimAt }).eq("owner_id", ownerId).in("goods_key", candidateTasks.map((task) => task.goodsKey)).eq("status", "queued").eq("market_status", "pending").select(CLAIM_SELECT);
    if (claimed.error) return Response.json({ ok: false, error: "shopling_selected_claim_failed", message: claimed.error.message }, { status: 503 });
    claimedTasks = sortTasks((Array.isArray(claimed.data) ? claimed.data : []).map(taskFromLedger).filter(Boolean) as NonNullable<ReturnType<typeof taskFromLedger>>[]);
  }
  const tasks = sortTasks([...recoveredTasks, ...claimedTasks]);
  if (tasks.length) return Response.json({ ok: true, bridge: BRIDGE, runId, jobId, tasks, taskCount: tasks.length, recovered: recoveredTasks.length > 0, claimEpochs: [...new Set(tasks.map((task) => task.claimEpoch).filter(Boolean))] });

  const summary = await supabase.from(LEDGER_TABLE).select("goods_key,status,market_status").eq("owner_id", ownerId).in("goods_key", keys).limit(6);
  if (summary.error) return Response.json({ ok: false, error: "shopling_selected_summary_failed", message: summary.error.message }, { status: 503 });
  const rows = Array.isArray(summary.data) ? summary.data.map(record) : [];
  const successCount = rows.filter((row) => ["sent", "already_registered"].includes(text(row.status)) || ["sent", "already_registered"].includes(text(row.market_status))).length;
  const confirmNeededCount = rows.filter((row) => text(row.status) === "confirm_needed" || text(row.market_status) === "confirm_needed").length;
  const busyCount = rows.filter((row) => text(row.status) === "claimed" || text(row.market_status) === "submit_armed").length;
  const pendingCount = rows.filter((row) => text(row.status) === "queued" && text(row.market_status) === "pending").length;
  return Response.json({ ok: true, bridge: BRIDGE, runId, jobId, tasks: [], taskCount: 0, empty: true, summary: { successCount, confirmNeededCount, busyCount, pendingCount, totalCount: 6, completed: successCount + confirmNeededCount >= 6 && busyCount === 0 && pendingCount === 0 } });
}
