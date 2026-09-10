import { timingSafeEqual } from "node:crypto";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import { prepareLegacySeoPreflight } from "@/lib/legacySeoPreflight";
import { isLegacySeoRegistrationPolicyExcluded } from "@/lib/legacySeoRegistrationPolicy";
import {
  getProductLaunchAdminConfig,
  readProductLaunchStorageJson,
  type ProductLaunchIdentity,
} from "@/lib/productLaunchTrackerServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Missing-option recovery can scan years of Shopling history. Keep one model per
// invocation so a single expensive rediscovery cannot share the 300-second
// function budget with unrelated repairs.
const BATCH_SIZE = 1;
const MAX_BATCH_WEIGHT = 4;
const OPTIONS_MISSING_WEIGHT = 3;
const SHOPLING_SYNC_WEIGHT = 2;
const CANONICAL_PRICE_SOURCE = "china_order_final_confirmed_v4";
const CANONICAL_PRICE_REVISION = "20260809_v4_option_max_uniform";

// Commit 5f4d937 (atomic Shopling option recovery v3) shipped current-model
// rediscovery before this boundary. An existing_preserved zero-option marker older
// than the boundary may come from the stale-goods-key bug (AAA116 class), so it
// must be rechecked once. A marker written after this boundary is the result of
// the corrected exhaustive discovery path and is a terminal SEO exclusion rather
// than work to repeat forever.
const TRUSTED_REDISCOVERY_CUTOFF_MS = Date.parse("2026-09-08T19:58:00.000Z");

type UnknownRecord = Record<string, unknown>;
type PendingEntry = { itemId: string; modelNumber: string; reasons: string[] };

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

function canonicalPriceConfirmed(option: UnknownRecord) {
  const canonical = record(record(option.option_payload).canonicalChinaPrice);
  if (
    text(canonical.source) !== CANONICAL_PRICE_SOURCE ||
    text(canonical.sourceRevision) !== CANONICAL_PRICE_REVISION
  ) {
    return false;
  }
  const currentSale = Math.round(positiveNumber(option.base_sale_price_krw));
  const currentCost = Math.round(positiveNumber(option.unit_cost_krw));
  const canonicalSale = Math.round(positiveNumber(canonical.finalSalePriceKrw));
  const canonicalCost = Math.round(
    positiveNumber(canonical.unitCostKrwMirror) ||
      positiveNumber(canonical.unitCostKrwExact),
  );
  return (
    currentSale > 0 &&
    currentCost > 0 &&
    currentSale === canonicalSale &&
    currentCost === canonicalCost
  );
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

function policyExcluded(item: UnknownRecord) {
  return isLegacySeoRegistrationPolicyExcluded(
    record(item.item_payload).legacySeoRegistrationPolicy,
  );
}

function verifiedNoOptionExclusion(item: UnknownRecord, options: UnknownRecord[]) {
  if (options.length > 0) return false;
  const itemSync = record(record(item.item_payload).shoplingOptionSync);
  if (
    text(itemSync.source) !== "shopling_live_grouped_option_sync" ||
    text(itemSync.status) !== "existing_preserved" ||
    Number(itemSync.optionCount) !== 0 ||
    Number(itemSync.bCodeCount) !== 0
  ) {
    return false;
  }
  const syncedAt = Date.parse(text(itemSync.syncedAt));
  return Number.isFinite(syncedAt) && syncedAt >= TRUSTED_REDISCOVERY_CUTOFF_MS;
}

function pendingReasons(item: UnknownRecord, options: UnknownRecord[]) {
  // Explicit registration exclusions (for example user-confirmed discontinuations)
  // and corrected exhaustive no-option discoveries are terminal for this drain.
  // Do not keep rescanning or repairing items that policy intentionally excludes.
  if (policyExcluded(item) || verifiedNoOptionExclusion(item, options)) return [];

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
    if (!canonicalPriceConfirmed(option)) reasons.push("canonical-price");
  }
  const detail = record(record(item.item_payload).detailPageAsset);
  if (!text(detail.html)) reasons.push("detail-html");
  if (!text(detail.mainImageUrl)) reasons.push("main-image");
  if (!array(detail.additionalImageUrls).map(text).filter(Boolean).length) {
    reasons.push("additional-images");
  }
  return [...new Set(reasons)];
}

function pendingWeight(entry: PendingEntry) {
  if (entry.reasons.includes("options")) return OPTIONS_MISSING_WEIGHT;
  if (entry.reasons.includes("shopling-sync")) return SHOPLING_SYNC_WEIGHT;
  return 1;
}

