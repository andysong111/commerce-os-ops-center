import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  SHOPLING_MARKET_CHANNELS_V0337,
  buildMissingLedgerRowsV0337,
  isSafeStalePreSubmitClaimV0337,
} from "@/lib/shoplingMarketClaimSelfHealV0337";
import { marketRowNeedsReview } from "@/lib/shoplingMarketSafety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BRIDGE = "shopling-market-selection-all-v0.1";
const TABLE = "shopling_market_pipeline_ledger";
const REGISTRY_TABLE = "shopling_product_group_registry";
const CHANNELS = SHOPLING_MARKET_CHANNELS_V0337;
const LEDGER_SELECTION = "goods_key,launch_item_id,model_number,product_group_key,profile,ptn_goods_cd,search_prefix,registry_registered_at,status,market_status,submit_armed_at,reason_code,message,claim_run_id,claimed_at,updated_at";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record) : [];
}
function text(value: unknown) {
  return String(value ?? "").trim();
}
function task(raw: unknown) {
  const row = record(raw);
  const mapping = CHANNELS[text(row.product_group_key)];
  if (!mapping) return null;
  return {
    goodsKey: text(row.goods_key),
    launchItemId: text(row.launch_item_id),
    modelNumber: text(row.model_number),
    productGroupKey: text(row.product_group_key),
    searchCode: mapping[0],
    profile: mapping[1],
    ptnGoodsCd: text(row.ptn_goods_cd),
    registeredAt: text(row.registry_registered_at),
    claimEpoch: text(row.claimed_at),
  };
}

function ledgerIdentityMatches(
  ledgerRow: Record<string, unknown>,
  uploadRows: Record<string, unknown>[],
  launchItemId: string,
) {
  const goodsKey = text(ledgerRow.goods_key);
  const upload = uploadRows.find(
    (candidate) => text(candidate.goods_key || candidate.goodsKey) === goodsKey,
  );
  return Boolean(
    upload
      && text(ledgerRow.ptn_goods_cd) === text(upload.ptn_goods_cd)
      && text(ledgerRow.product_group_key) === text(upload.channel_key)
      && text(ledgerRow.launch_item_id) === launchItemId,
  );
}

