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
  relistReuseOnlyCount: number;
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

function text(value: unknown) {
  return String(value ?? "").trim();
}

function integer(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
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

  const eligible = input.readyProducts.filter((product) => {
    // A relist must reuse the existing six Shopling goods_keys. Never hand it
    // to the full pipeline that appends six new product codes.
    if (dueRelist.has(product.launchItemId)) return false;
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

  return {
    selectedProducts,
    eligibleRegistrationCount: eligible.length,
    excludedByLifecycleCount,
    limitedByCapacityCount,
    soldOutDeleteDueCount: dueSoldOutDelete.size,
    relistDueCount: dueRelist.size,
    relistReuseOnlyCount: dueRelist.size,
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
        : dueRelist.size
          ? "RELIST_REUSE_PIPELINE_PENDING"
        : eligible.length && shoplingProductDbSafeNewProductCount === 0
          ? "SHOPLING_PRODUCT_DB_INSUFFICIENT_SAFE_SLOTS"
          : eligible.length
            ? "NO_MARKET_SLOT_AVAILABLE"
            : "NO_ELIGIBLE_PRODUCT",
  };
}
