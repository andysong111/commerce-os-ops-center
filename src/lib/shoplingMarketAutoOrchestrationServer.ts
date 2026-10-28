import { createHash, randomBytes } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  listSeoRunJobs,
  patchOwnedSeoRunJobs,
  type SeoRunJobContext,
} from "@/lib/seoRunJobServer";
import {
  marketAutoRunIdSetsEqual,
  marketAutoRunIdSetsOverlap,
  marketOnlyLedgerSafety,
  normalizeMarketAutoRunIds,
  verifiedMarketOnlyUploadJob,
} from "@/lib/shoplingMarketAutoResumePolicy";

const TABLE = "shopling_market_auto_orchestrations";
const SEO_TABLE = "seo_run_jobs";
const UPLOAD_TABLE = "product_launch_upload_jobs";
const LEDGER_TABLE = "shopling_market_pipeline_ledger";
export const MARKET_AUTO_AGENT_BRIDGE = "shopling-market-auto-agent-v0.1";
const LEASE_SECONDS = 180;
const CHUNK_SIZE = 20;
const LOOKUP_CHUNK_SIZE = 180;
const TERMINAL_STATES = new Set([
  "completed",
  "completed_with_exceptions",
  "exception",
  "cancelled",
]);
const ACTIVE_STATES = [
  "waiting_upload",
  "uploading",
  "market_ready",
  "market_claimed",
  "market_running",
];

type UnknownRecord = Record<string, unknown>;
type AdminClient = NonNullable<Awaited<ReturnType<typeof createSupabaseAdminClient>>>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function array(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function uniqueIds(value: unknown, limit = 250) {
  return normalizeMarketAutoRunIds(value, limit);
}

function validUuid(value: unknown) {
  const normalized = text(value);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)
    ? normalized
    : "";
}

export function validMarketAutoAgentId(value: unknown) {
  const normalized = text(value);
  return /^[A-Za-z0-9._:-]{12,180}$/.test(normalized) ? normalized : "";
}