export async function POST(request: Request) {
  const body = record(await request.json().catch(() => null));
  const runId = text(body.runId);
  const jobId = text(body.jobId);
  if (
    body.bridge !== BRIDGE
    || !/^canary-group-v030-[A-Za-z0-9._:-]{12,150}$/.test(runId)
    || runId.includes("-diagnostic-")
    || !/^[0-9a-f-]{36}$/i.test(jobId)
  ) {
    return Response.json({ ok: false, error: "invalid_safe_market_claim" }, { status: 400 });
  }

  const db = await createSupabaseAdminClient();
  if (!db) {
    return Response.json({ ok: false, error: "supabase_admin_unavailable" }, { status: 503 });
  }
  const admin = db;

  const jobResult = await admin
    .from("product_launch_upload_jobs")
    .select("id,owner_id,launch_item_id,status,payload,result")
    .eq("id", jobId)
    .limit(1)
    .maybeSingle();
  if (jobResult.error || !jobResult.data) {
    return Response.json({ ok: false, error: "safe_claim_job_unavailable" }, { status: 409 });
  }

  const job = record(jobResult.data);
  const payload = record(job.payload);
  const seoFinal = record(payload.seoFinal);
  if (job.status !== "success" || !text(seoFinal.source).startsWith("seo-bulk-cloud")) {
    return Response.json({ ok: false, error: "safe_claim_upload_not_ready" }, { status: 409 });
  }

  const uploadRows = records(record(job.result).rows).filter((row) => row.status === "success");
  const keys = uploadRows.map((row) => text(row.goods_key || row.goodsKey));
  if (
    uploadRows.length !== 6
    || new Set(keys).size !== 6
    || new Set(uploadRows.map((row) => text(row.channel_key))).size !== 6
    || uploadRows.some((row) => {
      const mapping = CHANNELS[text(row.channel_key)];
      return !mapping
        || !/^\d{5,9}$/.test(text(row.goods_key || row.goodsKey))
        || !text(row.ptn_goods_cd).startsWith(`${mapping[0]}_`);
    })
  ) {
    return Response.json({ ok: false, error: "safe_claim_identity_invalid" }, { status: 409 });
  }

  const owner = text(job.owner_id);
  const launchItemId = text(job.launch_item_id);
  const modelNumber = text(payload.modelNumber || seoFinal.modelNumber);
  const latestResult = await admin
    .from("product_launch_upload_jobs")
    .select("id,payload")
    .eq("owner_id", owner)
    .eq("launch_item_id", launchItemId)
    .in("status", ["success", "partial_failure"])
    .order("completed_at", { ascending: false })
    .limit(8);
  const latest = records(latestResult.data).find((row) =>
    text(record(record(row.payload).seoFinal).source).startsWith("seo-bulk-cloud"),
  );
  if (latestResult.error || text(latest?.id) !== jobId) {
    return Response.json({ ok: false, error: "safe_claim_superseded_batch" }, { status: 409 });
  }

  async function readLedger() {
    return admin
      .from(TABLE)
      .select(LEDGER_SELECTION)
      .eq("owner_id", owner)
      .in("goods_key", keys)
      .limit(6);
  }

  let ledgerResult = await readLedger();
  if (ledgerResult.error) {
    return Response.json({ ok: false, error: "safe_claim_ledger_read_failed" }, { status: 503 });
  }
  let ledger = records(ledgerResult.data);

  // Never repair around an existing identity conflict. Any row already present must
  // agree with this exact upload batch before missing rows can be backfilled.
  if (ledger.some((row) => !ledgerIdentityMatches(row, uploadRows, launchItemId))) {
    return Response.json({ ok: false, error: "safe_claim_ledger_identity_conflict" }, { status: 409 });
  }

  let ledgerBackfilledCount = 0;
  if (ledger.length !== 6) {
    const registryResult = await admin
      .from(REGISTRY_TABLE)
      .select("goods_key,launch_item_id,model_number,product_group_key,ptn_goods_cd,search_prefix,shopling_status,registered_at")
      .eq("owner_id", owner)
      .in("goods_key", keys)
      .limit(6);
    if (registryResult.error) {
      return Response.json({ ok: false, error: "safe_claim_registry_read_failed" }, { status: 503 });
    }

    const repair = buildMissingLedgerRowsV0337({
      ownerId: owner,
      launchItemId,
      modelNumber,
      uploadRows,
      registryRows: records(registryResult.data),
      existingGoodsKeys: ledger.map((row) => text(row.goods_key)),
    });
    if (!repair.ok) {
      return Response.json(
        { ok: false, error: "safe_claim_ledger_backfill_blocked", reason: repair.error },
        { status: 409 },
      );
    }

    if (repair.rows.length) {
      const inserted = await admin.from(TABLE).insert(repair.rows).select("goods_key");
      if (!inserted.error) ledgerBackfilledCount = records(inserted.data).length;
      // A concurrent safe claimant may have inserted the same exact rows first.
      // Re-read instead of treating a duplicate insert as permission to widen identity.
    }

    ledgerResult = await readLedger();
    if (ledgerResult.error) {
      return Response.json({ ok: false, error: "safe_claim_ledger_backfill_read_failed" }, { status: 503 });
    }
    ledger = records(ledgerResult.data);
    if (ledger.length !== 6) {
      return Response.json({ ok: false, error: "safe_claim_ledger_backfill_failed" }, { status: 503 });
    }
    if (ledger.some((row) => !ledgerIdentityMatches(row, uploadRows, launchItemId))) {
      return Response.json({ ok: false, error: "safe_claim_ledger_identity_conflict" }, { status: 409 });
    }
  }

  // Submit-boundary and manual-review states remain immutable. Self-heal applies only
  // to an old claim that provably never crossed submit_armed.
  const held = ledger.filter(marketRowNeedsReview);
  if (held.length) {
    return Response.json(
      {
        ok: false,
        error: "market_registration_review_required",
        message: "송신경계/확인필요 기록이 있습니다. 설정검사만 가능하며 계정별 등록여부 확인 전 잠금을 해제하지 않습니다.",
        reviewGoodsKeys: held.map((row) => text(row.goods_key)),
      },
      { status: 409 },
    );
  }

  const stalePreSubmit = ledger.filter((row) =>
    text(row.status) === "claimed"
      && text(row.claim_run_id) !== runId
      && isSafeStalePreSubmitClaimV0337(row),
  );
  let stalePreSubmitReleasedCount = 0;
  if (stalePreSubmit.length) {
    const now = new Date().toISOString();
    for (const row of stalePreSubmit) {
      const goodsKey = text(row.goods_key);
      const oldRunId = text(row.claim_run_id);
      if (!goodsKey || !oldRunId) continue;
      const released = await admin
        .from(TABLE)
        .update({
          status: "queued",
          claim_run_id: "",
          claimed_at: null,
          reason_code: "auto_stale_pre_submit_released_v0337",
          message: "15분 이상 지난 submit_armed 이전 stale claim을 새 안전전송 전에 자동 해제했습니다.",
          updated_at: now,
        })
        .eq("owner_id", owner)
        .eq("goods_key", goodsKey)
        .eq("status", "claimed")
        .eq("market_status", "pending")
        .eq("claim_run_id", oldRunId)
        .is("submit_armed_at", null)
        .select("goods_key");
      if (released.error) {
        return Response.json({ ok: false, error: "safe_claim_stale_release_failed" }, { status: 503 });
      }
      stalePreSubmitReleasedCount += records(released.data).length;
    }

    ledgerResult = await readLedger();
    if (ledgerResult.error) {
      return Response.json({ ok: false, error: "safe_claim_post_release_read_failed" }, { status: 503 });
    }
    ledger = records(ledgerResult.data);
  }

  const otherBusy = ledger.some((row) =>
    text(row.status) === "claimed" && text(row.claim_run_id) !== runId,
  );
  if (otherBusy) {
    return Response.json({ ok: false, error: "safe_claim_other_run_active" }, { status: 409 });
  }

  const existing = ledger.filter((row) =>
    text(row.status) === "claimed"
      && text(row.market_status) === "pending"
      && text(row.claim_run_id) === runId
      && !text(row.submit_armed_at),
  );
  const candidates = ledger.filter((row) =>
    text(row.status) === "queued"
      && text(row.market_status) === "pending"
      && !text(row.submit_armed_at),
  );

  let claimed: Record<string, unknown>[] = [];
  if (candidates.length) {
    const now = new Date().toISOString();
    const result = await admin
      .from(TABLE)
      .update({
        status: "claimed",
        claim_run_id: runId,
        claimed_at: now,
        reason_code: "safe_claim_claimed_v0337",
        message: "최신 SEO Shopling 6채널 원장 검증 후 안전 claim을 획득했습니다.",
        updated_at: now,
      })
      .eq("owner_id", owner)
      .in("goods_key", candidates.map((row) => text(row.goods_key)))
      .eq("status", "queued")
      .eq("market_status", "pending")
      .is("submit_armed_at", null)
      .select(LEDGER_SELECTION);
    if (result.error) {
      return Response.json({ ok: false, error: "safe_claim_update_failed" }, { status: 503 });
    }
    claimed = records(result.data);
  }

  // Final read makes the response summary reflect races and self-heal writes, not the
  // pre-repair snapshot. A partial concurrent claim never gets silently counted as ours.
  const finalRead = await readLedger();
  if (finalRead.error) {
    return Response.json({ ok: false, error: "safe_claim_final_read_failed" }, { status: 503 });
  }
  const finalLedger = records(finalRead.data);
  const finalExisting = finalLedger.filter((row) =>
    text(row.status) === "claimed"
      && text(row.market_status) === "pending"
      && text(row.claim_run_id) === runId
      && !text(row.submit_armed_at),
  );
  const taskRows = new Map<string, Record<string, unknown>>();
  for (const row of [...existing, ...claimed, ...finalExisting]) {
    const goodsKey = text(row.goods_key);
    if (goodsKey) taskRows.set(goodsKey, row);
  }
  const tasks = [...taskRows.values()].map(task).filter(Boolean);
  const done = finalLedger.filter((row) =>
    ["sent", "already_registered"].includes(text(row.status))
      || ["sent", "already_registered"].includes(text(row.market_status)),
  ).length;
  const finalPending = finalLedger.filter((row) =>
    text(row.status) === "queued"
      && text(row.market_status) === "pending"
      && !text(row.submit_armed_at),
  ).length;

  return Response.json({
    ok: true,
    bridge: BRIDGE,
    runId,
    jobId,
    tasks,
    taskCount: tasks.length,
    repair: {
      ledgerBackfilledCount,
      stalePreSubmitReleasedCount,
    },
    summary: {
      successCount: done,
      totalCount: 6,
      completed: done === 6,
      pendingCount: finalPending,
      busyCount: tasks.length,
      confirmNeededCount: 0,
    },
  });
}
