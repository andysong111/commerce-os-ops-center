import { NextRequest } from "next/server";
import { readProductLaunchStorageJson } from "@/lib/productLaunchTrackerServer";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import { requireSeoTitleLedgerContext } from "@/lib/seoTitleLedgerServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const JOB_LIMIT = 800;
const ITEM_LIMIT = 1000;
const READ_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

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

function unavailable(error: unknown) {
  // Never expose a raw provider response, URL, key, SQL statement or payload.
  const details = record(error);
  const diagnostic = [text(details.name), text(details.code), text(details.message)].join(" ");
  const dependencyCode = diagnostic.match(/\bPGRST00[0-3]\b/i)?.[0].toUpperCase() ?? null;
  const transient = Boolean(dependencyCode) || /abort|timeout|timed out|fetch failed|network|econn|schema cache|connection|HTTP (408|429|50[0234])/i.test(diagnostic);
  const requestId = crypto.randomUUID();
  const code = transient ? "LEGACY_SEO_STORAGE_UNAVAILABLE" : "LEGACY_SEO_LIST_FAILED";
  console.warn("[legacy-seo-list-unavailable]", { requestId, code, dependencyCode });
  return Response.json(
    {
      ok: false,
      code,
      dependencyCode,
      requestId,
      canRegister: false,
      message: transient
        ? "서버 저장소 연결 장애로 현재 목록을 확인할 수 없습니다. 화면의 0건은 실제 상품 수가 아닙니다. 연결 복구 전에는 신규등록을 실행하지 마세요."
        : "목록을 확인하지 못했습니다. 실제 상품 수를 0건으로 판단하지 마세요. 신규등록을 중지하고 오류 식별번호를 확인해 주세요.",
    },
    {
      status: transient ? 503 : 500,
      headers: { ...READ_HEADERS, ...(transient ? { "Retry-After": "60" } : {}) },
    },
  );
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
    { attempts: 3, timeoutMs: 4_500, retryDelaysMs: [250, 750] },
  );
  if (!Array.isArray(body)) throw new Error("LEGACY_SEO_LIST_INVALID_PAYLOAD");
  return body.map((value) => {
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
      input_payload: {},
      // Keep large checkpoints out of list reads, including nested extraction.
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
    { attempts: 2, timeoutMs: 4_500, retryDelaysMs: [500] },
  );
  if (!Array.isArray(body)) throw new Error("LEGACY_SEO_LIST_INVALID_PAYLOAD");
  return body.map(record).map((row) => ({
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
  try {
    const authenticated = await requireSeoTitleLedgerContext(request);
    if (!authenticated.ok) return authenticated.response;
    const context = authenticated.value;
    const includeJobs = request.nextUrl.searchParams.get("jobs") !== "false";
    const includeItems = request.nextUrl.searchParams.get("items") !== "false";

    const [jobsResult, itemsResult] = await Promise.allSettled([
      includeJobs
        ? listCompactJobs(context.config, context.identity.userId)
        : Promise.resolve([]),
      includeItems
        ? listLegacyItems(context.config, context.identity.userId)
        : Promise.resolve([]),
    ]);
    if (includeJobs && jobsResult.status === "rejected") return unavailable(jobsResult.reason);
    // A catalog-only failure is NOT a successful empty catalog. Combined reads
    // may keep the independently successful ledger, with explicit partial health.
    if (includeItems && !includeJobs && itemsResult.status === "rejected") {
      return unavailable(itemsResult.reason);
    }
    const jobs = jobsResult.status === "fulfilled" ? jobsResult.value : [];
    const items = itemsResult.status === "fulfilled" ? itemsResult.value : null;
    const warnings = itemsResult.status === "rejected"
      ? ["이전상품 선택 목록을 확인하지 못했습니다. 상품 수는 미확인 상태이며 SEO 작업원장만 표시합니다."]
      : [];

    return Response.json(
      {
        ok: true,
        jobs,
        items,
        warnings,
        jobsAvailable: includeJobs && jobsResult.status === "fulfilled",
        itemsAvailable: includeItems && itemsResult.status === "fulfilled",
      },
      { headers: READ_HEADERS },
    );
  } catch (error) {
    return unavailable(error);
  }
}