export function validMarketAutoToken(value: unknown) {
  const normalized = text(value);
  return /^[A-Za-z0-9_-]{32,180}$/.test(normalized) ? normalized : "";
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function chunks<T>(values: T[], size = LOOKUP_CHUNK_SIZE) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function handoffToken(value: unknown) {
  const supplied = text(value);
  if (!supplied) return randomBytes(32).toString("base64url");
  const valid = validMarketAutoToken(supplied);
  if (!valid) throw new Error("원클릭 작업 재개 토큰이 올바르지 않습니다.");
  return valid;
}

function leaseIso(seconds = LEASE_SECONDS) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function registrationJobIds(rows: UnknownRecord[]) {
  return [...new Set(
    rows
      .filter((row) => text(row.registration_status) === "success")
      .map((row) => validUuid(row.registration_job_id))
      .filter(Boolean),
  )];
}

function jobGoodsKeys(job: UnknownRecord) {
  return [...new Set(
    array(record(job.result).rows)
      .map(record)
      .filter((row) => text(row.status) === "success")
      .map((row) => text(row.goods_key || row.goodsKey))
      .filter((key) => /^\d{5,9}$/.test(key)),
  )].slice(0, 6);
}

async function requireAdmin() {
  const supabase = await createSupabaseAdminClient();
  if (!supabase) throw new Error("supabase_admin_unavailable");
  return supabase;
}

async function readOrchestrationByTokenHash(
  supabase: AdminClient,
  ownerId: string,
  tokenHash: string,
) {
  const result = await supabase
    .from(TABLE)
    .select("*")
    .eq("owner_id", ownerId)
    .eq("token_hash", tokenHash)
    .limit(1)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return result.data ? record(result.data) : null;
}

async function assertNoActiveRunOverlap(
  supabase: AdminClient,
  ownerId: string,
  runIds: string[],
) {
  const result = await supabase
    .from(TABLE)
    .select("id,run_ids,state")
    .eq("owner_id", ownerId)
    .in("state", ACTIVE_STATES)
    .order("created_at", { ascending: false })
    .limit(30);
  if (result.error) throw new Error(result.error.message);
  const overlap = (Array.isArray(result.data) ? result.data : [])
    .map(record)
    .find((row) => marketAutoRunIdSetsOverlap(row.run_ids, runIds));
  if (overlap) {
    throw new Error(
      `같은 상품의 마켓전송 작업이 이미 진행 중입니다. 작업번호 ${text(overlap.id).slice(0, 8)}`,
    );
  }
}

async function insertOrRecoverOrchestration(
  supabase: AdminClient,
  ownerId: string,
  tokenHash: string,
  payload: UnknownRecord,
) {
  let lastMessage = "원클릭 작업 생성 실패";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const insertResult = await supabase
      .from(TABLE)
      .insert(payload)
      .select("*")
      .limit(1)
      .maybeSingle();
    if (!insertResult.error && insertResult.data) return record(insertResult.data);
    lastMessage = insertResult.error?.message || lastMessage;
    try {
      const recovered = await readOrchestrationByTokenHash(
        supabase,
        ownerId,
        tokenHash,
      );
      if (recovered) return recovered;
    } catch (error) {
      lastMessage = error instanceof Error ? error.message : lastMessage;
    }
    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
  throw new Error(lastMessage);
}

async function readByToken(token: string) {
  const supabase = await requireAdmin();
  const result = await supabase
    .from(TABLE)
    .select("*")
    .eq("token_hash", hashToken(token))
    .limit(1)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return { supabase, row: result.data ? record(result.data) : null };
}

async function readSeoRows(supabase: AdminClient, ownerId: string, runIds: string[]) {
  if (!runIds.length) return [] as UnknownRecord[];
  const result = await supabase
    .from(SEO_TABLE)
    .select("run_id,batch_id,model_number,status,registration_status,registration_job_id,error_message,updated_at")
    .eq("owner_id", ownerId)
    .in("run_id", runIds)
    .limit(Math.max(1, runIds.length));
  if (result.error) throw new Error(result.error.message);
  return (Array.isArray(result.data) ? result.data : []).map(record);
}

async function readUploadJobs(
  supabase: AdminClient,
  ownerId: string,
  jobIds: string[],
) {
  if (!jobIds.length) return [] as UnknownRecord[];
  const result = await supabase
    .from(UPLOAD_TABLE)
    .select("id,owner_id,status,result")
    .eq("owner_id", ownerId)
    .in("id", jobIds)
    .limit(jobIds.length);
  if (result.error) throw new Error(result.error.message);
  return (Array.isArray(result.data) ? result.data : []).map(record);
}

async function readMarketLedgerRows(
  supabase: AdminClient,
  ownerId: string,
  goodsKeys: string[],
) {
  const rows: UnknownRecord[] = [];
  for (const goodsKeyChunk of chunks(goodsKeys)) {
    const result = await supabase
      .from(LEDGER_TABLE)
      .select("goods_key,status,market_status")
      .eq("owner_id", ownerId)
      .in("goods_key", goodsKeyChunk)
      .limit(goodsKeyChunk.length);
    if (result.error) throw new Error(result.error.message);
    rows.push(...(Array.isArray(result.data) ? result.data : []).map(record));
  }
  return rows;
}

async function patchOrchestration(supabase: AdminClient, id: string, patch: UnknownRecord) {
  const result = await supabase
    .from(TABLE)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .limit(1)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return result.data ? record(result.data) : null;
}

export async function computeMarketSummary(
  supabase: AdminClient,
  ownerId: string,
  seoRows: UnknownRecord[],
) {
  const successfulJobIds = registrationJobIds(seoRows);
  const failedUploadRunIds = seoRows
    .filter((row) => text(row.registration_status) === "failed")
    .map((row) => text(row.run_id))
    .filter(Boolean);
  if (!successfulJobIds.length) {
    return {
      terminal: failedUploadRunIds.length > 0,
      successfulJobIds,
      failedUploadRunIds,
      products: [] as Array<UnknownRecord>,
      completedProducts: 0,
      exceptionProducts: 0,
      busyProducts: 0,
    };
  }

  const jobsResult = await supabase
    .from(UPLOAD_TABLE)
    .select("id,owner_id,status,result")
    .eq("owner_id", ownerId)
    .in("id", successfulJobIds)
    .limit(successfulJobIds.length);
  if (jobsResult.error) throw new Error(jobsResult.error.message);
  const jobs = (Array.isArray(jobsResult.data) ? jobsResult.data : []).map(record);
  const allGoodsKeys = [...new Set(jobs.flatMap(jobGoodsKeys))];
  const ledgerRows: UnknownRecord[] = [];
  if (allGoodsKeys.length) {
    const ledgerResult = await supabase
      .from(LEDGER_TABLE)
      .select("goods_key,status,market_status")
      .eq("owner_id", ownerId)
      .in("goods_key", allGoodsKeys)
      .limit(Math.max(6, allGoodsKeys.length));
    if (ledgerResult.error) throw new Error(ledgerResult.error.message);
    ledgerRows.push(...(Array.isArray(ledgerResult.data) ? ledgerResult.data : []).map(record));
  }
  const ledgerByKey = new Map(ledgerRows.map((row) => [text(row.goods_key), row] as const));

  const products = jobs.map((job) => {
    const jobId = text(job.id);
    const goodsKeys = jobGoodsKeys(job);
    const rows = goodsKeys.map((key) => ledgerByKey.get(key)).filter(Boolean) as UnknownRecord[];
    const done = rows.filter((row) =>
      ["sent", "already_registered"].includes(text(row.status)) ||
      ["sent", "already_registered"].includes(text(row.market_status)),
    ).length;
    const confirm = rows.filter((row) =>
      text(row.status) === "confirm_needed" || text(row.market_status) === "confirm_needed",
    ).length;
    const busy = rows.filter((row) =>
      text(row.status) === "claimed" || text(row.market_status) === "submit_armed",
    ).length;
    const pending = rows.filter((row) =>
      text(row.status) === "queued" && text(row.market_status) === "pending",
    ).length;
    const terminal = goodsKeys.length === 6 && rows.length === 6 && done + confirm >= 6 && busy === 0 && pending === 0;
    return { jobId, goodsKeys, done, confirm, busy, pending, terminal };
  });
  const completedProducts = products.filter((row) => row.terminal && row.done === 6).length;
  const exceptionProducts = products.filter((row) => row.terminal && row.done < 6).length;
  const missingJobIds = successfulJobIds.filter((jobId) => !products.some((row) => row.jobId === jobId));
  const busyProducts = products.filter((row) => !row.terminal).length + missingJobIds.length;
  const terminal = products.length === successfulJobIds.length && busyProducts === 0;
  return {
    terminal,
    successfulJobIds,
    failedUploadRunIds,
    products,
    completedProducts,
    exceptionProducts,
    busyProducts,
    missingJobIds,
  };
}

function remainingMarketJobIds(summary: Awaited<ReturnType<typeof computeMarketSummary>>) {
  const unfinished = summary.products
    .filter((row) => row.terminal !== true)
    .map((row) => text(row.jobId))
    .filter(Boolean);
  const missing = Array.isArray(summary.missingJobIds) ? summary.missingJobIds.map(text).filter(Boolean) : [];
  return [...new Set([...unfinished, ...missing])].slice(0, CHUNK_SIZE);
}

async function completeIfTerminal(
  supabase: AdminClient,
  orchestrationId: string,
  summary: Awaited<ReturnType<typeof computeMarketSummary>>,
) {
  if (!summary.terminal) return null;
  const state = summary.failedUploadRunIds.length || summary.exceptionProducts
    ? "completed_with_exceptions"
    : "completed";
  await patchOrchestration(supabase, orchestrationId, {
    state,
    completed_at: new Date().toISOString(),
    lease_until: null,
    error_message: state === "completed" ? "" : "일부 Shopling 업로드 또는 마켓 채널이 확인필요로 종료되었습니다.",
    result: summary,
  });
  return { state, summary };
}

export async function createMarketAutoOrchestration(
  context: SeoRunJobContext,
  rawRunIds: unknown,
  rawHandoffToken?: unknown,
) {
  const runIds = uniqueIds(rawRunIds);
  if (!runIds.length) throw new Error("원클릭 등록 대상으로 선택할 SEO RUN이 없습니다.");
  const current = await listSeoRunJobs(context, {
    runIds,
    includeArchived: false,
    limit: runIds.length,
  });
  const accepted = current.filter(
    (job) => job.status === "ready" && job.registration_status !== "failed",
  );
  if (!accepted.length) throw new Error("FINAL 완료 상태의 Shopling 등록 가능 RUN이 없습니다.");

  const token = handoffToken(rawHandoffToken);
  const tokenHash = hashToken(token);
  const supabase = await requireAdmin();
  const acceptedRunIds = accepted.map((job) => job.run_id);
  const batchIds = [...new Set(accepted.map((job) => text(job.batch_id)).filter(Boolean))];
  let inserted = await readOrchestrationByTokenHash(
    supabase,
    context.identity.userId,
    tokenHash,
  );
  if (inserted) {
    if (
      !marketAutoRunIdSetsEqual(inserted.run_ids, acceptedRunIds) ||
      text(record(inserted.result).mode || "full_pipeline") !== "full_pipeline"
    ) {
      throw new Error("같은 재개 토큰이 다른 원클릭 작업에 사용되었습니다.");
    }
  } else {
    await assertNoActiveRunOverlap(
      supabase,
      context.identity.userId,
      acceptedRunIds,
    );
    inserted = await insertOrRecoverOrchestration(
      supabase,
      context.identity.userId,
      tokenHash,
      {
      owner_id: context.identity.userId,
      owner_email: context.identity.email,
      batch_id: batchIds.length === 1 ? batchIds[0] : `mixed-${crypto.randomUUID()}`,
      run_ids: acceptedRunIds,
      token_hash: tokenHash,
      state: accepted.some((job) => job.registration_status === "success") ? "uploading" : "waiting_upload",
      result: {
        mode: "full_pipeline",
        requestedCount: runIds.length,
        acceptedCount: acceptedRunIds.length,
      },
    });
  }
  const orchestrationId = text(inserted.id);
  if (TERMINAL_STATES.has(text(inserted.state))) {
    return {
      orchestrationId,
      state: text(inserted.state),
      handoffToken: token,
      requestedCount: runIds.length,
      acceptedCount: acceptedRunIds.length,
      uploadQueuedCount: 0,
      skippedCount: Math.max(0, runIds.length - acceptedRunIds.length),
      needsWorkerWake: false,
      idempotentReplay: true,
    };
  }
  const queueRunIds = accepted
    .filter((job) => job.registration_status === "idle")
    .map((job) => job.run_id);
  try {
    if (queueRunIds.length) {
      await patchOwnedSeoRunJobs(context, queueRunIds, {
        registration_status: "queued",
        registration_job_id: "",
        registration_request_id: "",
      });
    }
  } catch (error) {
    await patchOrchestration(supabase, orchestrationId, {
      state: "exception",
      completed_at: new Date().toISOString(),
      error_message: error instanceof Error ? error.message : "Shopling 업로드 큐 연결 실패",
    }).catch(() => null);
    throw error;
  }
  return {
    orchestrationId,
    state: text(inserted.state) || "waiting_upload",
    handoffToken: token,
    requestedCount: runIds.length,
    acceptedCount: acceptedRunIds.length,
    uploadQueuedCount: queueRunIds.length,
    skippedCount: Math.max(0, runIds.length - acceptedRunIds.length),
    needsWorkerWake: queueRunIds.length > 0 || accepted.some((job) => ["submitting", "queued", "running"].includes(job.registration_status)),
  };
}

export async function createMarketOnlyOrchestration(
  context: SeoRunJobContext,
  rawRunIds: unknown,
  rawHandoffToken: unknown,
) {
  const runIds = uniqueIds(rawRunIds);
  if (!runIds.length) throw new Error("마켓전송만 재개할 SEO RUN이 없습니다.");
  const token = handoffToken(rawHandoffToken);
  const tokenHash = hashToken(token);
  const supabase = await requireAdmin();

  const existing = await readOrchestrationByTokenHash(
    supabase,
    context.identity.userId,
    tokenHash,
  );
  if (existing) {
    if (
      !marketAutoRunIdSetsEqual(existing.run_ids, runIds) ||
      text(record(existing.result).mode) !== "market_only"
    ) {
      throw new Error("같은 재개 토큰이 다른 마켓전송 작업에 사용되었습니다.");
    }
    return {
      orchestrationId: text(existing.id),
      state: text(existing.state),
      handoffToken: token,
      requestedCount: runIds.length,
      acceptedCount: runIds.length,
      uploadQueuedCount: 0,
      skippedCount: 0,
      needsWorkerWake: false,
      marketOnly: true,
      idempotentReplay: true,
    };
  }

  const current = await listSeoRunJobs(context, {
    runIds,
    includeArchived: false,
    limit: runIds.length,
  });
  const accepted = current.filter(
    (job) => job.status === "ready" && job.registration_status === "success",
  );
  if (accepted.length !== runIds.length) {
    throw new Error(
      `마켓전송만 재개 조건을 충족한 상품은 ${accepted.length}/${runIds.length}개입니다. Shopling 등록 성공·재조회 완료 건만 가능합니다.`,
    );
  }
  const jobIds = accepted
    .map((job) => validUuid(job.registration_job_id))
    .filter(Boolean);
  if (jobIds.length !== accepted.length || new Set(jobIds).size !== accepted.length) {
    throw new Error("Shopling 등록 성공 작업번호가 빠졌거나 중복되어 재개를 중단했습니다.");
  }
  const uploadJobs = await readUploadJobs(
    supabase,
    context.identity.userId,
    jobIds,
  );
  const verifiedJobs = uploadJobs
    .map(verifiedMarketOnlyUploadJob)
    .filter((job): job is NonNullable<typeof job> => Boolean(job));
  if (verifiedJobs.length !== accepted.length) {
    throw new Error(
      `Shopling 실상품 재조회까지 검증된 작업은 ${verifiedJobs.length}/${accepted.length}개입니다. 검증되지 않은 상품은 전송하지 않습니다.`,
    );
  }
  const verifiedJobIds = new Set(verifiedJobs.map((job) => job.jobId));
  if (jobIds.some((jobId) => !verifiedJobIds.has(jobId))) {
    throw new Error("선택한 Shopling 등록 작업과 실상품 재조회 결과가 일치하지 않습니다.");
  }
  const goodsKeys = verifiedJobs.flatMap((job) => job.goodsKeys);
  if (new Set(goodsKeys).size !== accepted.length * 6) {
    throw new Error("상품 간 goods_key가 중복되어 마켓전송만 재개를 중단했습니다.");
  }
  const ledgerRows = await readMarketLedgerRows(
    supabase,
    context.identity.userId,
    goodsKeys,
  );
  const ledgerSafety = marketOnlyLedgerSafety(goodsKeys, ledgerRows);
  if (!ledgerSafety.safe) {
    throw new Error(
      `이미 처리 중이거나 확인이 필요한 마켓전송 ${ledgerSafety.busyCount + ledgerSafety.blockedCount}건이 있어 중복 전송을 막았습니다.`,
    );
  }
  if (ledgerSafety.allCompleted) {
    throw new Error("선택한 상품은 이미 모든 마켓전송이 완료되었습니다.");
  }

  await assertNoActiveRunOverlap(
    supabase,
    context.identity.userId,
    runIds,
  );
  const batchIds = [...new Set(accepted.map((job) => text(job.batch_id)).filter(Boolean))];
  const inserted = await insertOrRecoverOrchestration(
    supabase,
    context.identity.userId,
    tokenHash,
    {
      owner_id: context.identity.userId,
      owner_email: context.identity.email,
      batch_id: batchIds.length === 1 ? batchIds[0] : `mixed-market-only-${crypto.randomUUID()}`,
      run_ids: runIds,
      token_hash: tokenHash,
      state: "market_ready",
      result: {
        mode: "market_only",
        requestedCount: runIds.length,
        acceptedCount: runIds.length,
        verifiedProductCount: verifiedJobs.length,
        verifiedGoodsKeyCount: goodsKeys.length,
        marketPendingCount: ledgerSafety.pendingCount,
        marketCompletedCount: ledgerSafety.completedCount,
      },
    },
  );
  return {
    orchestrationId: text(inserted.id),
    state: text(inserted.state) || "market_ready",
    handoffToken: token,
    requestedCount: runIds.length,
    acceptedCount: runIds.length,
    uploadQueuedCount: 0,
    skippedCount: 0,
    verifiedGoodsKeyCount: goodsKeys.length,
    needsWorkerWake: false,
    marketOnly: true,
  };
}

export async function listMarketAutoOrchestrations(ownerId: string) {
  const supabase = await requireAdmin();
  const result = await supabase
    .from(TABLE)
    .select("id,batch_id,run_ids,state,agent_id,lease_until,heartbeat_at,market_started_at,completed_at,error_message,result,created_at,updated_at")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false })
    .limit(12);
  if (result.error) throw new Error(result.error.message);
  return Array.isArray(result.data) ? result.data : [];
}

