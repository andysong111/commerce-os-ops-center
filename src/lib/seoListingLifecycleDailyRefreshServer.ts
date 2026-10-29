import {
  buildSeoListingDailyRefreshPlan,
  type SeoListingDailyRecordUpdate,
} from "@/lib/seoListingLifecycleDailyRefresh";
import { loadShoplingLifecycleStatusSnapshot } from "@/lib/shopling/shoplingLifecycleStatus";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type UnknownRecord = Record<string, unknown>;

const READ_LIMIT = 2000;
const WRITE_BATCH_SIZE = 250;

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function asRows(value: unknown) {
  return Array.isArray(value) ? (value as UnknownRecord[]) : [];
}

function chunks<T>(rows: T[], size = WRITE_BATCH_SIZE) {
  const output: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    output.push(rows.slice(index, index + size));
  }
  return output;
}

function launchItemBarcodes(rows: UnknownRecord[]) {
  return [
    ...new Set(
      rows
        .flatMap((row) => [
          text(row.barcode),
          ...stringArray(row.option_barcodes),
          ...stringArray(row.option_barcode_nos),
        ])
        .filter(Boolean),
    ),
  ];
}

async function throwIfError(
  label: string,
  result: { error: { message: string } | null },
) {
  if (result.error) throw new Error(`${label}:${result.error.message}`);
}

function updatedLifecycleRow(
  row: UnknownRecord,
  update: SeoListingDailyRecordUpdate,
) {
  return {
    ...row,
    state: update.state,
    last_verified_live_at: update.lastVerifiedLiveAt,
    sales_count_during_attempt: update.salesCountDuringAttempt,
    exposure_verified: update.exposureVerified,
    requires_review: update.requiresReview,
    review_reason: update.reviewReason,
    evidence: update.evidence,
    evaluated_at: update.evaluatedAt,
    updated_at: update.evaluatedAt,
  };
}

export async function refreshSeoListingLifecycleShadowDaily(
  ownerIdValue: string,
  options: { apply?: boolean; now?: Date } = {},
) {
  const ownerId = text(ownerIdValue);
  if (!ownerId) throw new Error("SEO_LIFECYCLE_DAILY_OWNER_MISSING");
  const admin = await createSupabaseAdminClient();
  if (!admin) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");

  const lifecycleResult = await admin
    .from("seo_listing_lifecycle_records")
    .select("*")
    .eq("owner_id", ownerId)
    .in("state", ["LIVE", "PROTECTED"])
    .limit(READ_LIMIT);
  await throwIfError("SEO_LIFECYCLE_DAILY_RECORD_READ_FAILED", lifecycleResult);
  const lifecycleRows = asRows(lifecycleResult.data);
  const launchItemIds = [
    ...new Set(lifecycleRows.map((row) => text(row.launch_item_id)).filter(Boolean)),
  ];
  const goodsKeys = [
    ...new Set(lifecycleRows.map((row) => text(row.goods_key)).filter(Boolean)),
  ];

  const launchItemResult = launchItemIds.length
    ? await admin
        .from("product_launch_items")
        .select(
          "owner_id,item_id,barcode,option_barcodes,option_barcode_nos,updated_at",
        )
        .eq("owner_id", ownerId)
        .in("item_id", launchItemIds)
        .limit(READ_LIMIT)
    : { data: [], error: null };
  await throwIfError("SEO_LIFECYCLE_DAILY_ITEM_READ_FAILED", launchItemResult);
  const launchItems = asRows(launchItemResult.data);
  const barcodes = launchItemBarcodes(launchItems);

  const salesResult = barcodes.length
    ? await admin
        .from("product_lifecycle_states")
        .select(
          "barcode,last_sale_at,sales_quantity_30,sales_quantity_90,sales_quantity_365,evaluated_at,updated_at",
        )
        .in("barcode", barcodes)
        .limit(READ_LIMIT)
    : { data: [], error: null };
  await throwIfError("SEO_LIFECYCLE_DAILY_SALES_READ_FAILED", salesResult);

  const snapshot = await loadShoplingLifecycleStatusSnapshot(goodsKeys);
  const plan = buildSeoListingDailyRefreshPlan({
    lifecycleRows,
    launchItems,
    salesRows: asRows(salesResult.data),
    shoplingStatuses: snapshot.statuses as unknown as UnknownRecord[],
    now: options.now,
  });
  const readback = {
    requestedGoodsKeyCount: snapshot.requestedGoodsKeyCount,
    sourceRowCount: snapshot.sourceRowCount,
    statusCounts: snapshot.statusCounts,
  };

  if (options.apply !== true) {
    return {
      ...plan,
      internalWriteApplied: false,
      updatedRecordCount: 0,
      insertedEventCount: 0,
      insertedShadowActionCount: 0,
      shoplingReadback: readback,
    };
  }

  const updatesById = new Map(
    plan.recordUpdates.map((update) => [update.id, update]),
  );
  const updateRows = lifecycleRows.flatMap((row) => {
    const update = updatesById.get(text(row.id));
    return update ? [updatedLifecycleRow(row, update)] : [];
  });
  let updatedRecordCount = 0;
  for (const batch of chunks(updateRows)) {
    const result = await admin
      .from("seo_listing_lifecycle_records")
      .upsert(batch, { onConflict: "id" })
      .select("id");
    await throwIfError("SEO_LIFECYCLE_DAILY_RECORD_WRITE_FAILED", result);
    updatedRecordCount += asRows(result.data).length;
  }

  const eventRows = plan.events.map((event) => ({
    owner_id: event.ownerId,
    lifecycle_record_id: event.lifecycleRecordId,
    previous_state: event.previousState,
    new_state: event.newState,
    action: event.action,
    attempt_count: event.attemptCount,
    reason_code: event.reasonCode,
    shadow_mode: true,
    evidence: event.evidence,
    rule_version: "seo-listing-rotation-v1-shadow",
    evaluated_at: event.evaluatedAt,
  }));
  let insertedEventCount = 0;
  for (const batch of chunks(eventRows)) {
    const result = await admin
      .from("seo_listing_lifecycle_events")
      .insert(batch)
      .select("id");
    await throwIfError("SEO_LIFECYCLE_DAILY_EVENT_WRITE_FAILED", result);
    insertedEventCount += asRows(result.data).length;
  }

  const actionRows = plan.shadowActions.map((action) => ({
    owner_id: action.ownerId,
    lifecycle_record_id: action.lifecycleRecordId,
    market_account_key: action.marketAccountKey,
    launch_item_id: action.launchItemId,
    run_id: action.runId,
    goods_key: action.goodsKey,
    action_type: action.actionType,
    status: "shadow",
    shadow_mode: true,
    dedupe_key: action.dedupeKey,
    scheduled_for: action.scheduledFor,
    reason_code: action.reasonCode,
    evidence: action.evidence,
    updated_at: plan.generatedAt,
  }));
  let insertedShadowActionCount = 0;
  for (const batch of chunks(actionRows)) {
    const result = await admin
      .from("seo_listing_rotation_actions")
      .upsert(batch, {
        onConflict: "dedupe_key",
        ignoreDuplicates: true,
      })
      .select("id");
    await throwIfError("SEO_LIFECYCLE_DAILY_ACTION_WRITE_FAILED", result);
    insertedShadowActionCount += asRows(result.data).length;
  }

  return {
    ...plan,
    internalWriteApplied: true,
    updatedRecordCount,
    insertedEventCount,
    insertedShadowActionCount,
    shoplingReadback: readback,
    externalMarketWrite: false,
  };
}
