import { createHash } from "node:crypto";
import {
  INTERNAL_PRICE_GROUP_MULTIPLIER,
  normalizeInternalPriceGroup,
  type InternalPriceGroup,
} from "./internalChinaPriceGroupPolicy.ts";
import { shoplingSaleStatusActive } from "./internalChinaShoplingSaleStatus.ts";
import type { ShoplingCurrentPriceSnapshot } from "./shopling/shoplingCurrentPriceResolver.ts";
import type { PlanningProduct } from "./shopling/shoplingLiveAggregation.ts";

export const WHOLESALE_COST_ESTIMATE_SOURCE =
  "SHOPLING_ACTIVE_WHOLESALE_SALE_PRICE_ESTIMATE" as const;

const WHOLESALE_GROUPS = new Set<InternalPriceGroup>([
  "도매1",
  "도매2",
  "도매3",
  "도매4",
]);

export type PurchaseWholesaleCostEstimateEvidence = {
  goodsKey: string;
  optionId: string;
  productGroup: InternalPriceGroup;
  effectiveSalePriceKrw: number;
  unitsPerOrder: number;
  estimatedUnitCostKrw: number;
};

export type PurchaseWholesaleCostEstimateRow = {
  barcode: string;
  state: "ESTIMATED" | "MISSING";
  estimatedUnitCostKrw: number;
  source: typeof WHOLESALE_COST_ESTIMATE_SOURCE;
  reason:
    | null
    | "NO_ACTIVE_WHOLESALE_LISTING"
    | "WHOLESALE_LISTING_PRICE_UNRESOLVED"
    | "ACTIVE_WHOLESALE_PRICE_UNAVAILABLE";
  evidence: PurchaseWholesaleCostEstimateEvidence[];
};

export type PurchaseWholesaleCostEstimateSnapshot = {
  generatedAt: string;
  planningContentFingerprint: string;
  contentFingerprint: string;
  state: "READY" | "PARTIAL" | "BLOCKED";
  estimatedCount: number;
  missingCount: number;
  writesEnabled: false;
  rows: PurchaseWholesaleCostEstimateRow[];
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function barcode(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function hash(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function estimateFromSalePrice(input: {
  effectiveSalePrice: unknown;
  unitsPerOrder: unknown;
  productGroup: unknown;
}) {
  const price = positiveInteger(input.effectiveSalePrice);
  const units = positiveInteger(input.unitsPerOrder);
  const group = normalizeInternalPriceGroup(input.productGroup);
  if (!price || !units || !group || !WHOLESALE_GROUPS.has(group)) return null;
  const denominator = units * 2 * INTERNAL_PRICE_GROUP_MULTIPLIER[group];
  const estimatedUnitCostKrw = Math.ceil(price / denominator);
  if (!positiveInteger(estimatedUnitCostKrw)) return null;
  return { group, estimatedUnitCostKrw };
}

export function buildPurchaseWholesaleCostEstimates(input: {
  products: PlanningProduct[];
  planningContentFingerprint: string;
  currentPrices: ShoplingCurrentPriceSnapshot;
}): PurchaseWholesaleCostEstimateSnapshot {
  const currentByBarcode = new Map(
    input.currentPrices.rows.map((row) => [barcode(row.barcode), row] as const),
  );
  const rows = input.products
    .filter((product) => product.skuActive !== false)
    .map((product): PurchaseWholesaleCostEstimateRow => {
      const key = barcode(product.barcode);
      const activePlanning = (product.listings ?? []).filter(
        (listing) => listing.active !== false,
      );
      const current = currentByBarcode.get(key);
      const evidenceByIdentity = new Map<
        string,
        PurchaseWholesaleCostEstimateEvidence
      >();
      let hasWholesalePlanningListing = false;

      for (const listing of current?.listings ?? []) {
        const group = normalizeInternalPriceGroup(listing.productGroup);
        if (!group || !WHOLESALE_GROUPS.has(group)) continue;
        hasWholesalePlanningListing = true;
        if (!shoplingSaleStatusActive(listing.saleStatus)) continue;
        const matches = activePlanning.filter((planned) => {
          if (text(planned.goodsKey) !== text(listing.goodsKey)) return false;
          const plannedOption = text(planned.optionId);
          return !plannedOption || plannedOption === text(listing.optionId);
        });
        if (matches.length !== 1) continue;
        const estimate = estimateFromSalePrice({
          effectiveSalePrice: listing.effectiveSalePrice,
          unitsPerOrder: matches[0].unitsPerOrder,
          productGroup: group,
        });
        if (!estimate) continue;
        const identity = `${text(listing.goodsKey)}:${text(listing.optionId)}:${group}`;
        evidenceByIdentity.set(identity, {
          goodsKey: text(listing.goodsKey),
          optionId: text(listing.optionId),
          productGroup: group,
          effectiveSalePriceKrw: positiveInteger(listing.effectiveSalePrice),
          unitsPerOrder: positiveInteger(matches[0].unitsPerOrder),
          estimatedUnitCostKrw: estimate.estimatedUnitCostKrw,
        });
      }

      const evidence = [...evidenceByIdentity.values()].sort(
        (left, right) =>
          left.goodsKey.localeCompare(right.goodsKey) ||
          left.optionId.localeCompare(right.optionId) ||
          left.productGroup.localeCompare(right.productGroup),
      );
      const estimatedUnitCostKrw = Math.max(
        0,
        ...evidence.map((row) => row.estimatedUnitCostKrw),
      );
      const activeWholesalePlanningCount = activePlanning.filter((planned) => {
        const resolved = current?.listings.find(
          (row) =>
            text(row.goodsKey) === text(planned.goodsKey) &&
            (!text(planned.optionId) || text(row.optionId) === text(planned.optionId)),
        );
        const group = normalizeInternalPriceGroup(resolved?.productGroup);
        return Boolean(group && WHOLESALE_GROUPS.has(group));
      }).length;
      const reason = estimatedUnitCostKrw
        ? null
        : !hasWholesalePlanningListing && activeWholesalePlanningCount === 0
          ? "NO_ACTIVE_WHOLESALE_LISTING"
          : current?.state === "CONFLICT" || (current?.conflictListingCount ?? 0) > 0
            ? "WHOLESALE_LISTING_PRICE_UNRESOLVED"
            : "ACTIVE_WHOLESALE_PRICE_UNAVAILABLE";
      return {
        barcode: key,
        state: estimatedUnitCostKrw ? "ESTIMATED" : "MISSING",
        estimatedUnitCostKrw,
        source: WHOLESALE_COST_ESTIMATE_SOURCE,
        reason,
        evidence,
      };
    })
    .sort((left, right) => left.barcode.localeCompare(right.barcode));

  const estimatedCount = rows.filter((row) => row.state === "ESTIMATED").length;
  const missingCount = rows.length - estimatedCount;
  const content = {
    planningContentFingerprint: input.planningContentFingerprint,
    rows,
  };
  return {
    generatedAt: input.currentPrices.generatedAt,
    planningContentFingerprint: input.planningContentFingerprint,
    contentFingerprint: hash(content),
    state:
      estimatedCount === rows.length && rows.length > 0
        ? "READY"
        : estimatedCount > 0
          ? "PARTIAL"
          : "BLOCKED",
    estimatedCount,
    missingCount,
    writesEnabled: false,
    rows,
  };
}
