import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BRIDGE_VERSION = "v0.5.0";
const MAX_GROUPS = 50;
const CANARY_RUN_PREFIX = "canary-";

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function mergeClaimRows(...sources: unknown[][]) {
  const byGoodsKey = new Map<string, Record<string, unknown>>();
  for (const source of sources) {
    for (const raw of source) {
      const row = record(raw);
      const goodsKey = text(row.goods_key);
      if (/^\d{5,9}$/.test(goodsKey)) byGoodsKey.set(goodsKey, row);
    }
  }
  return [...byGoodsKey.values()];
}

function profileSearchCode(productGroupKey: string) {
  const values: Record<string, { searchCode: string; profile: string }> = {
    wholesale1: { searchCode: "DM1", profile: "도매1" },
    wholesale2: { searchCode: "DM2", profile: "도매2" },
    wholesale3: { searchCode: "DM3", profile: "도매3" },
    wholesale4: { searchCode: "DM4", profile: "도매4" },
    retail1: { searchCode: "SM1", profile: "소매1" },
    retail2: { searchCode: "SM2", profile: "소매2" },
  };
  return values[productGroupKey] || null;
}

function taskFromLedgerRow(raw: unknown) {
  const row = record(raw);
  const productGroupKey = text(row.product_group_key);
  const mapping = profileSearchCode(productGroupKey);
  if (!mapping) return null;
  const goodsKey = text(row.goods_key);
  const ptnGoodsCd = text(row.ptn_goods_cd);
  if (!/^\d{5,9}$/.test(goodsKey) || !ptnGoodsCd) return null;
  return {
    goodsKey,
    launchItemId: text(row.launch_item_id),
    modelNumber: text(row.model_number),
    productGroupKey,
    searchCode: mapping.searchCode,
    profile: mapping.profile,
    ptnGoodsCd,
    registeredAt: text(row.registry_registered_at),
  };
}

function validRunId(runId: string) {
  return /^[A-Za-z0-9._:-]{12,160}$/.test(runId);
}

