import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import {
  readProductLaunchError,
  readResponseJson,
  type ProductLaunchAdminConfig,
  type ProductLaunchIdentity,
} from "@/lib/productLaunchTrackerServer";
import type {
  SeoRunJobInsert,
  SeoRunJobRow,
} from "@/lib/seoRunJobServer";

export const LEGACY_SEO_RUN_JOB_TABLE = "legacy_seo_run_jobs";
const LEGACY_SEO_RUN_CLAIM_RPC = "claim_next_legacy_seo_run_job";
const MAX_LIST = 1000;
const LIST_SELECT = [
  "run_id",
  "owner_id",
  "owner_email",
  "batch_id",
  "launch_item_id",
  "tracker_row_number",
  "model_number",
  "product_name",
  "source_url",
  "status",
  "stage",
  "stage_index",
  "progress_percent",
  "message",
  "input_payload",
  "checkpoint_payload",
  "result_payload",
  "error_message",
  "attempt_count",
  "max_attempts",
  "not_before",
  "lease_owner",
  "lease_until",
  "registration_status",
  "registration_job_id",
  "registration_request_id",
  "registration_payload",
  "run_created_at",
  "started_at",
  "completed_at",
  "archived_at",
  "created_at",
  "updated_at",
].join(",");

type UnknownRecord = Record<string, unknown>;
export type LegacySeoRunJobContext = {
  config: ProductLaunchAdminConfig;
  identity: ProductLaunchIdentity;
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function postgrestIn(values: string[]) {
  return values
    .map((value) => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`)
    .join(",");
}

async function storage<T>(
  config: ProductLaunchAdminConfig,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      ...createSupabaseAdminHeaders(config.secretKey),
      ...(init.headers ?? {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const body = await readResponseJson(response);
  if (!response.ok) {
    throw new Error(readProductLaunchError(body, response.status));
  }
  return body as T;
}

export async function insertLegacySeoRunJobs(
  context: LegacySeoRunJobContext,
  rows: SeoRunJobInsert[],
) {
  if (!rows.length) return [];
  const payload = rows.map((row) => ({
    ...row,
    owner_id: context.identity.userId,
    owner_email: context.identity.email,
    status: row.status ?? "queued",
    stage: row.stage ?? "collect_source",
    stage_index: row.stage_index ?? 0,
    progress_percent: row.progress_percent ?? 0,
    message: row.message ?? "이전상품 서버 실행 대기",
    max_attempts: row.max_attempts ?? 5,
    not_before: row.not_before ?? new Date().toISOString(),
  }));
  const params = new URLSearchParams({ on_conflict: "run_id" });
  const saved = await storage<SeoRunJobRow[]>(
    context.config,
    `${LEGACY_SEO_RUN_JOB_TABLE}?${params.toString()}`,
    {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify(payload),
    },
  );
  return Array.isArray(saved) ? saved : [];
}

export async function listLegacySeoRunJobs(
  context: LegacySeoRunJobContext,
  options: {
    includeArchived?: boolean;
    runIds?: string[];
    launchItemIds?: string[];
    limit?: number;
  } = {},
) {
  const params = new URLSearchParams({
    select: LIST_SELECT,
    owner_id: `eq.${context.identity.userId}`,
    order: "run_created_at.asc,created_at.asc",
    limit: String(Math.max(1, Math.min(MAX_LIST, Math.trunc(options.limit ?? 600)))),
  });
  if (!options.includeArchived) params.set("archived_at", "is.null");
  const runIds = [...new Set((options.runIds ?? []).map(text).filter(Boolean))];
  if (runIds.length) params.set("run_id", `in.(${postgrestIn(runIds)})`);
  const itemIds = [...new Set((options.launchItemIds ?? []).map(text).filter(Boolean))];
  if (itemIds.length) params.set("launch_item_id", `in.(${postgrestIn(itemIds)})`);
  const rows = await storage<SeoRunJobRow[]>(
    context.config,
    `${LEGACY_SEO_RUN_JOB_TABLE}?${params.toString()}`,
  );
  return Array.isArray(rows) ? rows : [];
}

export async function patchOwnedLegacySeoRunJobs(
  context: LegacySeoRunJobContext,
  runIds: string[],
  patch: UnknownRecord,
) {
  const ids = [...new Set(runIds.map(text).filter(Boolean))].slice(0, 200);
  if (!ids.length) return [];
  const params = new URLSearchParams({
    select: LIST_SELECT,
    owner_id: `eq.${context.identity.userId}`,
    run_id: `in.(${postgrestIn(ids)})`,
  });
  const rows = await storage<SeoRunJobRow[]>(
    context.config,
    `${LEGACY_SEO_RUN_JOB_TABLE}?${params.toString()}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
    },
  );
  return Array.isArray(rows) ? rows : [];
}

export async function retryLegacySeoRunJobs(
  context: LegacySeoRunJobContext,
  runIds: string[],
) {
  return patchOwnedLegacySeoRunJobs(context, runIds, {
    status: "queued",
    error_message: "",
    attempt_count: 0,
    not_before: new Date().toISOString(),
    lease_owner: null,
    lease_until: null,
    completed_at: null,
    message: "저장된 체크포인트에서 이전상품 SEO 재실행 대기",
  });
}

export async function archiveLegacySeoRunJobs(
  context: LegacySeoRunJobContext,
  runIds: string[],
) {
  return patchOwnedLegacySeoRunJobs(context, runIds, {
    archived_at: new Date().toISOString(),
  });
}

export async function claimNextLegacySeoRunJob(
  config: ProductLaunchAdminConfig,
  workerId: string,
  leaseSeconds = 420,
) {
  const body = await storage<UnknownRecord>(
    config,
    `rpc/${LEGACY_SEO_RUN_CLAIM_RPC}`,
    {
      method: "POST",
      body: JSON.stringify({
        p_worker_id: workerId,
        p_lease_seconds: leaseSeconds,
      }),
    },
  );
  if (body.claimed !== true) return null;
  const job = record(body.job) as SeoRunJobRow;
  return text(job.run_id) ? job : null;
}

export async function patchClaimedLegacySeoRunJob(
  config: ProductLaunchAdminConfig,
  runId: string,
  workerId: string,
  patch: UnknownRecord,
) {
  const params = new URLSearchParams({
    select: "*",
    run_id: `eq.${runId}`,
    lease_owner: `eq.${workerId}`,
  });
  const rows = await storage<SeoRunJobRow[]>(
    config,
    `${LEGACY_SEO_RUN_JOB_TABLE}?${params.toString()}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
    },
  );
  const saved = Array.isArray(rows) ? rows[0] ?? null : null;
  if (!saved) throw new Error(`LEGACY_SEO_RUN_LEASE_LOST:${runId}`);
  return saved;
}

export async function readLegacySeoRunJobById(
  config: ProductLaunchAdminConfig,
  runId: string,
) {
  const params = new URLSearchParams({
    select: "*",
    run_id: `eq.${runId}`,
    limit: "1",
  });
  const rows = await storage<SeoRunJobRow[]>(
    config,
    `${LEGACY_SEO_RUN_JOB_TABLE}?${params.toString()}`,
  );
  return Array.isArray(rows) ? rows[0] ?? null : null;
}
