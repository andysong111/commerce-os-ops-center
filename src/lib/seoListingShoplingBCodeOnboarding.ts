import { inferProductGroupFromPtnGoodsCd } from "./productGroup.ts";
import {
  SEO_LISTING_SHADOW_EXPECTED_PROFILES,
  type SeoListingShadowSeedRecord,
} from "./seoListingLifecycleReconciliation.ts";

type UnknownRecord = Record<string, unknown>;

export const SEO_LISTING_SHOPLING_BCODE_ONBOARDING_SOURCE =
  "seo-listing-shopling-bcode-onboarding-v1";

const GOODS_KEY = /^\d+$/;
const B_CODE = /^B[A-Z]{1,2}\d+-\d+$/;

type CatalogIdentity = {
  goodsKey: string;
  ptnGoodsCd: string;
  profile: string;
  selfCodeBase: string;
  saleStatus: string;
  bCodes: string[];
  candidateItemIds: string[];
  identityConflict: boolean;
  profileConflict: boolean;
  saleStatusConflict: boolean;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function code(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

function instant(value: unknown) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function identity(ownerId: string, profile: string, launchItemId: string) {
  return `${ownerId}\u0000${profile}\u0000${launchItemId}`;
}

function profileFromProductGroup(value: unknown) {
  const normalized = text(value).replace(/\s+/g, "");
  const withoutLegacyNumberSuffix = normalized.replace(
    /^(도매[1-4]|소매[1-2])번$/,
    "$1",
  );
  return SEO_LISTING_SHADOW_EXPECTED_PROFILES.includes(
    withoutLegacyNumberSuffix as (typeof SEO_LISTING_SHADOW_EXPECTED_PROFILES)[number],
  )
    ? withoutLegacyNumberSuffix
    : "";
}

function stableRunId(launchItemId: string, goodsKeys: string[]) {
  return `bcode-onboarding-v1:${launchItemId}:${goodsKeys.join(".")}`;
}

function latestRowsByGoodsKey(rows: UnknownRecord[]) {
  const latest = new Map<string, UnknownRecord>();
  for (const row of rows) {
    const goodsKey = text(row.goods_key);
    if (!GOODS_KEY.test(goodsKey)) continue;
    const previous = latest.get(goodsKey);
    if (
      !previous ||
      (Date.parse(text(row.updated_at)) || 0) >=
        (Date.parse(text(previous.updated_at)) || 0)
    ) {
      latest.set(goodsKey, row);
    }
  }
  return latest;
}

function exceptionRecords(input: {
  ownerId: string;
  item: UnknownRecord;
  reason: string;
  currentByProfile: Map<string, CatalogIdentity[]>;
  currentRunId: string;
  generatedAt: string;
  existingIdentities: Set<string>;
}) {
  const launchItemId = text(input.item.item_id);
  return SEO_LISTING_SHADOW_EXPECTED_PROFILES.flatMap((profile) => {
    if (
      input.existingIdentities.has(
        identity(input.ownerId, profile, launchItemId),
      )
    ) {
      return [];
    }
    const matches = input.currentByProfile.get(profile) ?? [];
    const current = matches.length === 1 ? matches[0] : null;
    const row: SeoListingShadowSeedRecord = {
      owner_id: input.ownerId,
      market_account_key: profile,
      launch_item_id: launchItemId,
      model_number: text(input.item.model_number),
      product_name: text(input.item.product_name),
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
        source: SEO_LISTING_SHOPLING_BCODE_ONBOARDING_SOURCE,
        shoplingBCodeOnboarding: true,
        catalogIdentityCount: [...input.currentByProfile.values()].flat().length,
        profileIdentityCount: matches.length,
        shoplingPtnGoodsCd: current?.ptnGoodsCd ?? null,
        shoplingSaleStatus: current?.saleStatus ?? null,
        matchedBCodeCount: current?.bCodes.length ?? 0,
        registeredAt: null,
        externalMarketWrite: false,
      },
      rule_version: "seo-listing-rotation-v1-shadow",
      evaluated_at: input.generatedAt,
      updated_at: input.generatedAt,
    };
    return [row];
  });
}

export function extractShoplingBCodeCatalogGoodsKeys(rows: UnknownRecord[]) {
  return [
    ...new Set(
      rows
        .filter((row) => B_CODE.test(code(row.optPtnOptCd)))
        .map((row) => text(row.goods_key))
        .filter((value) => GOODS_KEY.test(value)),
    ),
  ];
}

export type SeoListingShoplingBCodeOnboardingPlan = {
  generatedAt: string;
  source: typeof SEO_LISTING_SHOPLING_BCODE_ONBOARDING_SOURCE;
  productsExamined: number;
  productsMatchedCurrentShopling: number;
  productsUnmatchedCurrentShopling: number;
  productsPreparedForVerification: number;
  productsNeedingReview: number;
  productsSkippedExisting: number;
  currentCatalogGoodsKeyCount: number;
  deletedCatalogGoodsKeyCount: number;
  unresolvedCatalogGoodsKeyCount: number;
  syntheticJobs: UnknownRecord[];
  exceptionRecords: SeoListingShadowSeedRecord[];
  productReviews: Array<{
    launchItemId: string;
    modelNumber: string;
    reason: string;
  }>;
};

export function buildSeoListingShoplingBCodeOnboardingPlan(input: {
  ownerId: string;
  catalogRows: UnknownRecord[];
  launchItems: UnknownRecord[];
  launchOptions: UnknownRecord[];
  marketLedgerRows: UnknownRecord[];
  existingLifecycleRows?: UnknownRecord[];
  now?: Date;
}): SeoListingShoplingBCodeOnboardingPlan {
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new TypeError("SEO_SHOPLING_BCODE_ONBOARDING_INVALID_NOW");
  }
  const generatedAt = now.toISOString();
  const ownerId = text(input.ownerId);
  const itemsById = new Map(
    input.launchItems
      .filter((row) => text(row.owner_id) === ownerId && text(row.item_id))
      .map((row) => [text(row.item_id), row]),
  );
  const bCodesByItem = new Map<string, Set<string>>();
  const itemIdsByBCode = new Map<string, Set<string>>();
  for (const row of input.launchOptions) {
    if (text(row.owner_id) !== ownerId) continue;
    const launchItemId = text(row.item_id);
    const bCode = code(row.barcode);
    if (!itemsById.has(launchItemId) || !B_CODE.test(bCode)) continue;
    const itemCodes = bCodesByItem.get(launchItemId) ?? new Set<string>();
    itemCodes.add(bCode);
    bCodesByItem.set(launchItemId, itemCodes);
    const itemIds = itemIdsByBCode.get(bCode) ?? new Set<string>();
    itemIds.add(launchItemId);
    itemIdsByBCode.set(bCode, itemIds);
  }

  const catalogGroups = new Map<
    string,
    {
      ptnCodes: Set<string>;
      productGroups: Set<string>;
      statuses: Set<string>;
      bCodes: Set<string>;
      invalidPartnerCodeRowCount: number;
    }
  >();
  for (const row of input.catalogRows) {
    const goodsKey = text(row.goods_key);
    const bCode = code(row.optPtnOptCd);
    if (!GOODS_KEY.test(goodsKey)) continue;
    const group = catalogGroups.get(goodsKey) ?? {
      ptnCodes: new Set<string>(),
      productGroups: new Set<string>(),
      statuses: new Set<string>(),
      bCodes: new Set<string>(),
      invalidPartnerCodeRowCount: 0,
    };
    const ptnGoodsCd = code(row.ptn_goods_cd);
    const saleStatus = code(row.sale_status);
    const productGroup = text(row.prod_group);
    if (ptnGoodsCd) group.ptnCodes.add(ptnGoodsCd);
    if (productGroup) group.productGroups.add(productGroup);
    if (saleStatus) group.statuses.add(saleStatus);
    if (B_CODE.test(bCode)) group.bCodes.add(bCode);
    else group.invalidPartnerCodeRowCount += 1;
    catalogGroups.set(goodsKey, group);
  }

  const currentByItem = new Map<string, CatalogIdentity[]>();
  let deletedCatalogGoodsKeyCount = 0;
  let unresolvedCatalogGoodsKeyCount = 0;
  let bCodeCatalogGoodsKeyCount = 0;
  for (const [goodsKey, group] of catalogGroups) {
    if (group.bCodes.size === 0) continue;
    bCodeCatalogGoodsKeyCount += 1;
    const nonDeletedStatuses = [...group.statuses].filter(
      (status) => status !== "Z",
    );
    if (
      group.statuses.size > 0 &&
      [...group.statuses].every((status) => status === "Z")
    ) {
      deletedCatalogGoodsKeyCount += 1;
      continue;
    }
    const candidateItemIds = new Set<string>();
    let identityConflict = group.invalidPartnerCodeRowCount > 0;
    for (const bCode of group.bCodes) {
      const itemIds = itemIdsByBCode.get(bCode);
      if (!itemIds || itemIds.size !== 1) identityConflict = true;
      for (const itemId of itemIds ?? []) candidateItemIds.add(itemId);
    }
    if (candidateItemIds.size !== 1) identityConflict = true;

    const ptnCodes = [...group.ptnCodes];
    const suffixProfiles = new Set(
      ptnCodes
        .map((value) => inferProductGroupFromPtnGoodsCd(value))
        .filter((value) => value.productGroupStatus === "registered")
        .map((value) => value.productGroup),
    );
    const directProfiles = new Set(
      [...group.productGroups].map(profileFromProductGroup).filter(Boolean),
    );
    const profiles = new Set([...directProfiles, ...suffixProfiles]);
    const profileConflict =
      group.productGroups.size > 1 ||
      suffixProfiles.size > 1 ||
      profiles.size !== 1;
    const ptnGoodsCd = ptnCodes.length === 1 ? ptnCodes[0] : "";
    const profile = profiles.size === 1 ? [...profiles][0] : "";
    const selfCodeBase = ptnGoodsCd ? ptnGoodsCd.slice(0, -1) : "";
    const identityRow: CatalogIdentity = {
      goodsKey,
      ptnGoodsCd,
      profile,
      selfCodeBase,
      saleStatus:
        nonDeletedStatuses.length === 1 ? nonDeletedStatuses[0] : "",
      bCodes: [...group.bCodes].sort(),
      candidateItemIds: [...candidateItemIds].sort(),
      identityConflict,
      profileConflict,
      saleStatusConflict:
        nonDeletedStatuses.length !== 1 || group.statuses.size !== 1,
    };
    if (identityConflict || profileConflict || identityRow.saleStatusConflict) {
      unresolvedCatalogGoodsKeyCount += 1;
    }
    for (const launchItemId of candidateItemIds) {
      const rows = currentByItem.get(launchItemId) ?? [];
      rows.push(identityRow);
      currentByItem.set(launchItemId, rows);
    }
  }

  const existingIdentities = new Set(
    (input.existingLifecycleRows ?? []).map((row) =>
      identity(
        text(row.owner_id),
        text(row.market_account_key),
        text(row.launch_item_id),
      ),
    ),
  );
  const existingProfilesByProduct = new Map<string, Set<string>>();
  for (const row of input.existingLifecycleRows ?? []) {
    if (text(row.owner_id) !== ownerId) continue;
    const launchItemId = text(row.launch_item_id);
    const profiles =
      existingProfilesByProduct.get(launchItemId) ?? new Set<string>();
    profiles.add(text(row.market_account_key));
    existingProfilesByProduct.set(launchItemId, profiles);
  }
  const latestLedger = latestRowsByGoodsKey(
    input.marketLedgerRows.filter((row) => text(row.owner_id) === ownerId),
  );

  const syntheticJobs: UnknownRecord[] = [];
  const reviewRecords: SeoListingShadowSeedRecord[] = [];
  const productReviews: SeoListingShoplingBCodeOnboardingPlan["productReviews"] = [];
  let productsMatchedCurrentShopling = 0;
  let productsUnmatchedCurrentShopling = 0;
  let productsPreparedForVerification = 0;
  let productsSkippedExisting = 0;

  for (const launchItemId of [...bCodesByItem.keys()].sort()) {
    const item = itemsById.get(launchItemId);
    if (!item) continue;
    if (
      SEO_LISTING_SHADOW_EXPECTED_PROFILES.every((profile) =>
        existingProfilesByProduct.get(launchItemId)?.has(profile),
      )
    ) {
      productsSkippedExisting += 1;
      continue;
    }
    const currentRows = currentByItem.get(launchItemId) ?? [];
    if (currentRows.length === 0) {
      productsUnmatchedCurrentShopling += 1;
      continue;
    }
    productsMatchedCurrentShopling += 1;
    const currentByProfile = new Map<string, CatalogIdentity[]>();
    for (const row of currentRows) {
      if (!row.profile) continue;
      const rows = currentByProfile.get(row.profile) ?? [];
      rows.push(row);
      currentByProfile.set(row.profile, rows);
    }
    const orderedRows = SEO_LISTING_SHADOW_EXPECTED_PROFILES.map(
      (profile) => currentByProfile.get(profile) ?? [],
    );
    const goodsKeys = orderedRows.map((rows) =>
      rows.length === 1 ? rows[0].goodsKey : "",
    );
    const currentRunId = stableRunId(launchItemId, goodsKeys.filter(Boolean));
    const selfCodeBases = new Set(
      currentRows.map((row) => row.selfCodeBase).filter(Boolean),
    );
    let reason = "";
    if (text(item.archived_at)) {
      reason = "BCODE_LAUNCH_ITEM_ARCHIVED";
    } else if (
      currentRows.some(
        (row) =>
          row.identityConflict || row.profileConflict || row.saleStatusConflict,
      )
    ) {
      reason = "BCODE_SHOPLING_IDENTITY_CONFLICT";
    } else if (orderedRows.some((rows) => rows.length > 1)) {
      reason = "BCODE_SHOPLING_PROFILE_AMBIGUOUS";
    } else if (
      orderedRows.some((rows) => rows.length !== 1) ||
      new Set(goodsKeys).size !== SEO_LISTING_SHADOW_EXPECTED_PROFILES.length
    ) {
      reason = "BCODE_SHOPLING_SIX_PROFILE_SET_INCOMPLETE";
    } else if (selfCodeBases.size !== 1) {
      reason = "BCODE_SHOPLING_SELF_CODE_CONFLICT";
    } else {
      const ledgerRows = goodsKeys
        .map((goodsKey) => latestLedger.get(goodsKey))
        .filter((row): row is UnknownRecord => Boolean(row));
      const ledgerProfiles = new Set(
        ledgerRows.map((row) => text(row.profile)),
      );
      const ledgerShapeComplete =
        ledgerRows.length === SEO_LISTING_SHADOW_EXPECTED_PROFILES.length &&
        ledgerRows.every(
          (row) => text(row.launch_item_id) === launchItemId,
        ) &&
        SEO_LISTING_SHADOW_EXPECTED_PROFILES.every((profile) =>
          ledgerProfiles.has(profile),
        );
      if (!ledgerShapeComplete) {
        reason = "BCODE_MARKET_PIPELINE_IDENTITY_INCOMPLETE";
      }
    }

    if (reason) {
      reviewRecords.push(
        ...exceptionRecords({
          ownerId,
          item,
          reason,
          currentByProfile,
          currentRunId,
          generatedAt,
          existingIdentities,
        }),
      );
      productReviews.push({
        launchItemId,
        modelNumber: text(item.model_number),
        reason,
      });
      continue;
    }

    syntheticJobs.push({
      owner_id: ownerId,
      launch_item_id: launchItemId,
      model_number: text(item.model_number),
      product_name: text(item.product_name),
      run_id: currentRunId,
      registration_status: "success",
      registration_payload: { goodsKeys },
      reconciliation_source: SEO_LISTING_SHOPLING_BCODE_ONBOARDING_SOURCE,
      updated_at: instant(item.updated_at) ?? generatedAt,
    });
    productsPreparedForVerification += 1;
  }

  return {
    generatedAt,
    source: SEO_LISTING_SHOPLING_BCODE_ONBOARDING_SOURCE,
    productsExamined: bCodesByItem.size,
    productsMatchedCurrentShopling,
    productsUnmatchedCurrentShopling,
    productsPreparedForVerification,
    productsNeedingReview: new Set(
      productReviews.map((row) => row.launchItemId),
    ).size,
    productsSkippedExisting,
    currentCatalogGoodsKeyCount:
      bCodeCatalogGoodsKeyCount - deletedCatalogGoodsKeyCount,
    deletedCatalogGoodsKeyCount,
    unresolvedCatalogGoodsKeyCount,
    syntheticJobs,
    exceptionRecords: reviewRecords,
    productReviews,
  };
}