export async function POST(request: Request) {
  const payload = record(await request.json().catch(() => null));
  const bridge = text(payload.bridge);
  const action = text(payload.action);
  if (bridge !== BRIDGE_VERSION) {
    return json({ ok: false, error: "unsupported_bridge_version" }, 400);
  }

  const supabase = await createSupabaseAdminClient();
  if (!supabase) return json({ ok: false, error: "supabase_admin_unavailable" }, 503);

  if (action === "canary-claim") {
    const runId = text(payload.runId);
    if (!runId.startsWith(CANARY_RUN_PREFIX) || !validRunId(runId)) {
      return json({ ok: false, error: "invalid_canary_run_id" }, 400);
    }

    const recovered = await supabase
      .from("shopling_market_pipeline_ledger")
      .select("owner_id,goods_key,launch_item_id,model_number,product_group_key,profile,ptn_goods_cd,search_prefix,registry_registered_at")
      .eq("claim_run_id", runId)
      .eq("status", "claimed")
      .eq("product_group_key", "wholesale1")
      .limit(1)
      .maybeSingle();
    if (recovered.error) {
      return json({ ok: false, error: "canary_recovery_failed", message: recovered.error.message }, 503);
    }
    if (recovered.data) {
      const task = taskFromLedgerRow(recovered.data);
      if (!task || task.searchCode !== "DM1" || task.profile !== "도매1") {
        return json({ ok: false, error: "canary_recovery_payload_invalid" }, 503);
      }
      return json({ ok: true, bridge: BRIDGE_VERSION, runId, task, recovered: true });
    }

    const candidate = await supabase
      .from("shopling_market_pipeline_ledger")
      .select("owner_id,goods_key,launch_item_id,model_number,product_group_key,profile,ptn_goods_cd,search_prefix,registry_registered_at")
      .eq("status", "queued")
      .eq("market_status", "pending")
      .eq("product_group_key", "wholesale1")
      .order("registry_registered_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (candidate.error) {
      return json({ ok: false, error: "canary_candidate_failed", message: candidate.error.message }, 503);
    }
    if (!candidate.data) {
      return json({ ok: true, bridge: BRIDGE_VERSION, runId, task: null, empty: true });
    }

    const candidateRow = record(candidate.data);
    const ownerId = text(candidateRow.owner_id);
    const goodsKey = text(candidateRow.goods_key);
    if (!ownerId || !/^\d{5,9}$/.test(goodsKey)) {
      return json({ ok: false, error: "canary_candidate_invalid" }, 503);
    }

    const claimedAt = new Date().toISOString();
    const claimed = await supabase
      .from("shopling_market_pipeline_ledger")
      .update({
        status: "claimed",
        claim_run_id: runId,
        claimed_at: claimedAt,
        updated_at: claimedAt,
      })
      .eq("owner_id", ownerId)
      .eq("goods_key", goodsKey)
      .eq("status", "queued")
      .eq("market_status", "pending")
      .select("owner_id,goods_key,launch_item_id,model_number,product_group_key,profile,ptn_goods_cd,search_prefix,registry_registered_at")
      .maybeSingle();
    if (claimed.error) {
      return json({ ok: false, error: "canary_claim_failed", message: claimed.error.message }, 503);
    }
    if (!claimed.data) {
      return json({ ok: false, error: "canary_claim_race", message: "Canary 대상이 동시에 변경되어 아무 것도 전송하지 않았습니다." }, 409);
    }

    const task = taskFromLedgerRow(claimed.data);
    if (!task || task.searchCode !== "DM1" || task.profile !== "도매1") {
      return json({ ok: false, error: "canary_claim_payload_invalid" }, 503);
    }
    return json({ ok: true, bridge: BRIDGE_VERSION, runId, task, recovered: false });
  }

  if (action === "claim") {
    const runId = text(payload.runId);
    if (!validRunId(runId)) {
      return json({ ok: false, error: "invalid_run_id" }, 400);
    }
    const requestedGroups = Number(payload.groupLimit || MAX_GROUPS);
    const groupLimit = Math.max(1, Math.min(Number.isFinite(requestedGroups) ? Math.floor(requestedGroups) : MAX_GROUPS, MAX_GROUPS));
    const result = await supabase.rpc("claim_shopling_market_pipeline_tasks", {
      p_run_id: runId,
      p_group_limit: groupLimit,
    });
    if (result.error) {
      return json({ ok: false, error: "claim_failed", message: result.error.message }, 503);
    }

    const rpcRows = Array.isArray(result.data) ? result.data : [];
    const recovery = await supabase
      .from("shopling_market_pipeline_ledger")
      .select("owner_id,goods_key,launch_item_id,model_number,product_group_key,profile,ptn_goods_cd,search_prefix,registry_registered_at")
      .eq("claim_run_id", runId)
      .eq("status", "claimed")
      .order("registry_registered_at", { ascending: true })
      .limit(groupLimit * 6);
    if (recovery.error && rpcRows.length === 0) {
      return json({ ok: false, error: "claim_recovery_failed", message: recovery.error.message }, 503);
    }

    const recoveryRows = Array.isArray(recovery.data) ? recovery.data : [];
    const rawRows = mergeClaimRows(rpcRows, recoveryRows);
    const rows = rawRows.map(taskFromLedgerRow).filter(Boolean);

    if (rawRows.length > 0 && rows.length !== rawRows.length) {
      return json({
        ok: false,
        error: "claim_payload_invalid",
        message: "Claim된 Shopling 작업 중 필수 식별자가 누락되어 자동 처리를 중단했습니다.",
        claimedRowCount: rawRows.length,
        validTaskCount: rows.length,
      }, 503);
    }

    const launchItems = new Set(rows.map((row) => (row as { launchItemId: string }).launchItemId));
    return json({
      ok: true,
      bridge: BRIDGE_VERSION,
      runId,
      tasks: rows,
      taskCount: rows.length,
      launchItemCount: launchItems.size,
      rpcClaimRowCount: rpcRows.length,
      recoveredClaimRowCount: recoveryRows.length,
    });
  }

  if (action === "arm-submit") {
    const runId = text(payload.runId);
    const goodsKey = text(payload.goodsKey);
    if (!runId || !/^\d{5,9}$/.test(goodsKey)) {
      return json({ ok: false, error: "invalid_submit_lock" }, 400);
    }
    const result = await supabase.rpc("arm_shopling_market_pipeline_submit", {
      p_run_id: runId,
      p_goods_key: goodsKey,
    });
    if (result.error) {
      return json({ ok: false, error: "submit_lock_failed", message: result.error.message }, 503);
    }
    if (result.data !== true) {
      return json({ ok: false, error: "submit_lock_rejected" }, 409);
    }
    return json({ ok: true, armed: true, goodsKey });
  }

  if (action === "report") {
    const runId = text(payload.runId);
    const goodsKey = text(payload.goodsKey);
    const outcome = text(payload.outcome);
    if (!runId || !/^\d{5,9}$/.test(goodsKey)) {
      return json({ ok: false, error: "invalid_report" }, 400);
    }
    if (!["sent", "already_registered", "confirm_needed", "title_failed", "failed"].includes(outcome)) {
      return json({ ok: false, error: "invalid_outcome" }, 400);
    }

    if (runId.startsWith(CANARY_RUN_PREFIX) && outcome === "failed") {
      const releasedAt = new Date().toISOString();
      const failureReasonCode = text(payload.reasonCode).slice(0, 120) || "pre_submit_failed";
      const failureMessage = text(payload.message).slice(0, 1000) || "Shopling Worker가 송신경계 이전에서 실패해 안전하게 대기열로 원복했습니다.";
      const released = await supabase
        .from("shopling_market_pipeline_ledger")
        .update({
          status: "queued",
          claim_run_id: "",
          claimed_at: null,
          reason_code: failureReasonCode,
          message: failureMessage,
          updated_at: releasedAt,
        })
        .eq("claim_run_id", runId)
        .eq("goods_key", goodsKey)
        .eq("status", "claimed")
        .eq("market_status", "pending")
        .is("submit_armed_at", null)
        .select("goods_key")
        .maybeSingle();
      if (released.error) {
        return json({ ok: false, error: "canary_release_failed", message: released.error.message }, 503);
      }
      if (!released.data) {
        return json({
          ok: false,
          error: "canary_release_rejected",
          message: "송신 경계를 지났을 가능성이 있어 자동 원복하지 않았습니다. 확인필요로 보존합니다.",
        }, 409);
      }
      return json({ ok: true, recorded: true, released: true, goodsKey, outcome: "canary_released", reasonCode: failureReasonCode, message: failureMessage });
    }

    const result = await supabase.rpc("report_shopling_market_pipeline_task", {
      p_run_id: runId,
      p_goods_key: goodsKey,
      p_outcome: outcome,
      p_reason_code: text(payload.reasonCode).slice(0, 120),
      p_message: text(payload.message).slice(0, 1000),
    });
    if (result.error) {
      return json({ ok: false, error: "report_failed", message: result.error.message }, 503);
    }
    if (result.data !== true) {
      return json({ ok: false, error: "report_rejected" }, 409);
    }
    return json({ ok: true, recorded: true, goodsKey, outcome });
  }

  return json({ ok: false, error: "unsupported_action" }, 400);
}
