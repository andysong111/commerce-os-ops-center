import {
  normalizeShoplingBarcode,
  normalizeShoplingOrder,
  type ShoplingRawRow,
} from "@/lib/shopling/shoplingNormalize";
import type { ShoplingDateRange } from "@/lib/shopling/shoplingReadClient";
import type { ProductPlanningSnapshot } from "@/lib/shopling/shoplingLiveAggregation";

const MANAGED_BARCODE = /^[A-Z]{3}\d+-\d+$/;

export type DirectCodeEvidenceChunkOption = {
  optionId: string;
  barcodes: string[];
  productIds: string[];
  observedRows: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
};

export type ProductMasterShoplingSalesDirectCodeEvidenceChunk = {
  range: ShoplingDateRange;
  fetchedRows: number;
  validRows: number;
  directEvidenceRows: number;
  duplicateRows: number;
  options: DirectCodeEvidenceChunkOption[];
};

export type DirectCodeEvidenceClassification =
  | "SAFE_CURRENT_SKU"
  | "AMBIGUOUS_HISTORICAL_BARCODE"
  | "AMBIGUOUS_HISTORICAL_PRODUCT"
  | "MISSING_HISTORICAL_PRODUCT"
  | "LEGACY_BARCODE"
  | "NO_ACTIVE_CURRENT_LISTING"
  | "AMBIGUOUS_CURRENT_UNITS";

export type DirectCodeSafeOption = {
  optionId: string;
  barcode: string;
  productId: string;
  skuId: string;
  unitsPerOrder: number;
  observedRows: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
};

export type ProductMasterShoplingSalesDirectCodeEvidenceReport = {
  generatedAt: string;
  fetchedRows: number;
  validRows: number;
  directEvidenceRows: number;
  duplicateRows: number;
  observedOptionIdCount: number;
  safeOptionIdCount: number;
  classifications: Array<{
    classification: DirectCodeEvidenceClassification;
    count: number;
  }>;
  safeOptions: DirectCodeSafeOption[];
  storedUnmappedSampleCount: number;
  highConfidenceStoredSampleCandidates: number;
  conflictingStoredSampleManagedCodes: number;
};

type CurrentSku = {
  skuId: string;
  barcode: string;
  units: Set<number>;
  activeListingCount: number;
};

