import type {
  FreightApplication,
  FreightApplicationItem,
} from "../types/freightBarcodeRequest.ts";
import type {
  LegacySeoInventoryProduct,
  LegacySeoInventorySku,
} from "./legacySeoInventoryCatalog.ts";

export type FreightProductMasterMatchStatus =
  | "MATCHED"
  | "UNMATCHED"
  | "AMBIGUOUS";

export type FreightProductMasterMatchReason =
  | "OFFER_AND_OPTION_EXACT"
  | "OFFER_UNIQUE_SKU"
  | "LOOKUP_BARCODE_EXACT"
  | "LOOKUP_MODEL_UNIQUE_SKU"
  | "LOOKUP_PRODUCT_UNIQUE_SKU"
  | "OFFER_ID_MISSING"
  | "OFFER_NOT_FOUND"
  | "OPTION_NOT_FOUND"
  | "OPTION_AMBIGUOUS"
  | "LOOKUP_NOT_FOUND"
  | "LOOKUP_AMBIGUOUS";

export type FreightProductMasterMatch = {
  itemId: string;
  applicationNo?: string;
  rowNo: number;
  status: FreightProductMasterMatchStatus;
  reason: FreightProductMasterMatchReason;
  offerId?: string;
  modelNo?: string;
  modelName?: string;
  optionName?: string;
  barcode?: string;
  origin?: string;
  displayName?: string;
  imageUrl?: string;
};

export type FreightProductMasterMatchSummary = {
  total: number;
  matched: number;
  unmatched: number;
  ambiguous: number;
};

export type FreightProductMasterMatchResponse = {
  ok: true;
  matches: FreightProductMasterMatch[];
  summary: FreightProductMasterMatchSummary;
};

