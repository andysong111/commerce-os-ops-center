import {
  buildSeoListingShadowReconciliationPlan,
  extractSeoRegistrationGoodsKeys,
  type SeoListingShadowSeedRecord,
} from "@/lib/seoListingLifecycleReconciliation";
import {
  buildSeoListingLegacyOnboardingPlan,
  extractLegacyCurrentGoodsKeys,
} from "@/lib/seoListingLegacyOnboarding";
import type { SeoRunJobContext } from "@/lib/seoRunJobServer";
import { listSeoRunJobs } from "@/lib/seoRunJobServer";
import { loadShoplingLifecycleStatusSnapshot } from "@/lib/shopling/shoplingLifecycleStatus";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type UnknownRecord = Record<string, unknown>;

const READ_LIMIT = 2000;
const READ_BATCH_SIZE = 200;
const READ_PAGE_SIZE = 1000;
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

function unique(values: unknown[]) {
  return [...new Set(values.map(text).filter(Boolean))];
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

type SupabaseAdminClient = NonNullable<
  Awaited<ReturnType<typeof createSupabaseAdminClient>>
>;

export async function persistSeoListingLifecycleSeedRecords(input: {
  admin: SupabaseAdminClient;
  ownerId: string;
  generatedAt: string;
  records: SeoListingShadowSeedRecord[];
}) {
  const policyResult = await input.admin
    .from("seo_listing_rotation_policies")
    .upsert(
      {
        owner_id: input.ownerId,
        mode: "shadow",
        enabled: false,
        exposure_days: 60,
        cooldown_days: 90,
        max_attempts: 3,
        timezone: "Asia/Seoul",
        updated_at: input.generatedAt,
      },
      { onConflict: "owner_id", ignoreDuplicates: true },
    );
  await throwIfError("SEO_LIFECYCLE_POLICY_SEED_FAILED", policyResult);

  const inserted: UnknownRecord[] = [];
  for (const batch of chunks(input.records)) {
    const result = await input.admin
      .from("seo_listing_lifecycle_records")
      .upsert(batch, {
        onConflict: "owner_id,market_account_key,launch_item_id",
        ignoreDuplicates: true,
      })
      .select(
        "id,owner_id,market_account_key,launch_item_id,state,attempt_count,review_reason,evidence,evaluated_at",
      );
    await throwIfError("SEO_LIFECYCLE_RECORD_SEED_FAILED", result);
    inserted.push(...asRows(result.data));
  }

  const plannedByIdentity = new Map(
    input.records.map((record) => [
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
    return [
      {
        owner_id: input.ownerId,
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
      },
    ];
  });
  for (const batch of chunks(events)) {
    const result = await input.admin
      .from("seo_listing_lifecycle_events")
      .insert(batch);
    await throwIfError("SEO_LIFECYCLE_EVENT_SEED_FAILED", result);
  }
  return {
    insertedRecordCount: inserted.length,
    insertedEventCount: events.length,
  };
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
  const existingResult = await admin
    .from("seo_listing_lifecycle_records")
    .select("owner_id,market_account_key,launch_item_id,state,goods_key")
    .eq("owner_id", ownerId)
    .limit(READ_LIMIT);
  await throwIfError("SEO_LIFECYCLE_EXISTING_READ_FAILED", existingResult);
  const existingLifecycleRows = asRows(existingResult.data);

  const registryRows: UnknownRecord[] = [];
  for (let offset = 0; ; offset += READ_PAGE_SIZE) {
    const result = await admin
      .from("shopling_product_group_registry")
      .select(
        "owner_id,goods_key,launch_item_id,model_number,product_group_key,product_group_label,shopling_status,registered_at,first_seen_at,updated_at",
      )
      .eq("owner_id", ownerId)
      .order("goods_key", { ascending: true })
      .range(offset, offset + READ_PAGE_SIZE - 1);
    await throwIfError("SEO_LEGACY_REGISTRY_READ_FAILED", result);
    const page = asRows(result.data);
    registryRows.push(...page);
    if (page.length < READ_PAGE_SIZE) break;
  }

  const launchItemIds = unique([
    ...successfulJobs.map((row) => row.launch_item_id),
    ...registryRows.map((row) => row.launch_item_id),
  ]);
  const launchItems: UnknownRecord[] = [];
  for (const batch of chunks(launchItemIds, READ_BATCH_SIZE)) {
    const result = await admin
      .from("product_launch_items")
      .select(
        "owner_id,item_id,model_number,product_name,barcode,option_barcodes,option_barcode_nos,item_payload,updated_at",
      )
      .eq("owner_id", ownerId)
      .in("item_id", batch)
      .limit(READ_LIMIT);
    await throwIfError("SEO_LIFECYCLE_LAUNCH_ITEM_READ_FAILED", result);
    launchItems.push(...asRows(result.data));
  }

  const goodsKeys = unique([
    ...extractSeoRegistrationGoodsKeys(
      successfulJobs as unknown as UnknownRecord[],
    ),
    ...extractLegacyCurrentGoodsKeys(launchItems),
  ]);
  const marketLedgerRows: UnknownRecord[] = [];
  for (const batch of chunks(goodsKeys, READ_BATCH_SIZE)) {
    const result = await admin
      .from("shopling_market_pipeline_ledger")
      .select(
        "owner_id,goods_key,launch_item_id,model_number,profile,status,title_status,market_status,registry_registered_at,completed_at,updated_at",
      )
      .eq("owner_id", ownerId)
      .in("goods_key", batch)
      .limit(READ_LIMIT);
    await throwIfError("SEO_LIFECYCLE_LEDGER_READ_FAILED", result);
    marketLedgerRows.push(...asRows(result.data));
  }

  const barcodes = launchItemBarcodes(launchItems);
  const salesRows: UnknownRecord[] = [];
  for (const batch of chunks(barcodes, READ_BATCH_SIZE)) {
    const result = await admin
      .from("product_lifecycle_states")
      .select(
        "barcode,last_sale_at,sales_quantity_30,sales_quantity_90,sales_quantity_365,evaluated_at,updated_at",
      )
      .in("barcode", batch)
      .limit(READ_LIMIT);
    await throwIfError("SEO_LIFECYCLE_SALES_EVIDENCE_READ_FAILED", result);
    salesRows.push(...asRows(result.data));
  }

  const legacy = buildSeoListingLegacyOnboardingPlan({
    ownerId,
    registryRows,
    launchItems,
    marketLedgerRows,
    existingLifecycleRows,
    now,
  });
  const legacyLaunchItemIds = new Set([
    ...legacy.syntheticJobs.map((row) => text(row.launch_item_id)),
    ...legacy.productReviews.map((row) => row.launchItemId),
  ]);
  const reconciliationJobs = [
    ...successfulJobs
      .filter((row) => !legacyLaunchItemIds.has(text(row.launch_item_id)))
      .map((row) => row as unknown as UnknownRecord),
    ...legacy.syntheticJobs,
  ];

  const common = {
    ownerId,
    jobs: reconciliationJobs,
    marketLedgerRows,
    launchItems,
    salesRows,
    existingLifecycleRows,
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
  const verifiedPlan = buildSeoListingShadowReconciliationPlan({
    ...common,
    shoplingStatuses: snapshot.statuses as unknown as UnknownRecord[],
  });
  const legacyExceptionProducts = new Set(
    legacy.exceptionRecords.map((row) => row.launch_item_id),
  );
  const combinedProductReviews = [
    ...verifiedPlan.productReviews,
    ...legacy.productReviews,
  ];
  const plan = {
    ...verifiedPlan,
    productsSeeded:
      verifiedPlan.productsSeeded + legacyExceptionProducts.size,
    productsNeedingReview: new Set(
      combinedProductReviews.map((row) => row.launchItemId),
    ).size,
    reviewRecordCount:
      verifiedPlan.reviewRecordCount + legacy.exceptionRecords.length,
    records: [...verifiedPlan.records, ...legacy.exceptionRecords],
    productReviews: combinedProductReviews,
    legacyOnboarding: {
      source: legacy.source,
      productsExamined: legacy.productsExamined,
      productsPreparedForVerification:
        legacy.productsPreparedForVerification,
      productsNeedingReview: legacy.productsNeedingReview,
      productsSkippedExisting: legacy.productsSkippedExisting,
      exceptionRecordCount: legacy.exceptionRecords.length,
      externalMarketWrite: false,
    },
  };

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

  const persisted = await persistSeoListingLifecycleSeedRecords({
    admin,
    ownerId,
    generatedAt: plan.generatedAt,
    records: plan.records,
  });

  return {
    ...plan,
    internalWriteApplied: true,
    insertedRecordCount: persisted.insertedRecordCount,
    insertedEventCount: persisted.insertedEventCount,
    shoplingReadback: {
      requestedGoodsKeyCount: snapshot.requestedGoodsKeyCount,
      sourceRowCount: snapshot.sourceRowCount,
      statusCounts: snapshot.statusCounts,
    },
    externalMarketWrite: false,
  };
}
