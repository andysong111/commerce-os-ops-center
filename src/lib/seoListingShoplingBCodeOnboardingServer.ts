import {
  buildSeoListingShadowReconciliationPlan,
  type SeoListingShadowSeedRecord,
} from "@/lib/seoListingLifecycleReconciliation";
import { persistSeoListingLifecycleSeedRecords } from "@/lib/seoListingLifecycleReconciliationServer";
import {
  buildSeoListingShoplingBCodeOnboardingPlan,
  extractShoplingBCodeCatalogGoodsKeys,
} from "@/lib/seoListingShoplingBCodeOnboarding";
import type { SeoRunJobContext } from "@/lib/seoRunJobServer";
import {
  ShoplingReadClient,
  shoplingReadConfigFromEnv,
  splitShoplingDateRange,
} from "@/lib/shopling/shoplingReadClient";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type UnknownRecord = Record<string, unknown>;

const READ_PAGE_SIZE = 1000;
const READ_BATCH_SIZE = 200;

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function asRows(value: unknown) {
  return Array.isArray(value) ? (value as UnknownRecord[]) : [];
}

function chunks<T>(rows: T[], size = READ_BATCH_SIZE) {
  const output: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    output.push(rows.slice(index, index + size));
  }
  return output;
}

function unique(values: unknown[]) {
  return [...new Set(values.map(text).filter(Boolean))];
}

async function throwIfError(
  label: string,
  result: { error: { message: string } | null },
) {
  if (result.error) throw new Error(`${label}:${result.error.message}`);
}

function catalogStatuses(rows: UnknownRecord[], generatedAt: string) {
  const statuses = new Map<string, UnknownRecord>();
  for (const row of rows) {
    const goodsKey = text(row.goods_key);
    if (!/^\d+$/.test(goodsKey)) continue;
    statuses.set(goodsKey, {
      goodsKey,
      state: "READY",
      currentSaleStatus: text(row.sale_status).toUpperCase(),
      updated_at: generatedAt,
    });
  }
  return [...statuses.values()];
}

function catalogScanRange(now: Date) {
  const start =
    text(process.env.SHOPLING_BCODE_CATALOG_START_DATE) || "2010-01-01";
  const end = now.toISOString().slice(0, 10);
  return {
    start,
    end,
    ranges: splitShoplingDateRange(start, end, 90),
  };
}