type CanonicalSkuCandidate = {
  offerId: string;
  product: LegacySeoInventoryProduct;
  sku: LegacySeoInventorySku;
  normalizedOption: string;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function normalizeLookup(value: unknown) {
  return text(value).toLocaleLowerCase("ko-KR").replace(/\s+/g, "");
}

export function extractFreight1688OfferId(value: unknown) {
  const source = text(value);
  if (!source) return "";
  return (
    source.match(/(?:detail\.)?1688\.com\/offer\/(\d{6,20})(?:\.html)?/i)?.[1] ??
    source.match(/[?&](?:offerId|offer_id)=(\d{6,20})(?:&|$)/i)?.[1] ??
    ""
  );
}

export function normalizeFreightChinaOption(value: unknown) {
  return text(value)
    .toLocaleLowerCase("zh-CN")
    .replace(
      /^(?:(?:옵션\s*\(\s*색상\s*,?\s*사이즈\s*\)|옵션|颜色|顏色|产品规格|產品規格|规格|規格|型号|型號|尺寸|款式|商品属性|商品屬性)\s*[:：]\s*)+/i,
      "",
    )
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function candidateKey(candidate: CanonicalSkuCandidate) {
  return [
    normalizeLookup(candidate.product.modelNo),
    normalizeLookup(candidate.sku.barcode),
    candidate.normalizedOption,
  ].join("|");
}

function canonicalCandidates(products: LegacySeoInventoryProduct[]) {
  const byKey = new Map<string, CanonicalSkuCandidate>();
  for (const product of products) {
    for (const sku of product.skus) {
      if (
        sku.active === false ||
        !text(sku.barcode) ||
        !text(product.modelNo) ||
        !text(product.productName)
      ) {
        continue;
      }
      const offerId = extractFreight1688OfferId(sku.supplierUrl);
      const candidate = {
        offerId,
        product,
        sku,
        normalizedOption: normalizeFreightChinaOption(sku.chinaOptionName),
      };
      byKey.set(`${offerId}|${candidateKey(candidate)}`, candidate);
    }
  }
  return [...byKey.values()];
}

function matched(
  item: FreightApplicationItem,
  candidate: CanonicalSkuCandidate,
  reason: FreightProductMasterMatchReason,
): FreightProductMasterMatch {
  const modelName = text(candidate.product.productName);
  const optionName = text(candidate.sku.optionName);
  const displayName = [modelName, optionName].filter(Boolean).join(" / ");
  return {
    itemId: item.id,
    applicationNo: item.applicationNo,
    rowNo: item.rowNo,
    status: "MATCHED",
    reason,
    offerId: candidate.offerId,
    modelNo: text(candidate.product.modelNo),
    modelName,
    optionName,
    barcode: text(candidate.sku.barcode),
    origin: text(candidate.product.origin),
    displayName,
    imageUrl:
      text(candidate.sku.optionImageUrl) || text(candidate.product.mainImageUrl),
  };
}

function unresolved(
  item: FreightApplicationItem,
  status: Exclude<FreightProductMasterMatchStatus, "MATCHED">,
  reason: FreightProductMasterMatchReason,
  offerId = "",
): FreightProductMasterMatch {
  return {
    itemId: item.id,
    applicationNo: item.applicationNo,
    rowNo: item.rowNo,
    status,
    reason,
    ...(offerId ? { offerId } : {}),
  };
}

function uniqueCandidates(candidates: CanonicalSkuCandidate[]) {
  return [...new Map(candidates.map((candidate) => [candidateKey(candidate), candidate])).values()];
}

function matchByExactLookup(
  item: FreightApplicationItem,
  candidates: CanonicalSkuCandidate[],
) {
  const query = normalizeLookup(item.lookupText);
  if (!query) return undefined;

  const barcodeMatches = uniqueCandidates(
    candidates.filter((candidate) => normalizeLookup(candidate.sku.barcode) === query),
  );
  if (barcodeMatches.length === 1) {
    return matched(item, barcodeMatches[0], "LOOKUP_BARCODE_EXACT");
  }
  if (barcodeMatches.length > 1) {
    return unresolved(item, "AMBIGUOUS", "LOOKUP_AMBIGUOUS");
  }

  const modelMatches = uniqueCandidates(
    candidates.filter((candidate) => normalizeLookup(candidate.product.modelNo) === query),
  );
  if (modelMatches.length === 1) {
    return matched(item, modelMatches[0], "LOOKUP_MODEL_UNIQUE_SKU");
  }
  if (modelMatches.length > 1) {
    return unresolved(item, "AMBIGUOUS", "LOOKUP_AMBIGUOUS");
  }

  const productNameMatches = uniqueCandidates(
    candidates.filter((candidate) => normalizeLookup(candidate.product.productName) === query),
  );
  if (productNameMatches.length === 1) {
    return matched(item, productNameMatches[0], "LOOKUP_PRODUCT_UNIQUE_SKU");
  }
  if (productNameMatches.length > 1) {
    return unresolved(item, "AMBIGUOUS", "LOOKUP_AMBIGUOUS");
  }

  return unresolved(item, "UNMATCHED", "LOOKUP_NOT_FOUND");
}

function matchItem(
  item: FreightApplicationItem,
  candidates: CanonicalSkuCandidate[],
  candidatesByOffer: Map<string, CanonicalSkuCandidate[]>,
) {
  const offerId = extractFreight1688OfferId(item.detailUrl);
  if (!offerId) {
    return (
      matchByExactLookup(item, candidates) ??
      unresolved(item, "UNMATCHED", "OFFER_ID_MISSING")
    );
  }

  const offerCandidates = uniqueCandidates(candidatesByOffer.get(offerId) ?? []);
  if (offerCandidates.length === 0) {
    return unresolved(item, "UNMATCHED", "OFFER_NOT_FOUND", offerId);
  }

  const normalizedOption = normalizeFreightChinaOption(item.optionText);
  if (normalizedOption) {
    const exactOptions = uniqueCandidates(
      offerCandidates.filter(
        (candidate) =>
          candidate.normalizedOption &&
          candidate.normalizedOption === normalizedOption,
      ),
    );
    if (exactOptions.length === 1) {
      return matched(item, exactOptions[0], "OFFER_AND_OPTION_EXACT");
    }
    if (exactOptions.length > 1) {
      return unresolved(item, "AMBIGUOUS", "OPTION_AMBIGUOUS", offerId);
    }
    return unresolved(
      item,
      offerCandidates.length > 1 ? "AMBIGUOUS" : "UNMATCHED",
      offerCandidates.length > 1 ? "OPTION_AMBIGUOUS" : "OPTION_NOT_FOUND",
      offerId,
    );
  }

  if (offerCandidates.length === 1) {
    return matched(item, offerCandidates[0], "OFFER_UNIQUE_SKU");
  }
  return unresolved(item, "AMBIGUOUS", "OPTION_AMBIGUOUS", offerId);
}

export function matchFreightItemsToProductMaster(
  items: FreightApplicationItem[],
  products: LegacySeoInventoryProduct[],
): FreightProductMasterMatchResponse {
  const candidates = canonicalCandidates(products);
  const candidatesByOffer = new Map<string, CanonicalSkuCandidate[]>();
  for (const candidate of candidates) {
    if (!candidate.offerId) continue;
    const current = candidatesByOffer.get(candidate.offerId) ?? [];
    current.push(candidate);
    candidatesByOffer.set(candidate.offerId, current);
  }

  const matches = items.map((item) =>
    matchItem(item, candidates, candidatesByOffer),
  );
  return {
    ok: true,
    matches,
    summary: {
      total: matches.length,
      matched: matches.filter((match) => match.status === "MATCHED").length,
      unmatched: matches.filter((match) => match.status === "UNMATCHED").length,
      ambiguous: matches.filter((match) => match.status === "AMBIGUOUS").length,
    },
  };
}

export function applyFreightProductMasterMatches(
  application: FreightApplication,
  matches: FreightProductMasterMatch[],
): FreightApplication {
  const byItemId = new Map(
    matches
      .filter((match) => match.status === "MATCHED")
      .map((match) => [match.itemId, match] as const),
  );
  return {
    ...application,
    items: application.items.map((item) => {
      const match = byItemId.get(item.id);
      if (!match?.modelNo || !match.barcode) return item;
      return {
        ...item,
        modelNo: match.modelNo,
        modelName: match.modelName,
        optionName: match.optionName,
        barcode: match.barcode,
        origin: match.origin,
        displayName: match.displayName,
        matchedModelNo: match.modelNo,
        matchedModelName: match.modelName,
        matchedProductNameKo: match.modelName,
        matchedBarcode: match.barcode,
        matchedOriginLabel: match.origin,
        matchedLabelText: match.displayName,
        matchedImageUrl: match.imageUrl,
      };
    }),
  };
}
