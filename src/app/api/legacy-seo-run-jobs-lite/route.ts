import { NextRequest } from "next/server";
import { readProductLaunchStorageJson } from "@/lib/productLaunchTrackerServer";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import { requireSeoTitleLedgerContext } from "@/lib/seoTitleLedgerServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const JOB_LIMIT = 800;
const ITEM_LIMIT = 1000;

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function list(value: unknown, limit = 100) {
  if (!Array.isArray(value)) return [] as string[];
  return [...new Set(value.map(text).filter(Boolean))].slice(0, limit);
}

function isExcluded(value: unknown) {
  return record(value).excluded === true;
}

async function listCompactJobs(
  config: { supabaseUrl: string; secretKey: string },
  ownerId: string,
) {
  const params = new URLSearchParams({
    select: [
      "run_id",
      "launch_item_id",
      "tracker_row_number",
      "model_number",
      "product_name",
      "source_url",
      "status",
      "stage",
      "progress_percent",
      "message",
      "input_payload",
      "result_payload",
      "error_message",
      "registration_status",
      "registration_job_id",
      "run_created_at",
      "updated_at",
    ].join(","),
    owner_id: `eq.${ownerId}`,
    archived_at: "is.null",
    order: "run_created_at.desc",
    limit: String(JOB_LIMIT),
  });
  const { body } = await readProductLaunchStorageJson(
    `${config.supabaseUrl}/rest/v1/legacy_seo_run_jobs?${params.toString()}`,
    {
      headers: createSupabaseAdminHeaders(config.secretKey),
      cache: "no-store",
    },
  );
  return (Array.isArray(body) ? body : []).map((value) => {
    const row = record(value);
    return {
      run_id: text(row.run_id),
      launch_item_id: text(row.launch_item_id),
      tracker_row_number: Number(row.tracker_row_number) || null,
      model_number: text(row.model_number),
      product_name: text(row.product_name),
      source_url: text(row.source_url),
      status: text(row.status),
      stage: text(row.stage),
      progress_percent: Math.max(0, Number(row.progress_percent) || 0),
      message: text(row.message),
      input_payload: record(row.input_payload),
      // Never dereference checkpoint_payload in this list endpoint. Completed SEO runs
      // keep hundreds of scored candidates/search-ad rows there and PostgreSQL must
      // detoast that entire JSON value even for a single nested field. The client can
      // derive the display source mode from input_payload.legacyShoplingEvidence.
      checkpoint_payload: {},
      result_payload: record(row.result_payload),
      error_message: text(row.error_message),
      registration_status: text(row.registration_status) || "idle",
      registration_job_id: text(row.registration_job_id),
      registration_payload: {},
      run_created_at: text(row.run_created_at),
      updated_at: text(row.updated_at),
    };
  });
}

async function listLegacyItems(
  config: { supabaseUrl: string; secretKey: string },
  ownerId: string,
) {
  const params = new URLSearchParams({
    select: [
      "item_id",
      "tracker_row_number",
      "work_batch",
      "model_number",
      "product_name",
      "shopling_category",
      "shopling_upload_status",
      "overall_status",
      "option_labels",
      "updated_at",
      "exclusion_policy:item_payload->legacySeoRegistrationPolicy",
    ].join(","),
    owner_id: `eq.${ownerId}`,
    shopling_upload_status: "eq.완료",
    archived_at: "is.null",
    order: "tracker_row_number.asc",
    limit: String(ITEM_LIMIT),
  });
  const { body } = await readProductLaunchStorageJson(
    `${config.supabaseUrl}/rest/v1/product_launch_items?${params.toString()}`,
    {
      headers: createSupabaseAdminHeaders(config.secretKey),
      cache: "no-store",
    },
  );
  return (Array.isArray(body) ? body : [])
    .map(record)
    .filter((row) => !isExcluded(row.exclusion_policy))
    .map((row) => ({
      id: text(row.item_id),
      trackerRowNumber: Number(row.tracker_row_number) || null,
      workBatch: text(row.work_batch),
      modelNumber: text(row.model_number),
      productName: text(row.product_name),
      shoplingCategory: text(row.shopling_category),
      shoplingUploadStatus: text(row.shopling_upload_status),
      overallStatus: text(row.overall_status),
      optionLabels: list(row.option_labels, 50),
      updatedAt: text(row.updated_at),
    }));
}

export async function GET(request: NextRequest) {
  const authenticated = await requireSeoTitleLedgerContext(request);
  if (!authenticated.ok) return authenticated.response;
  const context = authenticated.value;
  const includeItems = request.nextUrl.searchParams.get("items") !== "false";

  const [jobs, items] = await Promise.all([
    listCompactJobs(context.config, context.identity.userId),
    includeItems
      ? listLegacyItems(context.config, context.identity.userId)
      : Promise.resolve([]),
  ]);

  return Response.json(
    { ok: true, jobs, items },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
