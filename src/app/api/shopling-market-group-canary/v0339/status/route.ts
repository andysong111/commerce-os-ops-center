import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BRIDGE = "shopling-market-selection-status-v0.1";
const JOB_TABLE = "product_launch_upload_jobs";
const LEDGER_TABLE = "shopling_market_pipeline_ledger";
const STALE_PRE_SUBMIT_MS = 2 * 60 * 1000;
const POST_SUBMIT_CONFIRM_MS = 5 * 60 * 1000;

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function requestedGoodsKeys(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return [...new Set(value.map(text).filter((key) => /^\d{5,9}$/.test(key)))].slice(0, 6);
}

function jobGoodsKeys(job: Record<string, unknown>) {
  const rows = Array.isArray(record(job.result).rows) ? (record(job.result).rows as unknown[]) : [];
  return [...new Set(
    rows
      .map(record)
      .filter((row) => text(row.status) === "success")
      .map((row) => text(row.goods_key || row.goodsKey))
      .filter((key) => /^\d{5,9}$/.test(key)),
  )].slice(0, 6);
}

export async function POST(request: Request) {
  const payload = record(await request.json().catch(() => null));
  if (text(payload.bridge) !== BRIDGE) {
    return Response.json({ ok: false, error: "unsupported_shopling_market_selection_status_bridge" }, { status: 400 });
  }

  const jobId = text(payload.jobId);
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) {
    return Response.json({ ok: false, error: "invalid_shopling_upload_job_id" }, { status: 400 });
  }

  const supabase = await createSupabaseAdminClient();
  if (!supabase) return Response.json({ ok: false, error: "supabase_admin_unavailable" }, { status: 503 });

  const jobResult = await supabase
    .from(JOB_TABLE)
    .select("id,owner_id,result")
    .eq("id", jobId)
    .limit(1)
    .maybeSingle();
  if (jobResult.error) {
    return Response.json({ ok: false, error: "shopling_selected_status_job_read_failed", message: jobResult.error.message }, { status: 503 });
  }
  if (!jobResult.data) return Response.json({ ok: false, error: "shopling_selected_job_not_found" }, { status: 404 });

  const job = record(jobResult.data);
  const ownerId = text(job.owner_id);
  const validBatchKeys = jobGoodsKeys(job);
  if (!ownerId || validBatchKeys.length !== 6) {
    return Response.json({ ok: false, error: "shopling_selected_status_batch_invalid" }, { status: 409 });
  }

  const requested = requestedGoodsKeys(payload.goodsKeys);
  const validSet = new Set(validBatchKeys);
  const keys = (requested.length ? requested : validBatchKeys).filter((key) => validSet.has(key));
  if (!keys.length) return Response.json({ ok: false, error: "shopling_selected_status_goods_keys_invalid" }, { status: 400 });

  // Only a worker that provably never crossed submit_armed may be released back to pending.
  const stalePreSubmitCutoff = new Date(Date.now() - STALE_PRE_SUBMIT_MS).toISOString();
  const stalePreSubmitRecovery = await supabase
    .from(LEDGER_TABLE)
    .update({
      status: "queued",
      title_status: "pending",
      market_status: "pending",
      claim_run_id: "",
      claimed_at: null,
      completed_at: null,
      reason_code: "auto_stale_pre_submit_released_v0339",
      message: "브라우저 Worker가 2분 이상 submit_armed 경계를 넘지 못해 미송신이 확정된 채널만 대기열로 복구했습니다.",
      updated_at: new Date().toISOString(),
    })
    .eq("owner_id", ownerId)
    .in("goods_key", keys)
    .eq("status", "claimed")
    .eq("market_status", "pending")
    .lt("claimed_at", stalePreSubmitCutoff)
    .is("submit_armed_at", null)
    .select("goods_key");
  if (stalePreSubmitRecovery.error) {
    return Response.json({
      ok: false,
      error: "shopling_selected_status_stale_pre_submit_recovery_failed",
      message: stalePreSubmitRecovery.error.message,
    }, { status: 503 });
  }

  // Critical v0.3.39 invariant: once submit_armed_at exists, timeout is uncertainty, never proof of non-submission.
  // Preserve claim/run/timestamp evidence and lock the channel as confirm_needed. It can only become sent or
  // already_registered through exact result/A18 evidence or an explicit reviewed operation.
  const postSubmitCutoff = new Date(Date.now() - POST_SUBMIT_CONFIRM_MS).toISOString();
  const postSubmitHold = await supabase
    .from(LEDGER_TABLE)
    .update({
      status: "confirm_needed",
      title_status: "pending",
      market_status: "confirm_needed",
      completed_at: null,
      reason_code: "submit_result_timeout_confirm_needed_v0339",
      message: "submit_armed 이후 결과회수가 5분 안에 확정되지 않아 중복방지를 위해 확인필요로 잠갔습니다. pending으로 되돌리지 않습니다.",
      updated_at: new Date().toISOString(),
    })
    .eq("owner_id", ownerId)
    .in("goods_key", keys)
    .eq("status", "claimed")
    .eq("market_status", "submit_armed")
    .lt("submit_armed_at", postSubmitCutoff)
    .not("submit_armed_at", "is", null)
    .select("goods_key");
  if (postSubmitHold.error) {
    return Response.json({
      ok: false,
      error: "shopling_selected_status_post_submit_hold_failed",
      message: postSubmitHold.error.message,
    }, { status: 503 });
  }

  const ledger = await supabase
    .from(LEDGER_TABLE)
    .select("goods_key,status,market_status,claim_run_id,claimed_at,submit_armed_at,completed_at,reason_code,message,updated_at")
    .eq("owner_id", ownerId)
    .in("goods_key", keys)
    .limit(6);
  if (ledger.error) {
    return Response.json({ ok: false, error: "shopling_selected_status_ledger_read_failed", message: ledger.error.message }, { status: 503 });
  }

  const rows = (Array.isArray(ledger.data) ? ledger.data : []).map((raw) => {
    const row = record(raw);
    return {
      goodsKey: text(row.goods_key),
      status: text(row.status),
      marketStatus: text(row.market_status),
      claimRunId: text(row.claim_run_id),
      claimedAt: text(row.claimed_at),
      submitArmedAt: text(row.submit_armed_at),
      completedAt: text(row.completed_at),
      reasonCode: text(row.reason_code),
      message: text(row.message),
      updatedAt: text(row.updated_at),
    };
  });

  const terminal = new Set(["sent", "already_registered", "confirm_needed", "legacy_ignored"]);
  const summary = {
    requestedCount: keys.length,
    rowCount: rows.length,
    sentCount: rows.filter((row) => row.marketStatus === "sent" || row.status === "sent").length,
    alreadyRegisteredCount: rows.filter((row) => row.marketStatus === "already_registered" || row.status === "already_registered").length,
    confirmNeededCount: rows.filter((row) => row.marketStatus === "confirm_needed" || row.status === "confirm_needed").length,
    pendingCount: rows.filter((row) => row.marketStatus === "pending" && row.status === "queued").length,
    busyCount: rows.filter((row) => row.status === "claimed" || row.marketStatus === "submit_armed").length,
    terminalCount: rows.filter((row) => terminal.has(row.marketStatus) || terminal.has(row.status)).length,
    stalePreSubmitRecoveredCount: Array.isArray(stalePreSubmitRecovery.data) ? stalePreSubmitRecovery.data.length : 0,
    postSubmitHeldCount: Array.isArray(postSubmitHold.data) ? postSubmitHold.data.length : 0,
  };

  return Response.json({ ok: true, bridge: BRIDGE, version: "0.3.39", jobId, rows, summary }, {
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
