import {
  buildSeoListingShadowReconciliationPlan,
  extractSeoRegistrationGoodsKeys,
  type SeoListingShadowSeedRecord,
} from "@/lib/seoListingLifecycleReconciliation";
import type { SeoRunJobContext } from "@/lib/seoRunJobServer";
import { listSeoRunJobs } from "@/lib/seoRunJobServer";
import { loadShoplingLifecycleStatusSnapshot } from "@/lib/shopling/shoplingLifecycleStatus";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type UnknownRecord = Record<string, unknown>;

const READ_LIMIT = 2000;
const WRITE_BATCH_SIZE = 250;

function text(value: unknown) {
  return String(value ?? "").trim();
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function chunks<T>(rows: T[], size = WRITE_BATCH_SIZE) {
  const output: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    output.push(rows.slice(index, index + size));
  }
  return output;
}

function asRows(value: unknown) {
  return Array.isArray(value) ? (value as UnknownRecord[]) : [];
}

function launchItemBarcodes(rows: UnknownRecord[]) {
  return [
    ...new Set(
      rows.flatMap((row) => [
        text(row.barcode),
        ...stringArray(row.option_barcodes),
        ...stringArray(row.option_barcode_nos),
      ]).filter(Boolean),
    ),
  ];
}

function eventAction(record: SeoListingShadowSeedRecord) {
  if (record.state === "PROTECTED") return "KEEP";
  if (record.state === "EXCEPTION") return "REVIEW";
  return "NONE";
}

function eventReason(record: SeoListingShadowSeedRecord) {
  if (record.state === "PROTECTED") return "SALE_CONFIRMED_KEEP_LISTING";
  if (record.state === "LIVE") return "INITIAL_LIVE_READBACK_VERIFIED";
  return record.review_reason || "SHADOW_RECONCILIATION_REVIEW";
}

async function throwIfError(
  label: string,
  result: { error: { message: string } | null },
) {
  if (result.error) throw new Error(`${label}:${result.error.message}`);
}

