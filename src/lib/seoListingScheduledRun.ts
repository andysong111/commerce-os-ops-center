import {
  evaluateSeoListingLifecycle,
  type SeoListingLifecycleState,
} from "./seoListingLifecyclePolicy.ts";
import type { SeoReadyProduct } from "./seoListingAutomationDashboard.ts";

type UnknownRecord = Record<string, unknown>;

export type SeoScheduledRunPlan = {
  selectedProducts: SeoReadyProduct[];
  eligibleRegistrationCount: number;
  excludedByLifecycleCount: number;
  limitedByCapacityCount: number;
  soldOutDeleteDueCount: number;
  relistDueCount: number;
  relistFreshCodeReadyCount: number;
  relistFreshCodeSelectedCount: number;
  relistFreshCodeBlockedCount: number;
  protectedProductCount: number;
  cooldownProductCount: number;
  reviewProductCount: number;
  capacityFallbackActive: boolean;
  shoplingProductDbBlocked: boolean;
  shoplingProductDbSafeNewProductCount: number;
  blocked: boolean;
  reasonCode: string;
};

export const SEO_REGISTRATION_FALLBACK_BATCH_LIMIT = 3;
export const SEO_RELIST_REQUIRED_MARKET_LISTING_COUNT = 6;
export const SEO_DELIVERY_QUEUE_MIN_TARGET = 12;
export const SEO_DELIVERY_QUEUE_MAX_TARGET = 60;
const CLOCK_SKEW_MS = 5 * 60_000;

function text(value: unknown) {
  return String(value ?? "").trim();
}

