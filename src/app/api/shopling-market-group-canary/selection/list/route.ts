import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BRIDGE = "shopling-market-selection-v0.1";
const JOB_TABLE = "product_launch_upload_jobs";
const LEDGER_TABLE = "shopling_market_pipeline_ledger";
const SUCCESS_MARKET = new Set(["sent", "already_registered"]);
const BUSY_STATUS = new Set(["claimed"]);
const BUSY_MARKET = new Set(["submit_armed"]);
const CONFIRM_MARKET = new Set(["confirm_needed"]);
const LEGACY_UNKNOWN = new Set(["legacy_ignored"]);
const STALE_BUSY_MS = 3 * 60 * 1000;
const SAFE_PRE_SUBMIT_STALE_MS = 15 * 60 * 1000;
const DATE_FILTER_LIMIT = 1000;
const LOOKUP_CHUNK = 200;

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function rows(value: unknown) {
  return Array.isArray(value) ? value.map(record) : [];
}

function chunks<T>(values: T[], size = LOOKUP_CHUNK) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function resultRows(job: Record<string, unknown>) {
  return rows(record(job.result).rows)
    .map((row) => ({
      channelKey: text(row.channel_key),
      channel: text(row.channel),
      status: text(row.status),
      goodsKey: text(row.goods_key || row.goodsKey),
      ptnGoodsCd: text(row.ptn_goods_cd),
    }))
    .filter((row) => /^\d{5,9}$/.test(row.goodsKey) && row.channelKey);
}

function isSeoBulkJob(job: Record<string, unknown>) {
  const payload = record(job.payload);
  const seoFinal = record(payload.seoFinal);
  return text(seoFinal.source).startsWith("seo-bulk-cloud");
}