export async function reconcileSeoListingShoplingBCodeOnboarding(
  context: SeoRunJobContext,
  options: { apply?: boolean; now?: Date } = {},
) {
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new TypeError("SEO_SHOPLING_BCODE_ONBOARDING_INVALID_NOW");
  }
  const ownerId = context.identity.userId;
  const admin = await createSupabaseAdminClient();
  if (!admin) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");

  const existingLifecycleRows: UnknownRecord[] = [];
  for (let offset = 0; ; offset += READ_PAGE_SIZE) {
    const result = await admin
      .from("seo_listing_lifecycle_records")
      .select("owner_id,market_account_key,launch_item_id,state,goods_key")
      .eq("owner_id", ownerId)
      .order("launch_item_id", { ascending: true })
      .range(offset, offset + READ_PAGE_SIZE - 1);
    await throwIfError("SEO_BCODE_EXISTING_LIFECYCLE_READ_FAILED", result);
    const page = asRows(result.data);
    existingLifecycleRows.push(...page);
    if (page.length < READ_PAGE_SIZE) break;
  }

  const launchItems: UnknownRecord[] = [];
  for (let offset = 0; ; offset += READ_PAGE_SIZE) {
    const result = await admin
      .from("product_launch_items")
      .select(
        "owner_id,item_id,model_number,product_name,barcode,option_barcodes,option_barcode_nos,shopling_upload_status,archived_at,item_payload,updated_at",
      )
      .eq("owner_id", ownerId)
      .order("item_id", { ascending: true })
      .range(offset, offset + READ_PAGE_SIZE - 1);
    await throwIfError("SEO_BCODE_LAUNCH_ITEM_READ_FAILED", result);
    const page = asRows(result.data);
    launchItems.push(...page);
    if (page.length < READ_PAGE_SIZE) break;
  }

  const launchOptions: UnknownRecord[] = [];
  for (let offset = 0; ; offset += READ_PAGE_SIZE) {
    const result = await admin
      .from("product_launch_options")
      .select(
        "owner_id,item_id,option_id,option_name,barcode,option_barcode_no,updated_at",
      )
      .eq("owner_id", ownerId)
      .order("item_id", { ascending: true })
      .range(offset, offset + READ_PAGE_SIZE - 1);
    await throwIfError("SEO_BCODE_LAUNCH_OPTION_READ_FAILED", result);
    const page = asRows(result.data);
    launchOptions.push(...page);
    if (page.length < READ_PAGE_SIZE) break;
  }

  const scan = catalogScanRange(now);
  const shopling = new ShoplingReadClient(
    shoplingReadConfigFromEnv(process.env),
  );
  const catalogRows = await shopling.readRanges("products", scan.ranges, {
    productSearchType: "등록일",
  });
  const catalogGoodsKeys = extractShoplingBCodeCatalogGoodsKeys(catalogRows);

  const marketLedgerRows: UnknownRecord[] = [];
  for (const batch of chunks(catalogGoodsKeys)) {
    const result = await admin
      .from("shopling_market_pipeline_ledger")
      .select(
        "owner_id,goods_key,launch_item_id,model_number,profile,status,title_status,market_status,registry_registered_at,completed_at,updated_at",
      )
      .eq("owner_id", ownerId)
      .in("goods_key", batch)
      .limit(READ_PAGE_SIZE);
    await throwIfError("SEO_BCODE_MARKET_LEDGER_READ_FAILED", result);
    marketLedgerRows.push(...asRows(result.data));
  }

  const barcodes = unique(
    launchOptions.flatMap((row) => [row.barcode, row.option_barcode_no]),
  );
  const salesRows: UnknownRecord[] = [];
  for (const batch of chunks(barcodes)) {
    const result = await admin
      .from("product_lifecycle_states")
      .select(
        "barcode,last_sale_at,sales_quantity_30,sales_quantity_90,sales_quantity_365,evaluated_at,updated_at",
      )
      .in("barcode", batch)
      .limit(READ_PAGE_SIZE);
    await throwIfError("SEO_BCODE_SALES_EVIDENCE_READ_FAILED", result);
    salesRows.push(...asRows(result.data));
  }

  const onboarding = buildSeoListingShoplingBCodeOnboardingPlan({
    ownerId,
    catalogRows,
    launchItems,
    launchOptions,
    marketLedgerRows,
    existingLifecycleRows,
    now,
  });
  const verification = buildSeoListingShadowReconciliationPlan({
    ownerId,
    jobs: onboarding.syntheticJobs,
    marketLedgerRows,
    launchItems,
    salesRows,
    shoplingStatuses: catalogStatuses(catalogRows, onboarding.generatedAt),
    existingLifecycleRows,
    now,
  });
  const records: SeoListingShadowSeedRecord[] = [
    ...verification.records,
    ...onboarding.exceptionRecords,
  ];
  const productReviews = [
    ...verification.productReviews,
    ...onboarding.productReviews,
  ];
  const result = {
    generatedAt: onboarding.generatedAt,
    source: onboarding.source,
    writesEnabled: false as const,
    scan: {
      searchType: "등록일",
      start: scan.start,
      end: scan.end,
      rangeCount: scan.ranges.length,
      sourceRowCount: catalogRows.length,
      bCodeGoodsKeyCount: catalogGoodsKeys.length,
    },
    productsExamined: onboarding.productsExamined,
    productsMatchedCurrentShopling:
      onboarding.productsMatchedCurrentShopling,
    productsUnmatchedCurrentShopling:
      onboarding.productsUnmatchedCurrentShopling,
    productsPreparedForVerification:
      onboarding.productsPreparedForVerification,
    productsSkippedExisting: onboarding.productsSkippedExisting,
    productsNeedingReview: new Set(
      productReviews.map((row) => row.launchItemId),
    ).size,
    currentCatalogGoodsKeyCount: onboarding.currentCatalogGoodsKeyCount,
    deletedCatalogGoodsKeyCount: onboarding.deletedCatalogGoodsKeyCount,
    unresolvedCatalogGoodsKeyCount:
      onboarding.unresolvedCatalogGoodsKeyCount,
    liveRecordCount: verification.liveRecordCount,
    protectedRecordCount: verification.protectedRecordCount,
    reviewRecordCount: records.filter((row) => row.requires_review).length,
    records,
    productReviews,
  };

  if (options.apply !== true || records.length === 0) {
    return {
      ...result,
      internalWriteApplied: false,
      insertedRecordCount: 0,
      insertedEventCount: 0,
      externalMarketWrite: false,
    };
  }

  const persisted = await persistSeoListingLifecycleSeedRecords({
    admin,
    ownerId,
    generatedAt: onboarding.generatedAt,
    records,
  });
  return {
    ...result,
    internalWriteApplied: true,
    insertedRecordCount: persisted.insertedRecordCount,
    insertedEventCount: persisted.insertedEventCount,
    externalMarketWrite: false,
  };
}
