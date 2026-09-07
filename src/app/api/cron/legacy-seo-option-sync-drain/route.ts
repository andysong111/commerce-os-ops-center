import { timingSafeEqual } from "node:crypto";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import { syncLegacySeoShoplingOptions } from "@/lib/legacySeoShoplingOptionSync";
import {
  getProductLaunchAdminConfig,
  readProductLaunchStorageJson,
  type ProductLaunchIdentity,
} from "@/lib/productLaunchTrackerServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BATCH_SIZE = 20;
const TEMPORARY_DRAIN_EXPIRES_AT = Date.parse("2026-09-08T03:00:00Z");
type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function authorized(request: Request, secret: string) {
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function synced(syncMeta: unknown) {
  return Boolean(text(record(syncMeta).syncedAt));
}

export async function GET(request: Request) {
  if (process.env.VERCEL_ENV !== "production") {
    return Response.json({ ok: false, error: "Production 전용 작업입니다." }, { status: 403 });
  }
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || !authorized(request, secret)) {
    return Response.json({ ok: false, error: "cron 인증 실패" }, { status: 401 });
  }
  if (Date.now() >= TEMPORARY_DRAIN_EXPIRES_AT) {
    return Response.json({
      ok: true,
      busy: false,
      state: "EXPIRED",
      message: "임시 이전상품 옵션 동기화 실행기간이 종료되었습니다.",
    });
  }
  const configResult = getProductLaunchAdminConfig();
  if (!configResult.ok) {
    return Response.json(configResult.body, { status: configResult.status });
  }
  const config = configResult.value;
  const params = new URLSearchParams({
    select: "owner_id,item_id,model_number,sync_meta:item_payload->shoplingOptionSync",
    work_batch: "eq.등록완료건",
    shopling_upload_status: "eq.완료",
    archived_at: "is.null",
    order: "owner_id.asc,model_number.asc",
    limit: "1000",
  });
  let body: unknown;
  try {
    ({ body } = await readProductLaunchStorageJson(
      `${config.supabaseUrl}/rest/v1/product_launch_items?${params.toString()}`,
      {
        headers: createSupabaseAdminHeaders(config.secretKey),
        cache: "no-store",
      },
      { attempts: 1, timeoutMs: 5_000, retryDelaysMs: [] },
    ));
  } catch (error) {
    return Response.json(
      {
        ok: false,
        busy: true,
        state: "DATABASE_BUSY",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 503 },
    );
  }
  const allRows = (Array.isArray(body) ? body : []).map(record);
  const pendingRows = allRows.filter((row) => !synced(row.sync_meta));
  if (!pendingRows.length) {
    return Response.json({
      ok: true,
      busy: false,
      processedCount: 0,
      remainingCount: 0,
      totalCount: allRows.length,
      state: "COMPLETE",
    });
  }

  const ownerId = text(pendingRows[0]?.owner_id);
  const ownerRows = pendingRows.filter((row) => text(row.owner_id) === ownerId);
  const batch = ownerRows.slice(0, BATCH_SIZE);
  const workspaceParams = new URLSearchParams({
    select: "owner_email",
    owner_id: `eq.${ownerId}`,
    limit: "1",
  });
  const { body: workspaceBody } = await readProductLaunchStorageJson(
    `${config.supabaseUrl}/rest/v1/product_launch_workspaces?${workspaceParams.toString()}`,
    {
      headers: createSupabaseAdminHeaders(config.secretKey),
      cache: "no-store",
    },
  );
  const workspace = record(Array.isArray(workspaceBody) ? workspaceBody[0] : null);
  const identity: ProductLaunchIdentity = {
    userId: ownerId,
    email: text(workspace.owner_email),
  };
  const modelNumbers = [...new Set(batch.map((row) => text(row.model_number)).filter(Boolean))];
  const result = await syncLegacySeoShoplingOptions({
    config,
    identity,
    modelNumbers,
  });
  const remainingCount = Math.max(0, pendingRows.length - batch.length);
  return Response.json({
    ok: true,
    busy: remainingCount > 0,
    processed: true,
    processedCount: result.processedCount,
    changedCount: result.changedCount,
    remainingCount,
    batchModels: modelNumbers,
    totalCount: allRows.length,
    state: remainingCount > 0 ? "RUNNING" : "COMPLETE",
  });
}
