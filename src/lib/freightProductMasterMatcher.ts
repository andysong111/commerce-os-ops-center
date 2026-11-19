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
  | "PURCHASE_DRAFT_ORDER_EXACT"
  | "PURCHASE_DRAFT_ORDER_DISAMBIGUATED"
  | "PURCHASE_DRAFT_OFFER_EXACT"
  | "PURCHASE_DRAFT_OFFER_DISAMBIGUATED"
  | "PURCHASE_DRAFT_OPTION_EXACT"
  | "PURCHASE_DRAFT_OPTION_DISAMBIGUATED"
  | "PURCHASE_DRAFT_NOT_FOUND"
  | "PURCHASE_DRAFT_AMBIGUOUS"
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
  bundleUnit?: number;
  bundleUnitUpdatedAt?: string;
  source?: "PURCHASE_DRAFT" | "PRODUCT_MASTER";
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
  purchaseDraftResolution?: {
    mode: "EXPLICIT" | "ORDER_NUMBER_AUTO";
    draftIds: string[];
    requestedOrderCount: number;
    resolvedOrderCount: number;
  };
};

type CanonicalSkuCandidate = {
  offerId: string;
  product: LegacySeoInventoryProduct;
  sku: LegacySeoInventorySku;
  normalizedOption: string;
};

export type FreightPurchaseDraftLine = {
  barcode: string;
  modelNo: string;
  modelName: string;
  saleOption: string;
  chinaOption: string;
  orderNumber: string;
  supplierLink: string;
  quantity: number;
  bundleUnit?: number;
  bundleUnitUpdatedAt?: string | null;
};

export type FreightPurchaseDraftSource = {
  draftId: string;
  lines: FreightPurchaseDraftLine[];
};

export type FreightPurchaseDraftOrderSelection = {
  draftIds: string[];
  lines: FreightPurchaseDraftLine[];
  requestedOrderCount: number;
  resolvedOrderCount: number;
};

type PurchaseDraftCandidate = {
  index: number;
  line: FreightPurchaseDraftLine;
  offerId: string;
  normalizedOption: string;
};

const B_CODE = /^B[A-Z]{2}\d+-\d+$/;

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function normalizeLookup(value: unknown) {
  return text(value).toLocaleLowerCase("ko-KR").replace(/\s+/g, "");
}

function normalizeOrderNumber(value: unknown) {
  return text(value).replace(/\s+/g, "").toUpperCase();
}