function integer(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function instant(value: unknown) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function array(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function hasCanonicalBCode(row: UnknownRecord) {
  return (
    array(row.option_barcodes).some((value) => text(value)) ||
    text(row.barcode).length > 0
  );
}

function productLaunchSeoExcluded(row: UnknownRecord) {
  const summary = record(row.summary_payload);
  const exclusion = record(summary.seoExclusion);
  return exclusion.excluded === true;
}

function latestJobInstant(row: UnknownRecord) {
  return instant(row.run_created_at) ?? instant(row.created_at) ?? 0;
}

export type SeoDeliveryPreparationCandidate = {
  launchItemId: string;
  modelNumber: string;
  productName: string;
  dispatchToday: boolean;
};

export type SeoDeliveryPreparationPlan = {
  materialReadyProductCount: number;
  preparationCandidateCount: number;
  deliveryReadyCount: number;
  generationInProgressCount: number;
  currentPreparationInventoryCount: number;
  queueTargetCount: number;
  plannedPreparationCount: number;
  dispatchPreparationCount: number;
  backlogPreparationCount: number;
  dailyDispatchCount: number;
  candidates: SeoDeliveryPreparationCandidate[];
  blocked: boolean;
  reasonCode: string;
};

/**
 * Builds the upstream "prepare delivery stock" plan without changing any
 * Product Launch, SEO RUN, Shopling, or marketplace state.
 *
 * Fresh candidates intentionally exclude every product that already has an
 * SEO RUN or lifecycle row. Existing Shopling products therefore stay in the
 * lifecycle/waterfall lane instead of being registered a second time.
 */
export function planSeoDeliveryPreparation(input: {
  productLaunchRows: UnknownRecord[];
  jobHistoryRows: UnknownRecord[];
  lifecycleRows: UnknownRecord[];
  isolatedLaunchItemIds?: Iterable<string>;
  scheduledBatchLimit: number;
  scheduledRegistrationCount: number;
  systemBlocked?: boolean;
}): SeoDeliveryPreparationPlan {
  const isolated = new Set(
    [...(input.isolatedLaunchItemIds ?? [])].map(text).filter(Boolean),
  );
  const materialReadyRows = input.productLaunchRows.filter(
    (row) =>
      !text(row.archived_at) &&
      row.readiness_ready === true &&
      hasCanonicalBCode(row),
  );
  const jobProductIds = new Set(
    input.jobHistoryRows.map((row) => text(row.launch_item_id)).filter(Boolean),
  );
  const lifecycleProductIds = new Set(
    input.lifecycleRows.map((row) => text(row.launch_item_id)).filter(Boolean),
  );

  const freshCandidates = materialReadyRows
    .filter((row) => text(row.shopling_upload_status) === "미시작")
    .filter((row) => !productLaunchSeoExcluded(row))
    .filter((row) => {
      const launchItemId = text(row.item_id || row.launch_item_id);
      return (
        launchItemId &&
        !isolated.has(launchItemId) &&
        !jobProductIds.has(launchItemId) &&
        !lifecycleProductIds.has(launchItemId)
      );
    })
    .sort((left, right) => {
      const updatedDifference =
        (instant(left.updated_at) ?? 0) - (instant(right.updated_at) ?? 0);
      return (
        updatedDifference ||
        text(left.model_number).localeCompare(text(right.model_number), "ko") ||
        text(left.item_id).localeCompare(text(right.item_id))
      );
    });

  const latestActiveByProduct = new Map<string, UnknownRecord>();
  for (const row of input.jobHistoryRows) {
    if (text(row.archived_at)) continue;
    const launchItemId = text(row.launch_item_id);
    if (!launchItemId || isolated.has(launchItemId)) continue;
    const current = latestActiveByProduct.get(launchItemId);
    if (
      !current ||
      latestJobInstant(row) > latestJobInstant(current) ||
      (latestJobInstant(row) === latestJobInstant(current) &&
        text(row.run_id) > text(current.run_id))
    ) {
      latestActiveByProduct.set(launchItemId, row);
    }
  }
  const latestActiveJobs = [...latestActiveByProduct.values()];
  const deliveryReadyCount = latestActiveJobs.filter(
    (row) => row.status === "ready" && row.registration_status === "idle",
  ).length;
  const generationInProgressCount = latestActiveJobs.filter(
    (row) =>
      ["queued", "running"].includes(text(row.status)) &&
      row.registration_status === "idle",
  ).length;
  const currentPreparationInventoryCount =
    deliveryReadyCount + generationInProgressCount;
  const scheduledBatchLimit = Math.max(
    0,
    Math.trunc(input.scheduledBatchLimit),
  );
  const scheduledRegistrationCount = Math.max(
    0,
    Math.trunc(input.scheduledRegistrationCount),
  );
  const queueTargetCount = Math.min(
    SEO_DELIVERY_QUEUE_MAX_TARGET,
    Math.max(SEO_DELIVERY_QUEUE_MIN_TARGET, scheduledBatchLimit * 2),
  );
  const blocked = input.systemBlocked === true;
  const plannedPreparationCount = blocked
    ? 0
    : Math.min(
        freshCandidates.length,
        Math.max(0, queueTargetCount - currentPreparationInventoryCount),
      );
  const dispatchSlots = Math.max(
    0,
    scheduledBatchLimit - scheduledRegistrationCount,
  );
  const dispatchPreparationCount = Math.min(
    plannedPreparationCount,
    dispatchSlots,
  );
  const candidates = freshCandidates
    .slice(0, plannedPreparationCount)
    .map(
      (row, index): SeoDeliveryPreparationCandidate => ({
        launchItemId: text(row.item_id || row.launch_item_id),
        modelNumber: text(row.model_number),
        productName: text(row.product_name),
        dispatchToday: index < dispatchPreparationCount,
      }),
    );

  return {
    materialReadyProductCount: materialReadyRows.length,
    preparationCandidateCount: freshCandidates.length,
    deliveryReadyCount,
    generationInProgressCount,
    currentPreparationInventoryCount,
    queueTargetCount,
    plannedPreparationCount,
    dispatchPreparationCount,
    backlogPreparationCount: Math.max(
      0,
      plannedPreparationCount - dispatchPreparationCount,
    ),
    dailyDispatchCount:
      scheduledRegistrationCount + dispatchPreparationCount,
    candidates,
    blocked,
    reasonCode: blocked
      ? "DELIVERY_PREPARATION_SYSTEM_BLOCKED"
      : plannedPreparationCount
        ? "DELIVERY_PREPARATION_READY"
        : freshCandidates.length
          ? "DELIVERY_QUEUE_TARGET_FILLED"
          : "NO_FRESH_MATERIAL_CANDIDATE",
  };
}

function lifecycleState(value: unknown): SeoListingLifecycleState {
  const state = text(value) as SeoListingLifecycleState;
  return [
    "READY",
    "LIVE",
    "COOLDOWN",
    "PROTECTED",
    "RETIRE_CANDIDATE",
    "EXCEPTION",
  ].includes(state)
    ? state
    : "EXCEPTION";
}

function productId(row: UnknownRecord) {
  return text(row.launch_item_id);
}

function freshCodeRelistReady(
  product: SeoReadyProduct,
  rows: UnknownRecord[],
  now: Date,
) {
  if (rows.length !== SEO_RELIST_REQUIRED_MARKET_LISTING_COUNT) return false;

  const currentRunIds = new Set(
    rows.map((row) => text(row.current_run_id)).filter(Boolean),
  );
  const goodsKeys = rows.map((row) => text(row.goods_key));
  const marketAccountKeys = rows.map((row) => text(row.market_account_key));
  if (
    currentRunIds.size !== 1 ||
    text(product.runId) === [...currentRunIds][0] ||
    goodsKeys.some((value) => !value) ||
    marketAccountKeys.some((value) => !value) ||
    new Set(goodsKeys).size !== rows.length ||
    new Set(marketAccountKeys).size !== rows.length
  ) {
    return false;
  }

  const runCreatedAt = instant(product.runCreatedAt);
  const cooldownEnds = rows.map((row) => instant(row.next_eligible_at));
  if (
    runCreatedAt === null ||
    cooldownEnds.some((value) => value === null) ||
    runCreatedAt < Math.max(...(cooldownEnds as number[]))
  ) {
    return false;
  }

  const nowMs = now.getTime();
  return rows.every((row) => {
    const evidence = record(row.evidence);
    const deleteReadbackAt = instant(
      evidence.previousListingDeleteReadbackVerifiedAt,
    );
    const decision = evaluateSeoListingLifecycle(
      {
        state: lifecycleState(row.state),
        attemptCount: integer(row.attempt_count),
        liveStartedAt: text(row.live_started_at) || null,
        lastVerifiedLiveAt: text(row.last_verified_live_at) || null,
        salesCountDuringAttempt: integer(row.sales_count_during_attempt),
        nextEligibleAt: text(row.next_eligible_at) || null,
        exposureVerified: row.exposure_verified === true,
        technicalFailure:
          row.requires_review === true || lifecycleState(row.state) === "EXCEPTION",
      },
      now,
    );
    return (
      decision.action === "RELIST" &&
      evidence.previousListingDeleted === true &&
      deleteReadbackAt !== null &&
      deleteReadbackAt <= nowMs + CLOCK_SKEW_MS
    );
  });
}

export function planSeoScheduledPortfolioRun(input: {
  readyProducts: SeoReadyProduct[];
  lifecycleRows: UnknownRecord[];
  safeBatchCount: number;
  capacityBlocked: boolean;
  allowBoundedRegistrationWithoutCapacity?: boolean;
  fallbackBatchCount?: number;
  shoplingProductDbSafeNewProductCount?: number;
  shoplingProductDbBlocked?: boolean;
  shoplingProductDbReasonCode?: string;
  now?: Date;
}): SeoScheduledRunPlan {
  const now = input.now ?? new Date();
  const recordsByProduct = new Map<string, UnknownRecord[]>();
  const dueSoldOutDelete = new Set<string>();
  const dueRelist = new Set<string>();
  const protectedProducts = new Set<string>();
  const cooldownProducts = new Set<string>();
  const reviewProducts = new Set<string>();

  for (const row of input.lifecycleRows) {
    const launchItemId = productId(row);
    if (!launchItemId) continue;
    const rows = recordsByProduct.get(launchItemId) ?? [];
    rows.push(row);
    recordsByProduct.set(launchItemId, rows);

    const decision = evaluateSeoListingLifecycle(
      {
        state: lifecycleState(row.state),
        attemptCount: integer(row.attempt_count),
        liveStartedAt: text(row.live_started_at) || null,
        lastVerifiedLiveAt: text(row.last_verified_live_at) || null,
        salesCountDuringAttempt: integer(row.sales_count_during_attempt),
        nextEligibleAt: text(row.next_eligible_at) || null,
        exposureVerified: row.exposure_verified === true,
        technicalFailure:
          row.requires_review === true || lifecycleState(row.state) === "EXCEPTION",
      },
      now,
    );
    if (decision.action === "SOLD_OUT_AND_DELETE") {
      dueSoldOutDelete.add(launchItemId);
    }
    if (decision.action === "RELIST") dueRelist.add(launchItemId);
    if (decision.state === "PROTECTED") protectedProducts.add(launchItemId);
    if (decision.state === "COOLDOWN") cooldownProducts.add(launchItemId);
    if (decision.requiresReview) reviewProducts.add(launchItemId);
  }

  const freshCodeRelists = new Set(
    input.readyProducts
      .filter((product) => {
        if (!dueRelist.has(product.launchItemId)) return false;
        return freshCodeRelistReady(
          product,
          recordsByProduct.get(product.launchItemId) ?? [],
          now,
        );
      })
      .map((product) => product.launchItemId),
  );

  const eligible = input.readyProducts.filter((product) => {
    // A relist intentionally creates six fresh Shopling product codes. The
    // previous six listings must already have an exact delete readback, the
    // 90-day cooldown must be over, and this must be a newer SEO RUN.
    if (dueRelist.has(product.launchItemId)) {
      return freshCodeRelists.has(product.launchItemId);
    }
    const rows = recordsByProduct.get(product.launchItemId) ?? [];
    if (!rows.length) return true;
    return rows.every((row) => {
      if (row.requires_review === true) return false;
      const decision = evaluateSeoListingLifecycle(
        {
          state: lifecycleState(row.state),
          attemptCount: integer(row.attempt_count),
          liveStartedAt: text(row.live_started_at) || null,
          lastVerifiedLiveAt: text(row.last_verified_live_at) || null,
          salesCountDuringAttempt: integer(row.sales_count_during_attempt),
          nextEligibleAt: text(row.next_eligible_at) || null,
          exposureVerified: row.exposure_verified === true,
        },
        now,
      );
      return decision.action === "REGISTER" || decision.action === "RELIST";
    });
  });
  const safeBatchCount = Math.max(0, Math.trunc(input.safeBatchCount));
  const fallbackBatchCount = Math.max(
    0,
    Math.min(
      SEO_REGISTRATION_FALLBACK_BATCH_LIMIT,
      Math.trunc(
        input.fallbackBatchCount ?? SEO_REGISTRATION_FALLBACK_BATCH_LIMIT,
      ),
    ),
  );
  const capacityFallbackActive =
    input.capacityBlocked &&
    input.allowBoundedRegistrationWithoutCapacity === true &&
    fallbackBatchCount > 0 &&
    input.shoplingProductDbBlocked !== true;
  const marketBatchCount = input.capacityBlocked
    ? capacityFallbackActive
      ? fallbackBatchCount
      : 0
    : safeBatchCount;
  const shoplingProductDbSafeNewProductCount = Math.max(
    0,
    Math.trunc(
      input.shoplingProductDbSafeNewProductCount ?? Number.MAX_SAFE_INTEGER,
    ),
  );
  const shoplingProductDbBlocked = input.shoplingProductDbBlocked === true;
  const selectedProducts = shoplingProductDbBlocked
    ? []
    : eligible.slice(
        0,
        Math.min(marketBatchCount, shoplingProductDbSafeNewProductCount),
      );
  const excludedByLifecycleCount = Math.max(
    0,
    input.readyProducts.length - eligible.length,
  );
  const limitedByCapacityCount = Math.max(
    0,
    eligible.length - selectedProducts.length,
  );
  const selectedFreshRelistCount = selectedProducts.filter((product) =>
    freshCodeRelists.has(product.launchItemId),
  ).length;

  return {
    selectedProducts,
    eligibleRegistrationCount: eligible.length,
    excludedByLifecycleCount,
    limitedByCapacityCount,
    soldOutDeleteDueCount: dueSoldOutDelete.size,
    relistDueCount: dueRelist.size,
    relistFreshCodeReadyCount: freshCodeRelists.size,
    relistFreshCodeSelectedCount: selectedFreshRelistCount,
    relistFreshCodeBlockedCount: Math.max(
      0,
      dueRelist.size - freshCodeRelists.size,
    ),
    protectedProductCount: protectedProducts.size,
    cooldownProductCount: cooldownProducts.size,
    reviewProductCount: reviewProducts.size,
    capacityFallbackActive,
    shoplingProductDbBlocked,
    shoplingProductDbSafeNewProductCount,
    blocked:
      shoplingProductDbBlocked ||
      (input.capacityBlocked && !capacityFallbackActive),
    reasonCode: shoplingProductDbBlocked
      ? text(input.shoplingProductDbReasonCode) ||
        "SHOPLING_PRODUCT_DB_BLOCKED"
      : capacityFallbackActive
      ? selectedProducts.length
        ? "REGISTRATION_ONLY_FALLBACK_READY"
        : eligible.length
          ? "SHOPLING_PRODUCT_DB_INSUFFICIENT_SAFE_SLOTS"
          : "NO_ELIGIBLE_PRODUCT"
      : input.capacityBlocked
        ? "MARKET_CAPACITY_BLOCKED"
      : selectedProducts.length
        ? "SCHEDULED_RUN_READY"
        : dueRelist.size && freshCodeRelists.size === 0
          ? "RELIST_FRESH_CODE_PREPARATION_REQUIRED"
        : eligible.length && shoplingProductDbSafeNewProductCount === 0
          ? "SHOPLING_PRODUCT_DB_INSUFFICIENT_SAFE_SLOTS"
          : eligible.length
            ? "NO_MARKET_SLOT_AVAILABLE"
            : "NO_ELIGIBLE_PRODUCT",
  };
}
