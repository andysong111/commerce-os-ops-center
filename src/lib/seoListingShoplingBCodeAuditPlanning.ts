import { createHash } from "node:crypto";
import { inferProductGroupFromPtnGoodsCd } from "./productGroup.ts";
import { SEO_LISTING_SHADOW_EXPECTED_PROFILES } from "./seoListingLifecycleReconciliation.ts";

type UnknownRecord = Record<string, unknown>;

const B_CODE = /^B[A-Z]{1,2}\d+-\d+$/;
const GOODS_KEY = /^\d+$/;
const AUDIT_RECEIPT_SCHEMA_VERSION = "seo-listing-bcode-integrity-receipt-v1";

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function code(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as UnknownRecord)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

export function seoListingBCodeAuditFingerprint(value: unknown) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex")}`;
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

function catalogProfile(rows: UnknownRecord[]) {
  const direct = rows.map((row) => profileFromProductGroup(row.prod_group));
  const inferred = rows.map((row) => {
    const result = inferProductGroupFromPtnGoodsCd(code(row.ptn_goods_cd));
    return result.productGroupStatus === "registered" ? result.productGroup : "";
  });
  const profiles = new Set([...direct, ...inferred].filter(Boolean));
  return profiles.size === 1 ? [...profiles][0] : "";
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

function currentCatalogRowsByGoodsKey(rows: UnknownRecord[]) {
  const grouped = new Map<string, UnknownRecord[]>();
  for (const row of rows) {
    const goodsKey = text(row.goods_key);
    if (!GOODS_KEY.test(goodsKey) || code(row.sale_status) === "Z") continue;
    const current = grouped.get(goodsKey) ?? [];
    current.push(row);
    grouped.set(goodsKey, current);
  }
  return grouped;
}

function lifecycleRowsByProduct(rows: UnknownRecord[]) {
  const grouped = new Map<string, UnknownRecord[]>();
  for (const row of rows) {
    const launchItemId = text(row.launch_item_id);
    if (!launchItemId) continue;
    const current = grouped.get(launchItemId) ?? [];
    current.push(row);
    grouped.set(launchItemId, current);
  }
  return grouped;
}

function launchItemsById(rows: UnknownRecord[]) {
  return new Map(
    rows
      .map((row) => [text(row.item_id), row] as const)
      .filter(([launchItemId]) => Boolean(launchItemId)),
  );
}

function launchItemOwnersByBCode(rows: UnknownRecord[]) {
  const owners = new Map<string, Set<string>>();
  for (const row of rows) {
    const bCode = code(row.barcode);
    const launchItemId = text(row.item_id);
    if (!B_CODE.test(bCode) || !launchItemId) continue;
    const current = owners.get(bCode) ?? new Set<string>();
    current.add(launchItemId);
    owners.set(bCode, current);
  }
  return owners;
}

function exactLifecycleBindings(rows: UnknownRecord[]) {
  const byProfile = new Map<string, UnknownRecord[]>();
  for (const row of rows) {
    const profile = text(row.market_account_key);
    const current = byProfile.get(profile) ?? [];
    current.push(row);
    byProfile.set(profile, current);
  }
  const bindings = SEO_LISTING_SHADOW_EXPECTED_PROFILES.map((profile) => {
    const matches = byProfile.get(profile) ?? [];
    return {
      profile,
      goodsKey: matches.length === 1 ? text(matches[0].goods_key) : "",
      state: matches.length === 1 ? code(matches[0].state) : "",
      requiresReview:
        matches.length === 1 ? matches[0].requires_review === true : true,
    };
  });
  const exact =
    rows.length === SEO_LISTING_SHADOW_EXPECTED_PROFILES.length &&
    bindings.every((binding) => GOODS_KEY.test(binding.goodsKey)) &&
    new Set(bindings.map((binding) => binding.goodsKey)).size ===
      SEO_LISTING_SHADOW_EXPECTED_PROFILES.length;
  return { exact, bindings };
}

function exactCatalogBinding(input: {
  goodsKey: string;
  profile: string;
  launchItemId: string;
  catalogRows: UnknownRecord[];
  ownersByBCode: Map<string, Set<string>>;
}) {
  const rows = input.catalogRows;
  const partnerProductCodes = [...new Set(rows.map((row) => code(row.ptn_goods_cd)).filter(Boolean))];
  const saleStatuses = [...new Set(rows.map((row) => code(row.sale_status)).filter(Boolean))];
  const bCodes = [...new Set(rows.map((row) => code(row.optPtnOptCd)).filter(Boolean))].sort();
  const ownerIds = new Set(
    bCodes.flatMap((bCode) => [...(input.ownersByBCode.get(bCode) ?? [])]),
  );
  const profile = catalogProfile(rows);
  const exact =
    rows.length > 0 &&
    partnerProductCodes.length === 1 &&
    saleStatuses.length === 1 &&
    saleStatuses[0] !== "Z" &&
    bCodes.length > 0 &&
    bCodes.every((bCode) => B_CODE.test(bCode)) &&
    ownerIds.size === 1 &&
    ownerIds.has(input.launchItemId) &&
    profile === input.profile;
  return {
    exact,
    goodsKey: input.goodsKey,
    profile,
    partnerProductCode:
      partnerProductCodes.length === 1 ? partnerProductCodes[0] : "",
    saleStatus: saleStatuses.length === 1 ? saleStatuses[0] : "",
    bCodes,
    ownerLaunchItemIds: [...ownerIds].sort(),
  };
}

function registrationGoodsKeys(job: UnknownRecord) {
  const payload = record(job.registration_payload);
  return Array.isArray(payload.goodsKeys)
    ? payload.goodsKeys.map(text).filter(Boolean)
    : [];
}

export function buildSeoListingBCodeAuditPlans(input: {
  ownerId: string;
  generatedAt: string;
  passingJobs: UnknownRecord[];
  productReviews: Array<{
    launchItemId: string;
    modelNumber: string;
    reason: string;
    details?: string[];
  }>;
  existingLifecycleRows: UnknownRecord[];
  catalogRows: UnknownRecord[];
  marketLedgerRows: UnknownRecord[];
  launchItems: UnknownRecord[];
  launchOptions: UnknownRecord[];
}) {
  const ownerId = text(input.ownerId);
  const lifecycleByProduct = lifecycleRowsByProduct(input.existingLifecycleRows);
  const catalogByGoodsKey = currentCatalogRowsByGoodsKey(input.catalogRows);
  const latestLedger = latestRowsByGoodsKey(input.marketLedgerRows);
  const itemsById = launchItemsById(input.launchItems);
  const ownersByBCode = launchItemOwnersByBCode(input.launchOptions);

  const receipts: UnknownRecord[] = [];
  const receiptHolds: UnknownRecord[] = [];
  for (const job of input.passingJobs) {
    const launchItemId = text(job.launch_item_id);
    const item = itemsById.get(launchItemId) ?? {};
    const lifecycle = exactLifecycleBindings(
      lifecycleByProduct.get(launchItemId) ?? [],
    );
    const goodsKeys = registrationGoodsKeys(job);
    const jobShapeExact =
      goodsKeys.length === SEO_LISTING_SHADOW_EXPECTED_PROFILES.length &&
      new Set(goodsKeys).size === SEO_LISTING_SHADOW_EXPECTED_PROFILES.length &&
      goodsKeys.every((goodsKey) => GOODS_KEY.test(goodsKey));
    const bindings = SEO_LISTING_SHADOW_EXPECTED_PROFILES.map(
      (profile, index) => {
        const goodsKey = goodsKeys[index] ?? "";
        const catalog = exactCatalogBinding({
          goodsKey,
          profile,
          launchItemId,
          catalogRows: catalogByGoodsKey.get(goodsKey) ?? [],
          ownersByBCode,
        });
        const ledger = latestLedger.get(goodsKey);
        const marketLedgerIdentityExact =
          Boolean(ledger) &&
          text(ledger?.launch_item_id) === launchItemId &&
          text(ledger?.profile) === profile;
        return {
          profile,
          goodsKey,
          lifecycleGoodsKey: lifecycle.bindings[index]?.goodsKey ?? "",
          lifecycleState: lifecycle.bindings[index]?.state ?? "",
          catalogPartnerProductCode: catalog.partnerProductCode,
          catalogSaleStatus: catalog.saleStatus,
          catalogBCodes: catalog.bCodes,
          catalogIdentityExact: catalog.exact,
          marketLedgerIdentityExact,
          marketLedgerStatus: text(ledger?.status),
          marketLedgerTitleStatus: text(ledger?.title_status),
          marketLedgerMarketStatus: text(ledger?.market_status),
        };
      },
    );
    const exact =
      jobShapeExact &&
      lifecycle.exact &&
      bindings.every(
        (binding) =>
          binding.goodsKey === binding.lifecycleGoodsKey &&
          binding.catalogIdentityExact &&
          binding.marketLedgerIdentityExact,
      );
    if (!exact) {
      receiptHolds.push({
        launchItemId,
        modelNumber: text(item.model_number) || text(job.model_number),
        reason: "AUDIT_RECEIPT_EVIDENCE_DRIFT",
      });
      continue;
    }
    const semanticEvidence = {
      schemaVersion: AUDIT_RECEIPT_SCHEMA_VERSION,
      ownerId,
      launchItemId,
      modelNumber: text(item.model_number) || text(job.model_number),
      productName: text(item.product_name) || text(job.product_name),
      bindings: bindings.map((binding) => ({
        profile: binding.profile,
        goodsKey: binding.goodsKey,
        lifecycleState: binding.lifecycleState,
        catalogPartnerProductCode: binding.catalogPartnerProductCode,
        catalogSaleStatus: binding.catalogSaleStatus,
        catalogBCodes: binding.catalogBCodes,
        marketLedgerStatus: binding.marketLedgerStatus,
        marketLedgerTitleStatus: binding.marketLedgerTitleStatus,
        marketLedgerMarketStatus: binding.marketLedgerMarketStatus,
      })),
    };
    receipts.push({
      ...semanticEvidence,
      observedAt: input.generatedAt,
      fingerprint: seoListingBCodeAuditFingerprint(semanticEvidence),
      internalWriteApplied: false,
      externalMarketWrite: false,
    });
  }
  receipts.sort((left, right) =>
    text(left.launchItemId).localeCompare(text(right.launchItemId)),
  );
  const receiptSetEvidence = {
    schemaVersion: `${AUDIT_RECEIPT_SCHEMA_VERSION}:set`,
    receiptFingerprints: receipts.map((row) => text(row.fingerprint)).sort(),
  };

  const isolationReasons = new Set([
    "BCODE_SHOPLING_CURRENT_CATALOG_MISSING",
    "BCODE_LAUNCH_OPTION_BCODE_MISSING",
    "BCODE_LAUNCH_ITEM_MISSING",
  ]);
  const isolationProducts: UnknownRecord[] = [];
  for (const review of input.productReviews.filter((row) =>
    isolationReasons.has(row.reason),
  )) {
    const lifecycle = exactLifecycleBindings(
      lifecycleByProduct.get(review.launchItemId) ?? [],
    );
    const overlapLaunchItemIds = new Set<string>();
    const currentCatalogGoodsKeys: string[] = [];
    for (const binding of lifecycle.bindings) {
      const rows = catalogByGoodsKey.get(binding.goodsKey) ?? [];
      if (rows.length > 0) currentCatalogGoodsKeys.push(binding.goodsKey);
      for (const row of rows) {
        const bCode = code(row.optPtnOptCd);
        for (const launchItemId of ownersByBCode.get(bCode) ?? []) {
          overlapLaunchItemIds.add(launchItemId);
        }
      }
    }
    const ready =
      review.reason === "BCODE_SHOPLING_CURRENT_CATALOG_MISSING" &&
      lifecycle.exact &&
      currentCatalogGoodsKeys.length === 0 &&
      overlapLaunchItemIds.size === 0;
    isolationProducts.push({
      launchItemId: review.launchItemId,
      modelNumber: review.modelNumber,
      reason: review.reason,
      lifecycleGoodsKeys: lifecycle.bindings.map((row) => row.goodsKey),
      currentCatalogGoodsKeys: [...new Set(currentCatalogGoodsKeys)].sort(),
      overlapLaunchItemIds: [...overlapLaunchItemIds].sort(),
      disposition: ready ? "INTERNAL_ISOLATION_READY" : "HOLD_FOR_REVIEW",
    });
  }
  isolationProducts.sort((left, right) =>
    text(left.launchItemId).localeCompare(text(right.launchItemId)),
  );

  const marketLedgerRecoveryProducts: UnknownRecord[] = [];
  for (const review of input.productReviews.filter(
    (row) => row.reason === "BCODE_MARKET_PIPELINE_IDENTITY_INCOMPLETE",
  )) {
    const lifecycle = exactLifecycleBindings(
      lifecycleByProduct.get(review.launchItemId) ?? [],
    );
    const bindings = lifecycle.bindings.map((binding) => {
      const catalog = exactCatalogBinding({
        goodsKey: binding.goodsKey,
        profile: binding.profile,
        launchItemId: review.launchItemId,
        catalogRows: catalogByGoodsKey.get(binding.goodsKey) ?? [],
        ownersByBCode,
      });
      const ledger = latestLedger.get(binding.goodsKey);
      return {
        profile: binding.profile,
        goodsKey: binding.goodsKey,
        catalogIdentityExact: catalog.exact,
        existingLedgerLaunchItemId: text(ledger?.launch_item_id),
        existingLedgerProfile: text(ledger?.profile),
      };
    });
    const exact =
      lifecycle.exact &&
      bindings.every((binding) => binding.catalogIdentityExact);
    marketLedgerRecoveryProducts.push({
      launchItemId: review.launchItemId,
      modelNumber: review.modelNumber,
      bindings,
      disposition: exact
        ? "INTERNAL_MARKET_LEDGER_RECOVERY_CANDIDATE"
        : "HOLD_FOR_REVIEW",
    });
  }
  marketLedgerRecoveryProducts.sort((left, right) =>
    text(left.launchItemId).localeCompare(text(right.launchItemId)),
  );

  return {
    auditReceipts: {
      schemaVersion: AUDIT_RECEIPT_SCHEMA_VERSION,
      expectedPassCount: input.passingJobs.length,
      receiptCount: receipts.length,
      holdCount: receiptHolds.length,
      complete:
        receipts.length === input.passingJobs.length && receiptHolds.length === 0,
      receiptSetFingerprint: seoListingBCodeAuditFingerprint(receiptSetEvidence),
      receipts,
      holds: receiptHolds,
      persistenceApplied: false,
    },
    isolationPlan: {
      candidateCount: isolationProducts.length,
      readyCount: isolationProducts.filter(
        (row) => row.disposition === "INTERNAL_ISOLATION_READY",
      ).length,
      holdCount: isolationProducts.filter(
        (row) => row.disposition !== "INTERNAL_ISOLATION_READY",
      ).length,
      products: isolationProducts,
      internalWriteApplied: false,
      externalMarketWrite: false,
    },
    marketLedgerRecoveryPlan: {
      candidateCount: marketLedgerRecoveryProducts.length,
      readyCount: marketLedgerRecoveryProducts.filter(
        (row) =>
          row.disposition === "INTERNAL_MARKET_LEDGER_RECOVERY_CANDIDATE",
      ).length,
      holdCount: marketLedgerRecoveryProducts.filter(
        (row) =>
          row.disposition !== "INTERNAL_MARKET_LEDGER_RECOVERY_CANDIDATE",
      ).length,
      products: marketLedgerRecoveryProducts,
      internalWriteApplied: false,
      externalMarketWrite: false,
    },
  };
}