function isoParam(value: string | null) {
  const raw = text(value);
  if (!raw) return "";
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function ageMs(raw: unknown) {
  const timestamp = new Date(text(raw)).getTime();
  return Number.isFinite(timestamp) ? Date.now() - timestamp : -1;
}

function isStaleBusy(ledger: Record<string, unknown>) {
  const raw = ledger.submit_armed_at || ledger.updated_at || ledger.claimed_at;
  const age = ageMs(raw);
  return age >= STALE_BUSY_MS;
}

function isSafeStalePreSubmitClaim(ledger: Record<string, unknown>) {
  if (text(ledger.status) !== "claimed" || text(ledger.market_status) !== "pending") return false;
  if (text(ledger.submit_armed_at)) return false;
  const age = ageMs(ledger.claimed_at || ledger.updated_at);
  return age >= SAFE_PRE_SUBMIT_STALE_MS;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (text(url.searchParams.get("bridge")) !== BRIDGE) {
    return Response.json({ ok: false, error: "unsupported_shopling_market_selection_bridge" }, { status: 400 });
  }

  const rawFrom = text(url.searchParams.get("from"));
  const rawTo = text(url.searchParams.get("to"));
  const fromIso = isoParam(rawFrom);
  const toIso = isoParam(rawTo);
  if ((rawFrom && !fromIso) || (rawTo && !toIso) || (fromIso && toIso && fromIso >= toIso)) {
    return Response.json({ ok: false, error: "invalid_shopling_upload_date_range" }, { status: 400 });
  }
  const dateFiltered = Boolean(fromIso || toIso);
  const strictPending = text(url.searchParams.get("strict_pending")) === "1";
  const fromExclusiveIso = fromIso
    ? new Date(new Date(fromIso).getTime() - 1).toISOString()
    : "";

  const supabase = await createSupabaseAdminClient();
  if (!supabase) {
    return Response.json({ ok: false, error: "supabase_admin_unavailable" }, { status: 503 });
  }

  let jobsQuery = supabase
    .from(JOB_TABLE)
    .select("id,owner_id,launch_item_id,status,payload,result,created_at,completed_at")
    .in("status", ["success", "partial_failure"])
    .order("completed_at", { ascending: false });
  if (fromExclusiveIso) jobsQuery = jobsQuery.gt("completed_at", fromExclusiveIso);
  if (toIso) jobsQuery = jobsQuery.lt("completed_at", toIso);
  const jobsResult = await jobsQuery.limit(dateFiltered ? DATE_FILTER_LIMIT : 120);
  if (jobsResult.error) {
    return Response.json(
      { ok: false, error: "shopling_market_selection_jobs_failed", message: jobsResult.error.message },
      { status: 503 },
    );
  }

  const jobs = (Array.isArray(jobsResult.data) ? jobsResult.data : [])
    .map(record)
    .filter(isSeoBulkJob)
    .slice(0, dateFiltered ? DATE_FILTER_LIMIT : 50);

  const launchItemIds = [...new Set(jobs.map((job) => text(job.launch_item_id)).filter(Boolean))];
  const latestBatchByLaunch = new Map<string, string>();
  for (const launchChunk of chunks(launchItemIds)) {
    const latestResult = await supabase
      .from(JOB_TABLE)
      .select("id,launch_item_id,status,payload,completed_at,created_at")
      .in("launch_item_id", launchChunk)
      .in("status", ["success", "partial_failure"])
      .order("completed_at", { ascending: false })
      .limit(Math.min(1000, Math.max(launchChunk.length * 8, launchChunk.length)));
    if (latestResult.error) {
      return Response.json(
        { ok: false, error: "shopling_market_selection_latest_batch_failed", message: latestResult.error.message },
        { status: 503 },
      );
    }
    for (const raw of Array.isArray(latestResult.data) ? latestResult.data : []) {
      const job = record(raw);
      if (!isSeoBulkJob(job)) continue;
      const launchItemId = text(job.launch_item_id);
      const jobId = text(job.id);
      if (launchItemId && jobId && !latestBatchByLaunch.has(launchItemId)) {
        latestBatchByLaunch.set(launchItemId, jobId);
      }
    }
  }

  const allGoodsKeys = [...new Set(jobs.flatMap((job) => resultRows(job).map((row) => row.goodsKey)))];
  const ledgerByGoodsKey = new Map<string, Record<string, unknown>>();
  for (const goodsChunk of chunks(allGoodsKeys)) {
    const ledgerResult = await supabase
      .from(LEDGER_TABLE)
      .select("goods_key,status,market_status,reason_code,message,claimed_at,submit_armed_at,updated_at")
      .in("goods_key", goodsChunk)
      .limit(goodsChunk.length);
    if (ledgerResult.error) {
      return Response.json(
        { ok: false, error: "shopling_market_selection_ledger_failed", message: ledgerResult.error.message },
        { status: 503 },
      );
    }
    for (const raw of Array.isArray(ledgerResult.data) ? ledgerResult.data : []) {
      const row = record(raw);
      const goodsKey = text(row.goods_key);
      if (goodsKey) ledgerByGoodsKey.set(goodsKey, row);
    }
  }

  const items = jobs.map((job) => {
    const payload = record(job.payload);
    const seoFinal = record(payload.seoFinal);
    const uploadRows = resultRows(job);
    const successfulRows = uploadRows.filter((row) => row.status === "success");
    let marketDoneCount = 0;
    let confirmNeededCount = 0;
    let activeBusyCount = 0;
    let staleBusyCount = 0;
    let pendingCount = 0;
    let registrationUnknownCount = 0;
    let recoverablePreSubmitCount = 0;

    for (const row of successfulRows) {
      const ledger = ledgerByGoodsKey.get(row.goodsKey);
      const status = text(ledger?.status);
      const marketStatus = text(ledger?.market_status);
      if (SUCCESS_MARKET.has(status) || SUCCESS_MARKET.has(marketStatus)) {
        marketDoneCount += 1;
      } else if (CONFIRM_MARKET.has(status) || CONFIRM_MARKET.has(marketStatus)) {
        confirmNeededCount += 1;
      } else if (ledger && isSafeStalePreSubmitClaim(ledger)) {
        // The browser stopped before the durable submit boundary. claim-all already
        // releases this exact state after 15 minutes, so it is safe to present as
        // a pending channel rather than hiding the product forever after a reboot.
        pendingCount += 1;
        recoverablePreSubmitCount += 1;
      } else if (BUSY_STATUS.has(status) || BUSY_MARKET.has(marketStatus)) {
        if (ledger && isStaleBusy(ledger)) staleBusyCount += 1;
        else activeBusyCount += 1;
      } else if (LEGACY_UNKNOWN.has(status) || LEGACY_UNKNOWN.has(marketStatus)) {
        registrationUnknownCount += 1;
      } else {
        pendingCount += 1;
      }
    }

    const jobId = text(job.id);
    const launchItemId = text(job.launch_item_id);
    const isLatestBatch = latestBatchByLaunch.get(launchItemId) === jobId;
    const uploadSuccessCount = successfulRows.length;
    const uploadReady = text(job.status) === "success" && uploadSuccessCount === 6;
    const actionableCount = pendingCount + registrationUnknownCount + confirmNeededCount + staleBusyCount;
    const strictSelectable = isLatestBatch
      && uploadReady
      && activeBusyCount === 0
      && staleBusyCount === 0
      && confirmNeededCount === 0
      && registrationUnknownCount === 0
      && pendingCount > 0
      && marketDoneCount < 6;
    const recoverySelectable = isLatestBatch
      && uploadReady
      && activeBusyCount === 0
      && actionableCount > 0
      && marketDoneCount < 6;
    const selectable = strictPending ? strictSelectable : recoverySelectable;
    const modelNumber = text(payload.modelNumber) || text(seoFinal.modelNumber);
    const modelName = text(payload.modelName) || text(seoFinal.productName) || modelNumber;

    let selectionReason = "ready";
    if (!isLatestBatch) selectionReason = "superseded_batch";
    else if (!uploadReady) selectionReason = "shopling_upload_incomplete";
    else if (activeBusyCount > 0) selectionReason = "active_market_work";
    else if (strictPending && staleBusyCount > 0) selectionReason = "stale_work_requires_review";
    else if (strictPending && confirmNeededCount > 0) selectionReason = "confirm_needed_requires_review";
    else if (strictPending && registrationUnknownCount > 0) selectionReason = "legacy_unknown_requires_review";
    else if (marketDoneCount >= 6) selectionReason = "market_completed";
    else if (pendingCount <= 0) selectionReason = "no_fresh_pending_channel";

    return {
      jobId,
      batchIdShort: jobId.slice(0, 8),
      launchItemId,
      isLatestBatch,
      batchState: isLatestBatch ? "latest" : "superseded",
      modelNumber,
      modelName,
      completedAt: text(job.completed_at || job.created_at),
      uploadStatus: text(job.status),
      uploadSuccessCount,
      uploadTotalCount: uploadRows.length,
      marketDoneCount,
      marketPendingCount: pendingCount,
      recoverablePreSubmitCount,
      registrationUnknownCount,
      confirmNeededCount,
      activeBusyCount,
      staleBusyCount,
      busyCount: activeBusyCount + staleBusyCount,
      actionableCount,
      selectable,
      selectionReason,
      channels: successfulRows,
    };
  });

  const selectableItems = items.filter((item) => item.selectable);
  return Response.json(
    {
      ok: true,
      bridge: BRIDGE,
      filter: {
        from: fromIso,
        to: toIso,
        strictPending,
        basis: "shopling_upload_completed_at",
      },
      items,
      count: items.length,
      channelCount: items.reduce((sum, item) => sum + item.uploadSuccessCount, 0),
      selectableCount: selectableItems.length,
      selectableChannelCount: selectableItems.reduce((sum, item) => sum + item.marketPendingCount, 0),
      recoverablePreSubmitCount: items.reduce((sum, item) => sum + item.recoverablePreSubmitCount, 0),
      completedCount: items.filter((item) => item.marketDoneCount >= 6).length,
      reviewCount: items.filter((item) => ["stale_work_requires_review", "confirm_needed_requires_review", "legacy_unknown_requires_review", "active_market_work"].includes(item.selectionReason)).length,
    },
    {
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