export async function pollMarketAutoAgent(token: string, agentId: string) {
  const found = await readByToken(token);
  if (!found.row) throw new Error("market_auto_token_not_found");
  const row = found.row;
  const orchestrationId = text(row.id);
  const state = text(row.state);
  if (TERMINAL_STATES.has(state)) {
    return { terminal: true, ready: false, state, orchestrationId, result: record(row.result) };
  }
  const ownerId = text(row.owner_id);
  const runIds = uniqueIds(row.run_ids);
  const seoRows = await readSeoRows(found.supabase, ownerId, runIds);
  const pendingUploads = seoRows.filter((job) => !["success", "failed"].includes(text(job.registration_status)));
  const successfulJobIds = registrationJobIds(seoRows);
  const failedUploadRunIds = seoRows.filter((job) => text(job.registration_status) === "failed").map((job) => text(job.run_id)).filter(Boolean);
  if (pendingUploads.length) {
    if (!["market_claimed", "market_running"].includes(state)) {
      await patchOrchestration(found.supabase, orchestrationId, {
        state: successfulJobIds.length ? "uploading" : "waiting_upload",
        result: { uploadReadyCount: successfulJobIds.length, uploadPendingCount: pendingUploads.length, failedUploadRunIds },
      });
    }
    return {
      terminal: false,
      ready: false,
      state: "uploading",
      orchestrationId,
      uploadReadyCount: successfulJobIds.length,
      uploadPendingCount: pendingUploads.length,
      failedUploadRunIds,
    };
  }

  const summary = await computeMarketSummary(found.supabase, ownerId, seoRows);
  const completed = await completeIfTerminal(found.supabase, orchestrationId, summary);
  if (completed) {
    return { terminal: true, ready: false, orchestrationId, ...completed };
  }
  if (!successfulJobIds.length) {
    await patchOrchestration(found.supabase, orchestrationId, {
      state: "exception",
      completed_at: new Date().toISOString(),
      error_message: "마켓전송 가능한 Shopling 업로드 성공 건이 없습니다.",
      result: summary,
    });
    return { terminal: true, ready: false, state: "exception", orchestrationId, result: summary };
  }

  const jobIds = remainingMarketJobIds(summary);
  if (!jobIds.length) {
    return { terminal: false, ready: false, state: "market_ready", orchestrationId, result: summary };
  }
  const leaseUntil = Date.parse(text(row.lease_until));
  const leaseActive = Number.isFinite(leaseUntil) && leaseUntil > Date.now();
  const currentAgent = text(row.agent_id);
  if (leaseActive && currentAgent && currentAgent !== agentId) {
    return { terminal: false, ready: false, busy: true, state, orchestrationId };
  }
  await patchOrchestration(found.supabase, orchestrationId, {
    state: state === "market_running" ? "market_running" : "market_claimed",
    agent_id: agentId,
    lease_until: leaseIso(),
    heartbeat_at: new Date().toISOString(),
    market_started_at: row.market_started_at || new Date().toISOString(),
    result: summary,
  });
  return {
    terminal: false,
    ready: true,
    resume: ["market_claimed", "market_running"].includes(state),
    state: "market_claimed",
    orchestrationId,
    jobIds,
    failedUploadRunIds,
    leaseSeconds: LEASE_SECONDS,
  };
}