export async function reconcileSeoListingLifecycleShadow(
  context: SeoRunJobContext,
  options: { apply?: boolean; now?: Date } = {},
) {
  const now = options.now ?? new Date();
  const ownerId = context.identity.userId;
  const admin = await createSupabaseAdminClient();
  if (!admin) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");

  const jobs = await listSeoRunJobs(context, {
    includeArchived: true,
    limit: 1000,
  });
  const successfulJobs = jobs.filter(
    (row) => row.registration_status === "success",
  );
  const goodsKeys = extractSeoRegistrationGoodsKeys(
    successfulJobs as unknown as UnknownRecord[],
  );
  const launchItemIds = [
    ...new Set(successfulJobs.map((row) => text(row.launch_item_id)).filter(Boolean)),
  ];

  const [ledgerResult, launchItemResult, existingResult] = await Promise.all([
    goodsKeys.length
      ? admin
          .from("shopling_market_pipeline_ledger")
          .select(
            "owner_id,goods_key,launch_item_id,model_number,profile,status,title_status,market_status,registry_registered_at,completed_at,updated_at",
          )
          .eq("owner_id", ownerId)
          .in("goods_key", goodsKeys)
          .limit(READ_LIMIT)
      : Promise.resolve({ data: [], error: null }),
    launchItemIds.length
      ? admin
          .from("product_launch_items")
          .select(
            "owner_id,item_id,barcode,option_barcodes,option_barcode_nos,updated_at",
          )
          .eq("owner_id", ownerId)
          .in("item_id", launchItemIds)
          .limit(READ_LIMIT)
      : Promise.resolve({ data: [], error: null }),
    admin
      .from("seo_listing_lifecycle_records")
      .select("owner_id,market_account_key,launch_item_id,state,goods_key")
      .eq("owner_id", ownerId)
      .limit(READ_LIMIT),
  ]);
  await throwIfError("SEO_LIFECYCLE_LEDGER_READ_FAILED", ledgerResult);
  await throwIfError("SEO_LIFECYCLE_LAUNCH_ITEM_READ_FAILED", launchItemResult);
  await throwIfError("SEO_LIFECYCLE_EXISTING_READ_FAILED", existingResult);

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
  await throwIfError("SEO_LIFECYCLE_SALES_EVIDENCE_READ_FAILED", salesResult);

  const common = {
    ownerId,
    jobs: successfulJobs as unknown as UnknownRecord[],
    marketLedgerRows: asRows(ledgerResult.data),
    launchItems,
    salesRows: asRows(salesResult.data),
    existingLifecycleRows: asRows(existingResult.data),
    now,
  };
  const preflight = buildSeoListingShadowReconciliationPlan({
    ...common,
    shoplingStatuses: [],
  });
  const readbackGoodsKeys = [
    ...new Set(preflight.records.map((row) => row.goods_key).filter(Boolean)),
  ];
  const snapshot = await loadShoplingLifecycleStatusSnapshot(readbackGoodsKeys);
  const plan = buildSeoListingShadowReconciliationPlan({
    ...common,
    shoplingStatuses: snapshot.statuses as unknown as UnknownRecord[],
  });

  if (options.apply !== true || plan.records.length === 0) {
    return {
      ...plan,
      internalWriteApplied: false,
      insertedRecordCount: 0,
      insertedEventCount: 0,
      shoplingReadback: {
        requestedGoodsKeyCount: snapshot.requestedGoodsKeyCount,
        sourceRowCount: snapshot.sourceRowCount,
        statusCounts: snapshot.statusCounts,
      },
      externalMarketWrite: false,
    };
  }

  const policyResult = await admin.from("seo_listing_rotation_policies").upsert(
    {
      owner_id: ownerId,
      mode: "shadow",
      enabled: false,
      exposure_days: 60,
      cooldown_days: 90,
      max_attempts: 3,
      timezone: "Asia/Seoul",
      updated_at: plan.generatedAt,
    },
    { onConflict: "owner_id", ignoreDuplicates: true },
  );
  await throwIfError("SEO_LIFECYCLE_POLICY_SEED_FAILED", policyResult);

  const inserted: UnknownRecord[] = [];
  for (const batch of chunks(plan.records)) {
    const result = await admin
      .from("seo_listing_lifecycle_records")
      .upsert(batch, {
        onConflict: "owner_id,market_account_key,launch_item_id",
        ignoreDuplicates: true,
      })
      .select("id,owner_id,market_account_key,launch_item_id,state,attempt_count,review_reason,evidence,evaluated_at");
    await throwIfError("SEO_LIFECYCLE_RECORD_SEED_FAILED", result);
    inserted.push(...asRows(result.data));
  }

  const plannedByIdentity = new Map(
    plan.records.map((record) => [
      `${record.owner_id}\u0000${record.market_account_key}\u0000${record.launch_item_id}`,
      record,
    ]),
  );
  const events = inserted.flatMap((saved) => {
    const record = plannedByIdentity.get(
      `${text(saved.owner_id)}\u0000${text(saved.market_account_key)}\u0000${text(saved.launch_item_id)}`,
    );
    const id = text(saved.id);
    if (!record || !id) return [];
    return [{
      owner_id: ownerId,
      lifecycle_record_id: id,
      previous_state: null,
      new_state: record.state,
      action: eventAction(record),
      attempt_count: record.attempt_count,
      reason_code: eventReason(record),
      shadow_mode: true,
      evidence: record.evidence,
      rule_version: record.rule_version,
      evaluated_at: record.evaluated_at,
    }];
  });
  for (const batch of chunks(events)) {
    const result = await admin.from("seo_listing_lifecycle_events").insert(batch);
    await throwIfError("SEO_LIFECYCLE_EVENT_SEED_FAILED", result);
  }

  return {
    ...plan,
    internalWriteApplied: true,
    insertedRecordCount: inserted.length,
    insertedEventCount: events.length,
    shoplingReadback: {
      requestedGoodsKeyCount: snapshot.requestedGoodsKeyCount,
      sourceRowCount: snapshot.sourceRowCount,
      statusCounts: snapshot.statusCounts,
    },
    externalMarketWrite: false,
  };
}
