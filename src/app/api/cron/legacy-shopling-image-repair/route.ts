import { timingSafeEqual } from "node:crypto";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import { prepareLegacySeoPreflight } from "@/lib/legacySeoPreflight";
import {
  getProductLaunchAdminConfig,
  readProductLaunchStorageJson,
  type ProductLaunchIdentity,
} from "@/lib/productLaunchTrackerServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BATCH_SIZE = 20;
type UnknownRecord = Record<string, unknown>;

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

function positiveNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function optionBarcodeNoValid(value: unknown) {
  return /^(?:OB)?\d{12}$/.test(text(value).toUpperCase());
}

function authorized(request: Request, secret: string) {
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function currentShoplingSync(item: UnknownRecord, options: UnknownRecord[]) {
  const itemSync = record(record(item.item_payload).shoplingOptionSync);
  if (
    text(itemSync.source) === "shopling_live_grouped_option_sync" &&
    text(itemSync.status) === "synced"
  ) {
    return true;
  }
  return (
    options.length > 0 &&
    options.every(
      (option) =>
        text(record(record(option.option_payload).shoplingOptionSync).source) ===
        "shopling_live_grouped_option_sync",
    )
  );
}

function pendingReasons(item: UnknownRecord, options: UnknownRecord[]) {
  const reasons: string[] = [];
  if (!currentShoplingSync(item, options)) reasons.push("shopling-sync");
  if (!options.length) reasons.push("options");
  for (const option of options) {
    const payload = record(option.option_payload);
    if (!text(payload.saleOption ?? option.sale_option)) reasons.push("sale-option");
    if (!text(option.barcode)) reasons.push("b-code");
    if (!optionBarcodeNoValid(option.option_barcode_no)) reasons.push("option-barcode-no");
    if (positiveNumber(option.base_sale_price_krw) <= 0) reasons.push("sale-price");
    if (positiveNumber(option.unit_cost_krw) <= 0) reasons.push("unit-cost");
  }
  const detail = record(record(item.item_payload).detailPageAsset);
  if (!text(detail.html)) reasons.push("detail-html");
  if (!text(detail.mainImageUrl)) reasons.push("main-image");
  if (!array(detail.additionalImageUrls).map(text).filter(Boolean).length) {
    reasons.push("additional-images");
  }
  return [...new Set(reasons)];
}

function circularBatch<T>(values: T[], size: number, seed: number) {
  if (values.length <= size) return values;
  const offset = ((seed * size) % values.length + values.length) % values.length;
  return [...values.slice(offset), ...values.slice(0, offset)].slice(0, size);
}

export async function GET(request: Request) {
  if (process.env.VERCEL_ENV !== "production") {
    return Response.json({ ok: false, error: "Production 전용 작업입니다." }, { status: 403 });
  }
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || !authorized(request, secret)) {
    return Response.json({ ok: false, error: "cron 인증 실패" }, { status: 401 });
  }

  const configResult = getProductLaunchAdminConfig();
  if (!configResult.ok) {
    return Response.json(configResult.body, { status: configResult.status });
  }
  const config = configResult.value;
  const itemParams = new URLSearchParams({
    select: "owner_id,item_id,model_number,product_name,item_payload",
    shopling_upload_status: "eq.완료",
    archived_at: "is.null",
    order: "owner_id.asc,model_number.asc,item_id.asc",
    limit: "5000",
  });
  const { body: itemBody } = await readProductLaunchStorageJson(
    `${config.supabaseUrl}/rest/v1/product_launch_items?${itemParams.toString()}`,
    {
      headers: createSupabaseAdminHeaders(config.secretKey),
      cache: "no-store",
    },
  );
  const items = (Array.isArray(itemBody) ? itemBody : []).map(record);
  if (!items.length) {
    return Response.json({
      ok: true,
      busy: false,
      processed: false,
      processedCount: 0,
      pendingCount: 0,
      state: "COMPLETE",
      engine: "legacy-seo-preflight-drain-v2",
    });
  }

  const ownerId = text(items[0]?.owner_id);
  const ownerItems = items.filter((item) => text(item.owner_id) === ownerId);
  const optionParams = new URLSearchParams({
    select:
      "item_id,option_id,option_index,sale_option,barcode,option_barcode_no,base_sale_price_krw,unit_cost_krw,option_payload",
    owner_id: `eq.${ownerId}`,
    order: "item_id.asc,option_index.asc",
    limit: "10000",
  });
  const { body: optionBody } = await readProductLaunchStorageJson(
    `${config.supabaseUrl}/rest/v1/product_launch_options?${optionParams.toString()}`,
    {
      headers: createSupabaseAdminHeaders(config.secretKey),
      cache: "no-store",
    },
  );
  const optionsByItem = new Map<string, UnknownRecord[]>();
  for (const value of Array.isArray(optionBody) ? optionBody : []) {
    const option = record(value);
    const itemId = text(option.item_id);
    if (!itemId) continue;
    const current = optionsByItem.get(itemId) ?? [];
    current.push(option);
    optionsByItem.set(itemId, current);
  }

  const pending = ownerItems
    .map((item) => {
      const itemId = text(item.item_id);
      const reasons = pendingReasons(item, optionsByItem.get(itemId) ?? []);
      return {
        itemId,
        modelNumber: text(item.model_number).toUpperCase().replace(/\s+/g, ""),
        reasons,
      };
    })
    .filter((entry) => entry.itemId && entry.reasons.length > 0);

  if (!pending.length) {
    return Response.json({
      ok: true,
      busy: false,
      processed: false,
      processedCount: 0,
      pendingCount: 0,
      totalCount: ownerItems.length,
      state: "COMPLETE",
      engine: "legacy-seo-preflight-drain-v2",
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

  const minuteSeed = Math.floor(Date.now() / 60_000);
  const batch = circularBatch(pending, BATCH_SIZE, minuteSeed);
  const preflight = await prepareLegacySeoPreflight({
    config,
    identity,
    itemIds: batch.map((entry) => entry.itemId),
  });
  const hasFailures = preflight.failedCount > 0;

  return Response.json({
    ok: true,
    busy: pending.length > batch.length || hasFailures,
    processed: true,
    processedCount: batch.length,
    pendingCount: pending.length,
    totalCount: ownerItems.length,
    batchModels: batch.map((entry) => entry.modelNumber),
    batchPendingReasons: batch.map((entry) => ({
      modelNumber: entry.modelNumber,
      reasons: entry.reasons,
    })),
    readyCount: preflight.readyCount,
    excludedCount: preflight.excludedCount,
    failedCount: preflight.failedCount,
    issueCount: preflight.issueCount,
    duplicateActiveModels: preflight.duplicateActiveModels,
    duplicateModelGuardError: preflight.duplicateModelGuardError,
    state: pending.length > batch.length || hasFailures ? "RUNNING" : "COMPLETE",
    engine: "legacy-seo-preflight-drain-v2",
  });
}