type UnmappedSample = {
  optionId?: string | null;
  productId?: string | null;
  managedCode?: string | null;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function validIso(value: unknown) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function managedBarcode(value: unknown) {
  const normalized = normalizeShoplingBarcode(value);
  return MANAGED_BARCODE.test(normalized) ? normalized : "";
}

function rawValue(row: ShoplingRawRow, keys: string[]) {
  for (const key of keys) {
    const direct = row[key];
    if (direct !== undefined && direct !== null && direct !== "") {
      return text(direct);
    }
    const match = Object.keys(row).find(
      (candidate) => candidate.toLowerCase() === key.toLowerCase(),
    );
    if (match && row[match] !== undefined && row[match] !== null) {
      return text(row[match]);
    }
  }
  return "";
}

export function rawManagedCode(row: ShoplingRawRow) {
  for (const key of [
    "optPtnOptCd",
    "opt_ptn_opt_cd",
    "ptn_opt_cd",
    "mall_ptn_opt_cd",
    "mall_opt_cd",
    "optBarcode",
    "opt_barcode",
    "barcode",
    "ptn_goods_cd",
    "mall_ptn_goods_cd",
    "buying_cd",
  ]) {
    const barcode = managedBarcode(rawValue(row, [key]));
    if (barcode) return barcode;
  }
  return "";
}

function validSaleStatus(status: string) {
  const normalized = status.toLowerCase();
  return !["취소", "반품", "환불", "cancel", "return", "refund"].some(
    (keyword) => normalized.includes(keyword),
  );
}

function inDateRange(iso: string, range: ShoplingDateRange) {
  const date = iso.slice(0, 10);
  return date >= range.start && date <= range.end;
}

export function collectProductMasterShoplingSalesDirectCodeEvidenceChunk(
  rows: ShoplingRawRow[],
  range: ShoplingDateRange,
): ProductMasterShoplingSalesDirectCodeEvidenceChunk {
  const seen = new Set<string>();
  const options = new Map<
    string,
    {
      barcodes: Set<string>;
      productIds: Set<string>;
      observedRows: number;
      firstSeenAt: string | null;
      lastSeenAt: string | null;
    }
  >();
  let validRows = 0;
  let directEvidenceRows = 0;
  let duplicateRows = 0;

  for (const raw of rows) {
    const order = normalizeShoplingOrder(raw);
    if (!order.id || seen.has(order.id)) {
      duplicateRows += 1;
      continue;
    }
    seen.add(order.id);

    const orderedAt = validIso(order.orderedAt);
    const quantity = Math.max(0, Math.round(number(order.quantity)));
    if (
      !order.orderNo ||
      !orderedAt ||
      !inDateRange(orderedAt, range) ||
      !validSaleStatus(order.status) ||
      quantity <= 0
    ) {
      continue;
    }
    validRows += 1;

    const optionId = text(order.optionId);
    const directCode = rawManagedCode(raw) || managedBarcode(order.barcode);
    if (!optionId || !directCode) continue;
    directEvidenceRows += 1;

    const current = options.get(optionId) ?? {
      barcodes: new Set<string>(),
      productIds: new Set<string>(),
      observedRows: 0,
      firstSeenAt: null,
      lastSeenAt: null,
    };
    current.barcodes.add(directCode);
    const productId = text(order.productId);
    if (productId) current.productIds.add(productId);
    current.observedRows += 1;
    if (!current.firstSeenAt || orderedAt < current.firstSeenAt) {
      current.firstSeenAt = orderedAt;
    }
    if (!current.lastSeenAt || orderedAt > current.lastSeenAt) {
      current.lastSeenAt = orderedAt;
    }
    options.set(optionId, current);
  }

  return {
    range,
    fetchedRows: rows.length,
    validRows,
    directEvidenceRows,
    duplicateRows,
    options: [...options.entries()]
      .map(([optionId, value]) => ({
        optionId,
        barcodes: [...value.barcodes].sort(),
        productIds: [...value.productIds].sort(),
        observedRows: value.observedRows,
        firstSeenAt: value.firstSeenAt,
        lastSeenAt: value.lastSeenAt,
      }))
      .sort((left, right) => left.optionId.localeCompare(right.optionId)),
  };
}

function buildCurrentSkuIndex(planning: ProductPlanningSnapshot) {
  const index = new Map<string, CurrentSku>();
  for (const product of planning.products ?? []) {
    if (product.skuActive === false) continue;
    const barcode = managedBarcode(product.barcode);
    if (!barcode) continue;
    const activeListings = (product.listings ?? []).filter(
      (listing) => listing.active !== false,
    );
    const units = new Set<number>();
    for (const listing of activeListings) {
      const parsed = Math.max(1, Math.round(number(listing.unitsPerOrder)) || 1);
      units.add(parsed);
    }
    index.set(barcode, {
      skuId: text(product.skuId),
      barcode,
      units,
      activeListingCount: activeListings.length,
    });
  }
  return index;
}

export function combineProductMasterShoplingSalesDirectCodeEvidence(
  chunks: ProductMasterShoplingSalesDirectCodeEvidenceChunk[],
  planning: ProductPlanningSnapshot,
  unmappedSamples: UnmappedSample[],
): ProductMasterShoplingSalesDirectCodeEvidenceReport {
  const merged = new Map<
    string,
    {
      barcodes: Set<string>;
      productIds: Set<string>;
      observedRows: number;
      firstSeenAt: string | null;
      lastSeenAt: string | null;
    }
  >();

  for (const chunk of chunks) {
    for (const option of chunk.options) {
      const current = merged.get(option.optionId) ?? {
        barcodes: new Set<string>(),
        productIds: new Set<string>(),
        observedRows: 0,
        firstSeenAt: null,
        lastSeenAt: null,
      };
      option.barcodes.forEach((barcode) => current.barcodes.add(barcode));
      option.productIds.forEach((productId) => current.productIds.add(productId));
      current.observedRows += option.observedRows;
      if (
        option.firstSeenAt &&
        (!current.firstSeenAt || option.firstSeenAt < current.firstSeenAt)
      ) {
        current.firstSeenAt = option.firstSeenAt;
      }
      if (
        option.lastSeenAt &&
        (!current.lastSeenAt || option.lastSeenAt > current.lastSeenAt)
      ) {
        current.lastSeenAt = option.lastSeenAt;
      }
      merged.set(option.optionId, current);
    }
  }

  const currentByBarcode = buildCurrentSkuIndex(planning);
  const classificationCounts = new Map<DirectCodeEvidenceClassification, number>();
  const safeOptions: DirectCodeSafeOption[] = [];

  function count(classification: DirectCodeEvidenceClassification) {
    classificationCounts.set(
      classification,
      (classificationCounts.get(classification) ?? 0) + 1,
    );
  }

  for (const [optionId, evidence] of merged) {
    if (evidence.barcodes.size !== 1) {
      count("AMBIGUOUS_HISTORICAL_BARCODE");
      continue;
    }
    if (evidence.productIds.size > 1) {
      count("AMBIGUOUS_HISTORICAL_PRODUCT");
      continue;
    }
    if (evidence.productIds.size !== 1) {
      count("MISSING_HISTORICAL_PRODUCT");
      continue;
    }
    const barcode = [...evidence.barcodes][0] ?? "";
    const productId = [...evidence.productIds][0] ?? "";
    const current = currentByBarcode.get(barcode);
    if (!current) {
      count("LEGACY_BARCODE");
      continue;
    }
    if (current.activeListingCount < 1) {
      count("NO_ACTIVE_CURRENT_LISTING");
      continue;
    }
    if (current.units.size !== 1) {
      count("AMBIGUOUS_CURRENT_UNITS");
      continue;
    }
    count("SAFE_CURRENT_SKU");
    safeOptions.push({
      optionId,
      barcode,
      productId,
      skuId: current.skuId,
      unitsPerOrder: [...current.units][0] ?? 1,
      observedRows: evidence.observedRows,
      firstSeenAt: evidence.firstSeenAt,
      lastSeenAt: evidence.lastSeenAt,
    });
  }

  safeOptions.sort(
    (left, right) =>
      right.observedRows - left.observedRows ||
      left.optionId.localeCompare(right.optionId),
  );
  const safeByOptionId = new Map(
    safeOptions.map((option) => [option.optionId, option]),
  );
  let highConfidenceStoredSampleCandidates = 0;
  let conflictingStoredSampleManagedCodes = 0;
  for (const sample of unmappedSamples) {
    const optionId = text(sample.optionId);
    const safe = safeByOptionId.get(optionId);
    if (!safe) continue;
    if (text(sample.productId) !== safe.productId) continue;
    const sampleCode = managedBarcode(sample.managedCode);
    if (sampleCode && sampleCode !== safe.barcode) {
      conflictingStoredSampleManagedCodes += 1;
      continue;
    }
    highConfidenceStoredSampleCandidates += 1;
  }

  return {
    generatedAt: new Date().toISOString(),
    fetchedRows: chunks.reduce((sum, chunk) => sum + chunk.fetchedRows, 0),
    validRows: chunks.reduce((sum, chunk) => sum + chunk.validRows, 0),
    directEvidenceRows: chunks.reduce(
      (sum, chunk) => sum + chunk.directEvidenceRows,
      0,
    ),
    duplicateRows: chunks.reduce((sum, chunk) => sum + chunk.duplicateRows, 0),
    observedOptionIdCount: merged.size,
    safeOptionIdCount: safeOptions.length,
    classifications: [...classificationCounts.entries()]
      .map(([classification, countValue]) => ({
        classification,
        count: countValue,
      }))
      .sort((left, right) => right.count - left.count),
    safeOptions,
    storedUnmappedSampleCount: unmappedSamples.length,
    highConfidenceStoredSampleCandidates,
    conflictingStoredSampleManagedCodes,
  };
}