export async function heartbeatMarketAutoAgent(token: string, agentId: string) {
  const found = await readByToken(token);
  if (!found.row) throw new Error("market_auto_token_not_found");
  const row = found.row;
  const state = text(row.state);
  if (TERMINAL_STATES.has(state)) return { terminal: true, state, orchestrationId: text(row.id) };
  const leaseUntil = Date.parse(text(row.lease_until));
  const currentAgent = text(row.agent_id);
  if (currentAgent && currentAgent !== agentId && Number.isFinite(leaseUntil) && leaseUntil > Date.now()) {
    throw new Error("market_auto_agent_lease_mismatch");
  }
  await patchOrchestration(found.supabase, text(row.id), {
    state: "market_running",
    agent_id: agentId,
    lease_until: leaseIso(),
    heartbeat_at: new Date().toISOString(),
    market_started_at: row.market_started_at || new Date().toISOString(),
  });
  return { terminal: false, state: "market_running", orchestrationId: text(row.id), leaseSeconds: LEASE_SECONDS };
}

export async function reportMarketAutoAgent(token: string, agentId: string) {
  const found = await readByToken(token);
  if (!found.row) throw new Error("market_auto_token_not_found");
  const row = found.row;
  const leaseUntil = Date.parse(text(row.lease_until));
  const currentAgent = text(row.agent_id);
  if (currentAgent && currentAgent !== agentId && Number.isFinite(leaseUntil) && leaseUntil > Date.now()) {
    throw new Error("market_auto_agent_lease_mismatch");
  }
  const seoRows = await readSeoRows(found.supabase, text(row.owner_id), uniqueIds(row.run_ids));
  const summary = await computeMarketSummary(found.supabase, text(row.owner_id), seoRows);
  const completed = await completeIfTerminal(found.supabase, text(row.id), summary);
  if (completed) return { terminal: true, orchestrationId: text(row.id), ...completed };
  await patchOrchestration(found.supabase, text(row.id), {
    state: "market_ready",
    agent_id: agentId,
    lease_until: null,
    heartbeat_at: new Date().toISOString(),
    result: summary,
  });
  return { terminal: false, state: "market_ready", orchestrationId: text(row.id), result: summary };
}