export function selectFreightPurchaseDraftLinesByOrderNumbers(
  items: FreightApplicationItem[],
  draftsInPriorityOrder: FreightPurchaseDraftSource[],
): FreightPurchaseDraftOrderSelection {
  const requestedOrders = [
    ...new Set(items.map((item) => normalizeOrderNumber(item.orderNo)).filter(Boolean)),
  ];
  const ownerByOrder = new Map<string, FreightPurchaseDraftSource>();

  for (const draft of draftsInPriorityOrder) {
    const draftOrders = new Set(
      draft.lines
        .map((line) => normalizeOrderNumber(line.orderNumber))
        .filter(Boolean),
    );
    for (const orderNumber of requestedOrders) {
      if (!ownerByOrder.has(orderNumber) && draftOrders.has(orderNumber)) {
        ownerByOrder.set(orderNumber, draft);
      }
    }
  }

  const selectedDraftIds = [
    ...new Set([...ownerByOrder.values()].map((draft) => draft.draftId)),
  ];
  const lines = selectedDraftIds.flatMap((draftId) => {
    const draft = draftsInPriorityOrder.find((candidate) => candidate.draftId === draftId);
    if (!draft) return [];
    return draft.lines.filter((line) => {
      const orderNumber = normalizeOrderNumber(line.orderNumber);
      return !orderNumber || ownerByOrder.get(orderNumber)?.draftId === draftId;
    });
  });

  return {
    draftIds: selectedDraftIds,
    lines,
    requestedOrderCount: requestedOrders.length,
    resolvedOrderCount: ownerByOrder.size,
  };
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
      /(?:^|[\s,，;；|/])(?:옵션\s*\(\s*색상\s*,?\s*사이즈\s*\)|옵션|笔芯颜色|筆芯顏色|颜色数|顏色數|规格型号|規格型號|产品规格|產品規格|商品属性|商品屬性|颜色|顏色|规格|規格|型号|型號|尺寸|款式|尺码|尺碼|形状|形狀|纯度|純度|高度)\s*[:：]\s*/gi,
      " ",
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
    ...(Number.isSafeInteger(Number(candidate.sku.bundleUnit)) &&
    Number(candidate.sku.bundleUnit) > 0
      ? { bundleUnit: Number(candidate.sku.bundleUnit) }
      : {}),
    ...(Number.isFinite(Date.parse(text(candidate.sku.bundleUnitUpdatedAt)))
      ? { bundleUnitUpdatedAt: new Date(text(candidate.sku.bundleUnitUpdatedAt)).toISOString() }
      : {}),
    source: "PRODUCT_MASTER",
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

function draftCandidateScore(
  item: FreightApplicationItem,
  candidate: PurchaseDraftCandidate,
) {
  let score = 0;
  const itemOfferId = extractFreight1688OfferId(item.detailUrl);
  if (itemOfferId && itemOfferId === candidate.offerId) score += 400;

  const itemOption = normalizeFreightChinaOption(item.optionText);
  const saleOption = normalizeFreightChinaOption(candidate.line.saleOption);
  if (itemOption && candidate.normalizedOption === itemOption) score += 240;
  else if (itemOption && saleOption === itemOption) score += 220;
  else if (
    itemOption &&
    candidate.normalizedOption &&
    (itemOption.includes(candidate.normalizedOption) ||
      candidate.normalizedOption.includes(itemOption))
  ) {
    score += 140;
  }

  if (item.quantity > 0 && item.quantity === candidate.line.quantity) score += 30;
  if (
    normalizeLookup(item.itemName) &&
    normalizeLookup(item.itemName) === normalizeLookup(candidate.line.modelName)
  ) {
    score += 10;
  }
  return score;
}

function chooseUniqueDraftCandidate(
  item: FreightApplicationItem,
  candidates: PurchaseDraftCandidate[],
) {
  if (candidates.length === 1) return candidates[0];
  const ranked = candidates
    .map((candidate) => ({ candidate, score: draftCandidateScore(item, candidate) }))
    .sort(
      (left, right) =>
        right.score - left.score || left.candidate.index - right.candidate.index,
    );
  if (!ranked[0] || ranked[0].score <= 0) return undefined;
  if (ranked[1] && ranked[0].score === ranked[1].score) return undefined;
  return ranked[0].candidate;
}

function matchedDraft(
  item: FreightApplicationItem,
  candidate: PurchaseDraftCandidate,
  reason: FreightProductMasterMatchReason,
): FreightProductMasterMatch {
  const modelName = text(candidate.line.modelName);
  const optionName = text(candidate.line.saleOption || candidate.line.chinaOption);
  return {
    itemId: item.id,
    applicationNo: item.applicationNo,
    rowNo: item.rowNo,
    status: "MATCHED",
    reason,
    source: "PURCHASE_DRAFT",
    ...(candidate.offerId ? { offerId: candidate.offerId } : {}),
    modelNo: text(candidate.line.modelNo),
    modelName,
    optionName,
    barcode: text(candidate.line.barcode),
    displayName: [modelName, optionName].filter(Boolean).join(" / "),
    ...(Number.isSafeInteger(Number(candidate.line.bundleUnit)) &&
    Number(candidate.line.bundleUnit) > 0
      ? { bundleUnit: Number(candidate.line.bundleUnit) }
      : {}),
    ...(Number.isFinite(Date.parse(text(candidate.line.bundleUnitUpdatedAt)))
      ? { bundleUnitUpdatedAt: new Date(text(candidate.line.bundleUnitUpdatedAt)).toISOString() }
      : {}),
  };
}

function summarize(matches: FreightProductMasterMatch[]): FreightProductMasterMatchResponse {
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

export function matchFreightItemsToPurchaseDraft(
  items: FreightApplicationItem[],
  lines: FreightPurchaseDraftLine[],
): FreightProductMasterMatchResponse {
  const candidates = lines
    .map((line, index) => ({
      index,
      line,
      offerId: extractFreight1688OfferId(line.supplierLink),
      normalizedOption: normalizeFreightChinaOption(line.chinaOption),
    }))
    .filter(
      (candidate) =>
        B_CODE.test(text(candidate.line.barcode)) &&
        text(candidate.line.modelNo) &&
        text(candidate.line.modelName),
    );
  const used = new Set<number>();

  const matches = items.map((item) => {
    const available = candidates.filter((candidate) => !used.has(candidate.index));
    const itemOrder = normalizeOrderNumber(item.orderNo);
    if (itemOrder) {
      const exactOrder = available.filter(
        (candidate) =>
          normalizeOrderNumber(candidate.line.orderNumber) === itemOrder,
      );
      if (exactOrder.length > 0) {
        const candidate = chooseUniqueDraftCandidate(item, exactOrder);
        if (!candidate) {
          return unresolved(item, "AMBIGUOUS", "PURCHASE_DRAFT_AMBIGUOUS");
        }
        used.add(candidate.index);
        return matchedDraft(
          item,
          candidate,
          exactOrder.length === 1
            ? "PURCHASE_DRAFT_ORDER_EXACT"
            : "PURCHASE_DRAFT_ORDER_DISAMBIGUATED",
        );
      }
    }

    const itemOfferId = extractFreight1688OfferId(item.detailUrl);
    if (itemOfferId) {
      const exactOffer = available.filter(
        (candidate) => candidate.offerId === itemOfferId,
      );
      if (exactOffer.length > 0) {
        const candidate = chooseUniqueDraftCandidate(item, exactOffer);
        if (!candidate) {
          return unresolved(item, "AMBIGUOUS", "PURCHASE_DRAFT_AMBIGUOUS", itemOfferId);
        }
        used.add(candidate.index);
        return matchedDraft(
          item,
          candidate,
          exactOffer.length === 1
            ? "PURCHASE_DRAFT_OFFER_EXACT"
            : "PURCHASE_DRAFT_OFFER_DISAMBIGUATED",
        );
      }
    }

    const itemOption = normalizeFreightChinaOption(item.optionText);
    if (itemOption) {
      const exactOption = available.filter((candidate) => {
        const saleOption = normalizeFreightChinaOption(candidate.line.saleOption);
        return candidate.normalizedOption === itemOption || saleOption === itemOption;
      });
      if (exactOption.length > 0) {
        const candidate = chooseUniqueDraftCandidate(item, exactOption);
        if (!candidate) {
          return unresolved(item, "AMBIGUOUS", "PURCHASE_DRAFT_AMBIGUOUS");
        }
        used.add(candidate.index);
        return matchedDraft(
          item,
          candidate,
          exactOption.length === 1
            ? "PURCHASE_DRAFT_OPTION_EXACT"
            : "PURCHASE_DRAFT_OPTION_DISAMBIGUATED",
        );
      }
    }

    return unresolved(item, "UNMATCHED", "PURCHASE_DRAFT_NOT_FOUND", itemOfferId);
  });

  return summarize(matches);
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
  return summarize(matches);
}

export function matchFreightItemsWithPurchaseDraftFallback(
  items: FreightApplicationItem[],
  draftLines: FreightPurchaseDraftLine[],
  products: LegacySeoInventoryProduct[],
): FreightProductMasterMatchResponse {
  const draft = matchFreightItemsToPurchaseDraft(items, draftLines);
  const productMaster = matchFreightItemsToProductMaster(items, products);
  const productMasterByItemId = new Map(
    productMaster.matches.map((match) => [match.itemId, match] as const),
  );
  const matches = draft.matches.map((match) =>
    match.status === "UNMATCHED"
      ? productMasterByItemId.get(match.itemId) ?? match
      : match,
  );
  return summarize(matches);
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
        origin: match.origin ?? item.origin,
        displayName: match.displayName ?? item.displayName,
        matchedModelNo: match.modelNo,
        matchedModelName: match.modelName,
        matchedProductNameKo: match.modelName,
        matchedBarcode: match.barcode,
        matchedOriginLabel: match.origin ?? item.matchedOriginLabel,
        matchedLabelText: match.displayName ?? item.matchedLabelText,
        matchedImageUrl: match.imageUrl ?? item.matchedImageUrl,
        bundleUnit: match.bundleUnit ?? item.bundleUnit,
        bundleUnitUpdatedAt:
          match.bundleUnitUpdatedAt ?? item.bundleUnitUpdatedAt,
      };
    }),
  };
}
