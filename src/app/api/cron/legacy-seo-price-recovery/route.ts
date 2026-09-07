import { timingSafeEqual } from "node:crypto";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import { isLegacySeoRegistrationPolicyExcluded } from "@/lib/legacySeoRegistrationPolicy";
import { recoverLegacySeoShoplingPrices } from "@/lib/legacySeoShoplingPriceRecovery";
import {
  getProductLaunchAdminConfig,
  readProductLaunchStorageJson,
  type ProductLaunchIdentity,
} from "@/lib/productLaunchTrackerServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ZERO_OPTION_SCAN_LIMIT = 100;
const TEMPORARY_RECOVERY_EXPIRES_AT = Date.parse("2026-09-09T03:00:00Z");
type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function unique(values: string[]) {
  return [...new Set(values.map(text).filter(Boolean))];
}

function postgrestIn(values: string[]) {
  return values
    .map((value) => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`)
    .join(",");
}

function authorized(request: Request, secret: string) {
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export async function GET(request: Request) {
  if (process.env.VERCEL_ENV !== "production") {
    return Response.json({ ok: false, error: "Production 전용 작업입니다." }, { status: 403 });
  }
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || !authorized(request, secret)) {
    return Response.json({ ok: false, error: "cron 인증 실패" }, { status: 401 });
  }
  if (Date.now() >= TEMPORARY_RECOVERY_EXPIRES_AT) {
    return Response.json({ ok: true, state: "EXPIRED", busy: false });
  }

  const configResult = getProductLaunchAdminConfig();
  if (!configResult.ok) {
    return Response.json(configResult.body, { status: configResult.status });
  }
  const config = configResult.value;
  const zeroParams = new URLSearchParams({
    select: "owner_id,item_id",
    base_sale_price_krw: "eq.0",
    order: "owner_id.asc,item_id.asc,option_index.asc",
    limit: String(ZERO_OPTION_SCAN_LIMIT),
  });
  const { body: zeroBody } = await readProductLaunchStorageJson(
    `${config.supabaseUrl}/rest/v1/product_launch_options?${zeroParams.toString()}`,
    {
      headers: createSupabaseAdminHeaders(config.secretKey),
      cache: "no-store",
    },
  );
  const zeroRows = (Array.isArray(zeroBody) ? zeroBody : []).map(record);
  if (!zeroRows.length) {
    return Response.json({ ok: true, state: "COMPLETE", busy: false, recoveredCount: 0 });
  }

  const ownerId = text(zeroRows[0]?.owner_id);
  const ownerRows = zeroRows.filter((row) => text(row.owner_id) === ownerId);
  const itemIds = unique(ownerRows.map((row) => text(row.item_id)));
  const itemParams = new URLSearchParams({
    select: "item_id,model_number,exclusion_policy:item_payload->legacySeoRegistrationPolicy",
    owner_id: `eq.${ownerId}`,
    item_id: `in.(${postgrestIn(itemIds)})`,
    work_batch: "eq.등록완료건",
    shopling_upload_status: "eq.완료",
    archived_at: "is.null",
    limit: "200",
  });
  const { body: itemBody } = await readProductLaunchStorageJson(
    `${config.supabaseUrl}/rest/v1/product_launch_items?${itemParams.toString()}`,
    {
      headers: createSupabaseAdminHeaders(config.secretKey),
      cache: "no-store",
    },
  );
  const itemRows = (Array.isArray(itemBody) ? itemBody : []).map(record);
  const modelNumbers = unique(
    itemRows
      .filter((row) => !isLegacySeoRegistrationPolicyExcluded(row.exclusion_policy))
      .map((row) => text(row.model_number)),
  );
  if (!modelNumbers.length) {
    return Response.json({
      ok: true,
      state: "NO_ELIGIBLE_TARGETS",
      busy: false,
      scannedZeroRows: zeroRows.length,
    });
  }

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
  const result = await recoverLegacySeoShoplingPrices({
    config,
    identity,
    modelNumbers,
  });
  if (result.unresolvedCount > 0) {
    console.info(
      "[legacy-seo-price-recovery] unresolved",
      JSON.stringify({
        ownerId,
        unresolvedCount: result.unresolvedCount,
        unresolved: result.unresolved,
      }),
    );
  }
  return Response.json({
    ok: true,
    state: result.unresolvedCount > 0 ? "PARTIAL" : "RUNNING",
    busy: true,
    scannedZeroRows: zeroRows.length,
    modelCount: modelNumbers.length,
    ...result,
  });
}