function circularWeightedBatch(values: PendingEntry[], seed: number) {
  if (!values.length) return [] as PendingEntry[];
  const offset = ((seed * BATCH_SIZE) % values.length + values.length) % values.length;
  const rotated = [...values.slice(offset), ...values.slice(0, offset)];
  const batch: PendingEntry[] = [];
  let weight = 0;

  for (const entry of rotated) {
    const itemWeight = pendingWeight(entry);
    if (batch.length > 0 && weight + itemWeight > MAX_BATCH_WEIGHT) break;
    batch.push(entry);
    weight += itemWeight;
    if (batch.length >= BATCH_SIZE || weight >= MAX_BATCH_WEIGHT) break;
  }
  return batch;
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
      terminalExcludedCount: 0,
      batchSize: BATCH_SIZE,
      maxBatchWeight: MAX_BATCH_WEIGHT,
      state: "COMPLETE",
      engine: "legacy-seo-preflight-drain-v8-policy-aware-canonical-authority",
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

  const terminalExcludedCount = ownerItems.filter((item) => {
    const options = optionsByItem.get(text(item.item_id)) ?? [];
    return policyExcluded(item) || verifiedNoOptionExclusion(item, options);
  }).length;

  const pending: PendingEntry[] = ownerItems
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
      terminalExcludedCount,
      totalCount: ownerItems.length,
      batchSize: BATCH_SIZE,
      maxBatchWeight: MAX_BATCH_WEIGHT,
      state: "COMPLETE",
      engine: "legacy-seo-preflight-drain-v8-policy-aware-canonical-authority",
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
  const batch = circularWeightedBatch(pending, minuteSeed);
  const batchWeight = batch.reduce((sum, entry) => sum + pendingWeight(entry), 0);
  const startedAt = Date.now();
  console.info("[legacy-shopling-image-repair] preflight:start", {
    pendingCount: pending.length,
    batchSize: batch.length,
    batchWeight,
    models: batch.map((entry) => entry.modelNumber),
  });
  const preflight = await prepareLegacySeoPreflight({
    config,
    identity,
    itemIds: batch.map((entry) => entry.itemId),
  });
  console.info("[legacy-shopling-image-repair] preflight:finish", {
    durationMs: Date.now() - startedAt,
    models: batch.map((entry) => entry.modelNumber),
    readyCount: preflight.readyCount,
    failedCount: preflight.failedCount,
    excludedCount: preflight.excludedCount,
  });
  const hasFailures = preflight.failedCount > 0;
  const optionSync = record(preflight.optionSync);
  const failedItems = preflight.results
    .filter((result) => !result.ready && !result.excluded)
    .map((result) => ({
      modelNumber: result.modelNumber,
      issues: result.issues.map((issue) => `${issue.field}: ${issue.message}`),
    }));

  return Response.json({
    ok: true,
    busy: pending.length > batch.length || hasFailures,
    processed: true,
    processedCount: batch.length,
    pendingCount: pending.length,
    terminalExcludedCount,
    totalCount: ownerItems.length,
    batchSize: BATCH_SIZE,
    selectedBatchSize: batch.length,
    batchWeight,
    maxBatchWeight: MAX_BATCH_WEIGHT,
    batchModels: batch.map((entry) => entry.modelNumber),
    batchPendingReasons: batch.map((entry) => ({
      modelNumber: entry.modelNumber,
      reasons: entry.reasons,
      weight: pendingWeight(entry),
    })),
    readyCount: preflight.readyCount,
    excludedCount: preflight.excludedCount,
    failedCount: preflight.failedCount,
    issueCount: preflight.issueCount,
    failedItems,
    optionSyncFailedCount: Math.max(0, Math.floor(Number(optionSync.failedCount) || 0)),
    optionSyncError: preflight.optionSyncError,
    assetRecoveryError: preflight.assetRecoveryError,
    canonicalPriceError: preflight.canonicalPriceError,
    priceEligibleCount: preflight.priceEligibleModels.length,
    duplicateActiveModels: preflight.duplicateActiveModels,
    duplicateModelGuardError: preflight.duplicateModelGuardError,
    state: pending.length > batch.length || hasFailures ? "RUNNING" : "COMPLETE",
    engine: "legacy-seo-preflight-drain-v8-policy-aware-canonical-authority",
  });
}