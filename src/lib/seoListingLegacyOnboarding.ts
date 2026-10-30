import {
  SEO_LISTING_SHADOW_EXPECTED_PROFILES,
  type SeoListingShadowSeedRecord,
} from "./seoListingLifecycleReconciliation.ts";

type UnknownRecord = Record<string, unknown>;

export const SEO_LISTING_LEGACY_ONBOARDING_SOURCE =
  "seo-listing-legacy-shadow-onboarding-v1";

const GOODS_KEY = /^\d+$/;
const CHANNELS = [
  ["wholesale1", "도매1"],
  ["wholesale2", "도매2"],
  ["wholesale3", "도매3"],
  ["wholesale4", "도매4"],
  ["retail1", "소매1"],
  ["retail2", "소매2"],
] as const;

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function object(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function instant(value: unknown) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function latestIso(values: unknown[]) {
  return values
    .map(instant)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
}

function identity(ownerId: string, profile: string, launchItemId: string) {
  return `${ownerId}\u0000${profile}\u0000${launchItemId}`;
}

function currentProducts(item: UnknownRecord | undefined) {
  return object(object(item?.item_payload).shoplingProducts);
}

export function extractLegacyCurrentGoodsKeys(launchItems: UnknownRecord[]) {
  return [
    ...new Set(
      launchItems.flatMap((item) =>
        Object.values(currentProducts(item))
          .map((value) => text(object(value).goodsKey))
          .filter((value) => GOODS_KEY.test(value)),
      ),
    ),
  ];
}

function currentIdentity(item: UnknownRecord | undefined) {
  const products = currentProducts(item);
  const byProfile = new Map<string, { goodsKey: string; registeredAt: string | null }>();
  for (const [channelKey, profile] of CHANNELS) {
    const product = object(products[channelKey]);
    const goodsKey = text(product.goodsKey);
    if (text(product.status) !== "success" || !GOODS_KEY.test(goodsKey)) continue;
    byProfile.set(profile, {
      goodsKey,
      registeredAt: instant(product.registeredAt),
    });
  }
  const goodsKeys = CHANNELS.map(([, profile]) => byProfile.get(profile)?.goodsKey ?? "");
  const complete =
    byProfile.size === CHANNELS.length &&
    goodsKeys.every(Boolean) &&
    new Set(goodsKeys).size === CHANNELS.length;
  return { byProfile, goodsKeys, complete };
}

function pipelineShape(
  ownerId: string,
  launchItemId: string,
  goodsKeys: string[],
  ledgerRows: UnknownRecord[],
) {
  const wanted = new Set(goodsKeys);
  const matching = ledgerRows.filter(
    (row) =>
      text(row.owner_id) === ownerId &&
      text(row.launch_item_id) === launchItemId &&
      wanted.has(text(row.goods_key)),
  );
  const latest = new Map<string, UnknownRecord>();
  for (const row of matching) {
    const goodsKey = text(row.goods_key);
    const previous = latest.get(goodsKey);
    if (
      !previous ||
      (Date.parse(text(row.updated_at)) || 0) >=
        (Date.parse(text(previous.updated_at)) || 0)
    ) {
      latest.set(goodsKey, row);
    }
  }
  const rows = goodsKeys
    .map((goodsKey) => latest.get(goodsKey))
    .filter((row): row is UnknownRecord => Boolean(row));
  const profiles = new Set(rows.map((row) => text(row.profile)));
  return {
    rows,
    complete:
      rows.length === SEO_LISTING_SHADOW_EXPECTED_PROFILES.length &&
      SEO_LISTING_SHADOW_EXPECTED_PROFILES.every((profile) =>
        profiles.has(profile),
      ),
  };
}

function stableRunId(launchItemId: string, goodsKeys: string[]) {
  const suffix = goodsKeys.filter(Boolean).join(".") || "identity-missing";
  return `legacy-onboarding-v1:${launchItemId}:${suffix}`;
}

function exceptionRecords(input: {
  ownerId: string;
  launchItemId: string;
  modelNumber: string;
  productName: string;
  reason: string;
  current: ReturnType<typeof currentIdentity>;
  currentRunId: string;
  generatedAt: string;
  existingIdentities: Set<string>;
  pipelineRowCount: number;
}) {
  return SEO_LISTING_SHADOW_EXPECTED_PROFILES.flatMap((profile) => {
    if (input.existingIdentities.has(identity(input.ownerId, profile, input.launchItemId))) {
      return [];
    }
    const current = input.current.byProfile.get(profile);
    const row: SeoListingShadowSeedRecord = {
      owner_id: input.ownerId,
      market_account_key: profile,
      launch_item_id: input.launchItemId,
      model_number: input.modelNumber,
      product_name: input.productName,
      state: "EXCEPTION",
      attempt_count: 0,
      current_run_id: input.currentRunId,
      goods_key: current?.goodsKey ?? "",
      market_listing_id: "",
      live_started_at: null,
      last_verified_live_at: null,
      sales_count_during_attempt: 0,
      next_eligible_at: null,
      exposure_verified: false,
      requires_review: true,
      review_reason: input.reason,
      evidence: {
        source: SEO_LISTING_LEGACY_ONBOARDING_SOURCE,
        legacyOnboarding: true,
        currentIdentityComplete: input.current.complete,
        currentIdentityCount: input.current.byProfile.size,
        pipelineIdentityCount: input.pipelineRowCount,
        registrationProvenAt: current?.registeredAt ?? null,
        externalMarketWrite: false,
      },
      rule_version: "seo-listing-rotation-v1-shadow",
      evaluated_at: input.generatedAt,
      updated_at: input.generatedAt,
    };
    return [row];
  });
}

export type SeoListingLegacyOnboardingPlan = {
  generatedAt: string;
  source: typeof SEO_LISTING_LEGACY_ONBOARDING_SOURCE;
  productsExamined: number;
  productsPreparedForVerification: number;
  productsNeedingReview: number;
  productsSkippedExisting: number;
  syntheticJobs: UnknownRecord[];
  exceptionRecords: SeoListingShadowSeedRecord[];
  productReviews: Array<{
    launchItemId: string;
    modelNumber: string;
    reason: string;
  }>;
};

export function buildSeoListingLegacyOnboardingPlan(input: {
  ownerId: string;
  registryRows: UnknownRecord[];
  launchItems: UnknownRecord[];
  marketLedgerRows: UnknownRecord[];
  existingLifecycleRows?: UnknownRecord[];
  now?: Date;
}): SeoListingLegacyOnboardingPlan {
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new TypeError("SEO_LEGACY_ONBOARDING_INVALID_NOW");
  }
  const generatedAt = now.toISOString();
  const ownerId = text(input.ownerId);
  const existingIdentities = new Set(
    (input.existingLifecycleRows ?? []).map((row) =>
      identity(text(row.owner_id), text(row.market_account_key), text(row.launch_item_id)),
    ),
  );
  const existingProfilesByProduct = new Map<string, Set<string>>();
  for (const row of input.existingLifecycleRows ?? []) {
    if (text(row.owner_id) !== ownerId) continue;
    const launchItemId = text(row.launch_item_id);
    const profiles = existingProfilesByProduct.get(launchItemId) ?? new Set<string>();
    profiles.add(text(row.market_account_key));
    existingProfilesByProduct.set(launchItemId, profiles);
  }

  const registryByProduct = new Map<string, UnknownRecord[]>();
  for (const row of input.registryRows) {
    if (text(row.owner_id) !== ownerId) continue;
    const launchItemId = text(row.launch_item_id);
    if (!launchItemId) continue;
    const rows = registryByProduct.get(launchItemId) ?? [];
    rows.push(row);
    registryByProduct.set(launchItemId, rows);
  }
  const itemsById = new Map(
    input.launchItems
      .filter((row) => text(row.owner_id) === ownerId && text(row.item_id))
      .map((row) => [text(row.item_id), row]),
  );

  const syntheticJobs: UnknownRecord[] = [];
  const reviewRecords: SeoListingShadowSeedRecord[] = [];
  const productReviews: SeoListingLegacyOnboardingPlan["productReviews"] = [];
  let productsSkippedExisting = 0;
  let productsPreparedForVerification = 0;

  for (const [launchItemId, registryRows] of [...registryByProduct.entries()].sort()) {
    if (
      SEO_LISTING_SHADOW_EXPECTED_PROFILES.every((profile) =>
        existingProfilesByProduct.get(launchItemId)?.has(profile),
      )
    ) {
      productsSkippedExisting += 1;
      continue;
    }
    const item = itemsById.get(launchItemId);
    const current = currentIdentity(item);
    const latestRegistry = [...registryRows].sort(
      (left, right) =>
        (Date.parse(text(right.updated_at)) || 0) -
        (Date.parse(text(left.updated_at)) || 0),
    )[0];
    const modelNumber = text(item?.model_number) || text(latestRegistry?.model_number);
    const productName = text(item?.product_name);
    const currentRunId = stableRunId(launchItemId, current.goodsKeys);
    const pipeline = pipelineShape(
      ownerId,
      launchItemId,
      current.goodsKeys.filter(Boolean),
      input.marketLedgerRows,
    );

    let reason = "";
    if (!item || !current.complete) {
      reason = "LEGACY_CURRENT_IDENTITY_INCOMPLETE";
    } else if (!pipeline.complete) {
      reason = "LEGACY_PIPELINE_IDENTITY_INCOMPLETE";
    }

    if (reason) {
      reviewRecords.push(
        ...exceptionRecords({
          ownerId,
          launchItemId,
          modelNumber,
          productName,
          reason,
          current,
          currentRunId,
          generatedAt,
          existingIdentities,
          pipelineRowCount: pipeline.rows.length,
        }),
      );
      productReviews.push({ launchItemId, modelNumber, reason });
      continue;
    }

    syntheticJobs.push({
      owner_id: ownerId,
      launch_item_id: launchItemId,
      model_number: modelNumber,
      product_name: productName,
      run_id: currentRunId,
      registration_status: "success",
      registration_payload: { goodsKeys: current.goodsKeys },
      reconciliation_source: SEO_LISTING_LEGACY_ONBOARDING_SOURCE,
      updated_at:
        latestIso([
          item?.updated_at,
          ...pipeline.rows.map((row) => row.updated_at),
          ...registryRows.map((row) => row.updated_at),
        ]) ?? generatedAt,
    });
    productsPreparedForVerification += 1;
  }

  return {
    generatedAt,
    source: SEO_LISTING_LEGACY_ONBOARDING_SOURCE,
    productsExamined: registryByProduct.size,
    productsPreparedForVerification,
    productsNeedingReview: new Set(productReviews.map((row) => row.launchItemId)).size,
    productsSkippedExisting,
    syntheticJobs,
    exceptionRecords: reviewRecords,
    productReviews,
  };
}
