import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import {
  readProductLaunchError,
  readResponseJson,
} from "@/lib/productLaunchTrackerServer";
import type { SeoRunJobRow } from "@/lib/seoRunJobServer";
import type { LegacySeoRunJobContext } from "@/lib/legacySeoRunJobServer";

const TABLE = "legacy_seo_run_jobs";
const MAX_REGISTRATION_RUNS = 30;
const REGISTRATION_SELECT = [
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
  "result_payload",
  "error_message",
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
const REGISTRATION_PATCH_SELECT = [
  "run_id",
  "registration_status",
  "registration_job_id",
  "registration_request_id",
  "updated_at",
].join(",");

type UnknownRecord = Record<string, unknown>;

function text(value: unknown) {
  return String(value ?? "").trim();
}

function postgrestIn(values: string[]) {
  return values
    .map((value) => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`)
    .join(",");
}

function normalizeRunIds(runIds: string[], limit = MAX_REGISTRATION_RUNS) {
  return [...new Set(runIds.map(text).filter(Boolean))].slice(0, limit);
}

async function requestStorage<T>(
  context: LegacySeoRunJobContext,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${context.config.supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      ...createSupabaseAdminHeaders(context.config.secretKey),
      ...(init.headers ?? {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const body = await readResponseJson(response);
  if (!response.ok) throw new Error(readProductLaunchError(body, response.status));
  return body as T;
}

/**
 * Registration must never detoast the multi-megabyte checkpoint payload.
 * It only needs immutable input/final evidence plus registration state.
 */
export async function listLegacySeoRegistrationJobs(
  context: LegacySeoRunJobContext,
  runIds: string[],
) {
  const ids = normalizeRunIds(runIds);
  if (!ids.length) return [] as SeoRunJobRow[];
  const params = new URLSearchParams({
    select: REGISTRATION_SELECT,
    owner_id: `eq.${context.identity.userId}`,
    archived_at: "is.null",
    run_id: `in.(${postgrestIn(ids)})`,
    order: "run_created_at.asc,created_at.asc",
    limit: String(ids.length),
  });
  const rows = await requestStorage<SeoRunJobRow[]>(
    context,
    `${TABLE}?${params.toString()}`,
  );
  return Array.isArray(rows) ? rows : [];
}

/**
 * Registration status writes return only tiny identity/status columns. Returning
 * LIST_SELECT here used to detoast every checkpoint again after each PATCH.
 */
export async function patchLegacySeoRegistrationStatus(
  context: LegacySeoRunJobContext,
  runIds: string[],
  patch: UnknownRecord,
) {
  const ids = normalizeRunIds(runIds, 200);
  if (!ids.length) return [];
  const params = new URLSearchParams({
    select: REGISTRATION_PATCH_SELECT,
    owner_id: `eq.${context.identity.userId}`,
    run_id: `in.(${postgrestIn(ids)})`,
  });
  const rows = await requestStorage<Array<Record<string, unknown>>>(
    context,
    `${TABLE}?${params.toString()}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
    },
  );
  const saved = Array.isArray(rows) ? rows : [];
  if (saved.length !== ids.length) {
    throw new Error(
      `LEGACY_SEO_REGISTRATION_PATCH_MISMATCH: requested=${ids.length} saved=${saved.length}`,
    );
  }
  return saved;
}
