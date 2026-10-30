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
