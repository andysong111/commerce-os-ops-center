import { createHash } from "node:crypto";
import {
  canonicalShoplingManagedCodeCandidate,
  normalizeShoplingBarcode,
  normalizeShoplingOrder,
  type ShoplingRawRow,
} from "@/lib/shopling/shoplingNormalize";
import type { ShoplingDateRange } from "@/lib/shopling/shoplingReadClient";
import type { ProductPlanningSnapshot } from "@/lib/shopling/shoplingLiveAggregation";
import type { ProductMasterSalesMonthlyRow } from "@/lib/productMasterShoplingSalesBackfillEngine";

const MANAGED_BARCODE = /^[A-Z]{3}\d+-\d+$/;
const MAX_FALLBACK_SAMPLES = 100;

export type HistoricalCatalogOption = {
  goodsKey: string;
  optionId: string;
  barcode: string;
  productName: string;
  optionName: string;
  isActive: boolean;
};

export type HistoricalOptionFallback = {
  optionId: string;
  barcode: string;
  unitsPerOrder: number;
  goodsKeys: string[];
  productNames: string[];
  optionNames: string[];
};

export type HistoricalOptionFallbackIndex = {
  byOptionId: Map<string, HistoricalOptionFallback>;
  fingerprint: string;
  stats: {
    catalogOptionCount: number;
    catalogOptionIdCount: number;
    safeOptionCount: number;
    ambiguousHistoricalBarcodeCount: number;
    legacyBarcodeCount: number;
    ambiguousCurrentUnitsCount: number;
    noCurrentListingCount: number;
  };
};

export type ProductMasterShoplingSalesHistoricalShadowChunk = {
  range: ShoplingDateRange;
  fetchedRows: number;
  acceptedRows: number;
  ignoredRows: number;
  unmappedRows: number;
  duplicateRows: number;
  totalBaseUnits: number;
  totalRevenue: number;
  monthlyRows: ProductMasterSalesMonthlyRow[];
  fallbackResolvedRows: number;
  fallbackBaseUnits: number;
  fallbackRevenue: number;
  fallbackRejectedDirectCodeConflict: number;
  fallbackRejectedGoodsKeyMismatch: number;
  fallbackSamples: Array<{
    orderedAt: string;
    optionId: string;
    productId: string | null;
    mallProductKey: string | null;
    barcode: string;
    unitsPerOrder: number;
    orderQuantity: number;
    baseUnits: number;
    status: string;
  }>;
};

type ListingIdentity = {
  barcode: string;
  unitsPerOrder: number;
};

type PlanningIndex = {
  products: Set<string>;
  byOptionId: Map<string, ListingIdentity>;
  byGoodsKey: Map<string, ListingIdentity>;
  byBarcode: Map<string, ListingIdentity>;
  activeListingCountByBarcode: Map<string, number>;
};

type FallbackResolution = {
  identity: ListingIdentity | null;
  rejectedDirectCodeConflict: boolean;
  rejectedGoodsKeyMismatch: boolean;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function managedBarcode(value: unknown) {
  const barcode = normalizeShoplingBarcode(value);
  return MANAGED_BARCODE.test(barcode) ? barcode : "";
}

function validIso(value: unknown) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function validSaleStatus(status: string) {
  const normalized = status.toLowerCase();
  return !["취소", "반품", "환불", "cancel", "return", "refund"].some(
    (keyword) => normalized.includes(keyword),
  );
}

function safeUnits(value: unknown) {
  const parsed = Math.round(number(value));
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
}

function registerUnique(
  target: Map<string, ListingIdentity>,
  ambiguous: Set<string>,
  key: string,
  value: ListingIdentity,
) {
  if (!key || ambiguous.has(key)) return;
  const existing = target.get(key);
  if (!existing) {
    target.set(key, value);
    return;
  }
  if (
    existing.barcode !== value.barcode ||
    existing.unitsPerOrder !== value.unitsPerOrder
  ) {
    target.delete(key);
    ambiguous.add(key);
  }
}

function buildPlanningIndex(planning: ProductPlanningSnapshot): PlanningIndex {
  const products = new Set<string>();
  const byOptionId = new Map<string, ListingIdentity>();
  const byGoodsKey = new Map<string, ListingIdentity>();
  const ambiguousOptionIds = new Set<string>();
  const ambiguousGoodsKeys = new Set<string>();
  const unitsByBarcode = new Map<string, Set<number>>();
  const activeListingCountByBarcode = new Map<string, number>();

  for (const product of planning.products ?? []) {
    const barcode = managedBarcode(product.barcode);
    if (!barcode || product.skuActive === false) continue;
    products.add(barcode);
    const activeListings = (product.listings ?? []).filter(
      (listing) => listing.active !== false,
    );
    activeListingCountByBarcode.set(barcode, activeListings.length);
    if (!activeListings.length) {
      unitsByBarcode.set(barcode, new Set([1]));
      continue;
    }
    for (const listing of activeListings) {
      const identity = {
        barcode,
        unitsPerOrder: safeUnits(listing.unitsPerOrder),
      };
      registerUnique(
        byOptionId,
        ambiguousOptionIds,
        text(listing.optionId),
        identity,
      );
      registerUnique(
        byGoodsKey,
        ambiguousGoodsKeys,
        text(listing.goodsKey),
        identity,
      );
      const units = unitsByBarcode.get(barcode) ?? new Set<number>();
      units.add(identity.unitsPerOrder);
      unitsByBarcode.set(barcode, units);
    }
  }

  const byBarcode = new Map<string, ListingIdentity>();
  for (const [barcode, units] of unitsByBarcode) {
    if (units.size !== 1) continue;
    byBarcode.set(barcode, {
      barcode,
      unitsPerOrder: [...units][0] ?? 1,
    });
  }

  return {
    products,
    byOptionId,
    byGoodsKey,
    byBarcode,
    activeListingCountByBarcode,
  };
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

function rawManagedCodeFrom(row: ShoplingRawRow, keys: string[]) {
  for (const key of keys) {
    const barcode = managedBarcode(
      canonicalShoplingManagedCodeCandidate(rawValue(row, [key])),
    );
    if (barcode) return barcode;
  }
  return "";
}

function rawOptionManagedCode(row: ShoplingRawRow) {
  return rawManagedCodeFrom(row, [
    "optPtnOptCd",
    "opt_ptn_opt_cd",
    "ptn_opt_cd",
    "mall_ptn_opt_cd",
    "mall_opt_cd",
    "optBarcode",
    "opt_barcode",
    "barcode",
  ]);
}

function rawPartnerManagedCode(row: ShoplingRawRow) {
  return rawManagedCodeFrom(row, [
    "ptn_goods_cd",
    "mall_ptn_goods_cd",
    "buying_cd",
  ]);
}

function rawManagedCode(row: ShoplingRawRow) {
  return rawOptionManagedCode(row) || rawPartnerManagedCode(row);
}

function resolveCurrentIdentity(
  index: PlanningIndex,
  order: ReturnType<typeof normalizeShoplingOrder>,
  raw: ShoplingRawRow,
) {
  const optionId = text(order.optionId);
  const optionIdentity = optionId ? index.byOptionId.get(optionId) ?? null : null;
  const optionCode = rawOptionManagedCode(raw) || managedBarcode(order.barcode);
  if (optionCode) {
    if (optionIdentity?.barcode === optionCode) return optionIdentity;
    return index.byBarcode.get(optionCode) ?? null;
  }
  if (optionIdentity) return optionIdentity;

  const partnerCode = rawPartnerManagedCode(raw);
  if (partnerCode) {
    return index.byBarcode.get(partnerCode) ?? null;
  }

  for (const key of [text(order.productId), text(order.mallProductKey)]) {
    if (key && index.byGoodsKey.has(key)) return index.byGoodsKey.get(key)!;
  }
  return null;
}

function resolveHistoricalFallback(
  fallback: HistoricalOptionFallbackIndex,
  order: ReturnType<typeof normalizeShoplingOrder>,
  raw: ShoplingRawRow,
): FallbackResolution {
  const optionId = text(order.optionId);
  const candidate = optionId ? fallback.byOptionId.get(optionId) : undefined;
  if (!candidate) {
    return {
      identity: null,
      rejectedDirectCodeConflict: false,
      rejectedGoodsKeyMismatch: false,
    };
  }

  const directCode = rawManagedCode(raw) || managedBarcode(order.barcode);
  if (directCode && directCode !== candidate.barcode) {
    return {
      identity: null,
      rejectedDirectCodeConflict: true,
      rejectedGoodsKeyMismatch: false,
    };
  }

  const orderKeys = [text(order.productId), text(order.mallProductKey)].filter(
    Boolean,
  );
  const goodsKeyMatch = orderKeys.some((key) => candidate.goodsKeys.includes(key));
  if (!goodsKeyMatch) {
    return {
      identity: null,
      rejectedDirectCodeConflict: false,
      rejectedGoodsKeyMismatch: true,
    };
  }

  return {
    identity: {
      barcode: candidate.barcode,
      unitsPerOrder: candidate.unitsPerOrder,
    },
    rejectedDirectCodeConflict: false,
    rejectedGoodsKeyMismatch: false,
  };
}

function inDateRange(iso: string, range: ShoplingDateRange) {
  const date = iso.slice(0, 10);
  return date >= range.start && date <= range.end;
}

function monthlyId(barcode: string, month: string) {
  return `shopling-sales-v1:${barcode}:${month}`;
}

export function buildHistoricalOptionFallbackIndex(
  planning: ProductPlanningSnapshot,
  catalogOptions: HistoricalCatalogOption[],
): HistoricalOptionFallbackIndex {
  const planningIndex = buildPlanningIndex(planning);
  const historical = new Map<
    string,
    {
      barcodes: Set<string>;
      goodsKeys: Set<string>;
      productNames: Set<string>;
      optionNames: Set<string>;
    }
  >();

  for (const option of catalogOptions) {
    const optionId = text(option.optionId);
    const barcode = managedBarcode(option.barcode);
    if (!optionId || !barcode) continue;
    const current = historical.get(optionId) ?? {
      barcodes: new Set<string>(),
      goodsKeys: new Set<string>(),
      productNames: new Set<string>(),
      optionNames: new Set<string>(),
    };
    current.barcodes.add(barcode);
    if (text(option.goodsKey)) current.goodsKeys.add(text(option.goodsKey));
    if (text(option.productName)) current.productNames.add(text(option.productName));
    if (text(option.optionName)) current.optionNames.add(text(option.optionName));
    historical.set(optionId, current);
  }

  const byOptionId = new Map<string, HistoricalOptionFallback>();
  let ambiguousHistoricalBarcodeCount = 0;
  let legacyBarcodeCount = 0;
  let ambiguousCurrentUnitsCount = 0;
  let noCurrentListingCount = 0;

  for (const [optionId, history] of historical) {
    if (history.barcodes.size !== 1) {
      ambiguousHistoricalBarcodeCount += 1;
      continue;
    }
    const barcode = [...history.barcodes][0] ?? "";
    if (!planningIndex.products.has(barcode)) {
      legacyBarcodeCount += 1;
      continue;
    }
    if ((planningIndex.activeListingCountByBarcode.get(barcode) ?? 0) < 1) {
      noCurrentListingCount += 1;
      continue;
    }
    const current = planningIndex.byBarcode.get(barcode);
    if (!current) {
      ambiguousCurrentUnitsCount += 1;
      continue;
    }
    if (!history.goodsKeys.size) continue;
    byOptionId.set(optionId, {
      optionId,
      barcode,
      unitsPerOrder: current.unitsPerOrder,
      goodsKeys: [...history.goodsKeys].sort(),
      productNames: [...history.productNames].sort(),
      optionNames: [...history.optionNames].sort(),
    });
  }

  const fingerprintSource = [...byOptionId.values()]
    .map((row) => ({
      optionId: row.optionId,
      barcode: row.barcode,
      unitsPerOrder: row.unitsPerOrder,
      goodsKeys: row.goodsKeys,
    }))
    .sort((left, right) => left.optionId.localeCompare(right.optionId));
  const fingerprint = `sha256:${createHash("sha256")
    .update(JSON.stringify(fingerprintSource))
    .digest("hex")}`;

  return {
    byOptionId,
    fingerprint,
    stats: {
      catalogOptionCount: catalogOptions.length,
      catalogOptionIdCount: historical.size,
      safeOptionCount: byOptionId.size,
      ambiguousHistoricalBarcodeCount,
      legacyBarcodeCount,
      ambiguousCurrentUnitsCount,
      noCurrentListingCount,
    },
  };
}

export function aggregateProductMasterShoplingSalesHistoricalShadowChunk(
  rows: ShoplingRawRow[],
  planning: ProductPlanningSnapshot,
  range: ShoplingDateRange,
  fallback: HistoricalOptionFallbackIndex,
): ProductMasterShoplingSalesHistoricalShadowChunk {
  const index = buildPlanningIndex(planning);
  const seen = new Set<string>();
  const monthly = new Map<
    string,
    {
      barcode: string;
      month: string;
      quantity: number;
      revenue: number;
      lastSaleAt: string | null;
    }
  >();
  const fallbackSamples: ProductMasterShoplingSalesHistoricalShadowChunk["fallbackSamples"] = [];
  let acceptedRows = 0;
  let ignoredRows = 0;
  let unmappedRows = 0;
  let duplicateRows = 0;
  let fallbackResolvedRows = 0;
  let fallbackBaseUnits = 0;
  let fallbackRevenue = 0;
  let fallbackRejectedDirectCodeConflict = 0;
  let fallbackRejectedGoodsKeyMismatch = 0;

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
      ignoredRows += 1;
      continue;
    }

    let identity = resolveCurrentIdentity(index, order, raw);
    let usedFallback = false;
    if (!identity) {
      const historical = resolveHistoricalFallback(fallback, order, raw);
      if (historical.rejectedDirectCodeConflict) {
        fallbackRejectedDirectCodeConflict += 1;
      }
      if (historical.rejectedGoodsKeyMismatch) {
        fallbackRejectedGoodsKeyMismatch += 1;
      }
      if (historical.identity) {
        identity = historical.identity;
        usedFallback = true;
      }
    }

    if (!identity || !index.products.has(identity.barcode)) {
      unmappedRows += 1;
      continue;
    }

    acceptedRows += 1;
    const paidAmount = Math.max(0, number(order.paidAmount));
    const baseUnits = quantity * identity.unitsPerOrder;
    if (usedFallback) {
      fallbackResolvedRows += 1;
      fallbackBaseUnits += baseUnits;
      fallbackRevenue += paidAmount;
      if (fallbackSamples.length < MAX_FALLBACK_SAMPLES) {
        fallbackSamples.push({
          orderedAt,
          optionId: text(order.optionId),
          productId: text(order.productId) || null,
          mallProductKey: text(order.mallProductKey) || null,
          barcode: identity.barcode,
          unitsPerOrder: identity.unitsPerOrder,
          orderQuantity: quantity,
          baseUnits,
          status: order.status,
        });
      }
    }

    const month = orderedAt.slice(0, 7);
    const key = `${identity.barcode}\u0000${month}`;
    const current = monthly.get(key) ?? {
      barcode: identity.barcode,
      month,
      quantity: 0,
      revenue: 0,
      lastSaleAt: null,
    };
    current.quantity += baseUnits;
    current.revenue += paidAmount;
    if (!current.lastSaleAt || orderedAt > current.lastSaleAt) {
      current.lastSaleAt = orderedAt;
    }
    monthly.set(key, current);
  }

  const monthlyRows = [...monthly.values()]
    .map((row) => ({
      id: monthlyId(row.barcode, row.month),
      barcode: row.barcode,
      month: row.month,
      quantity: row.quantity,
      revenue: Math.round(row.revenue),
      lastSaleAt: row.lastSaleAt,
      source: "shopling_orders_24m_v1" as const,
    }))
    .sort((left, right) =>
      `${left.month}\u0000${left.barcode}`.localeCompare(
        `${right.month}\u0000${right.barcode}`,
      ),
    );

  return {
    range,
    fetchedRows: rows.length,
    acceptedRows,
    ignoredRows,
    unmappedRows,
    duplicateRows,
    totalBaseUnits: monthlyRows.reduce((sum, row) => sum + row.quantity, 0),
    totalRevenue: monthlyRows.reduce((sum, row) => sum + row.revenue, 0),
    monthlyRows,
    fallbackResolvedRows,
    fallbackBaseUnits,
    fallbackRevenue: Math.round(fallbackRevenue),
    fallbackRejectedDirectCodeConflict,
    fallbackRejectedGoodsKeyMismatch,
    fallbackSamples,
  };
}

export function combineProductMasterShoplingSalesHistoricalShadowChunks(
  chunks: ProductMasterShoplingSalesHistoricalShadowChunk[],
) {
  const monthly = new Map<string, ProductMasterSalesMonthlyRow>();
  const fallbackSamples: ProductMasterShoplingSalesHistoricalShadowChunk["fallbackSamples"] = [];

  for (const chunk of chunks) {
    for (const row of chunk.monthlyRows) {
      const key = `${row.barcode}\u0000${row.month}`;
      const current = monthly.get(key);
      if (!current) {
        monthly.set(key, { ...row });
      } else {
        current.quantity += row.quantity;
        current.revenue += row.revenue;
        if (
          row.lastSaleAt &&
          (!current.lastSaleAt || row.lastSaleAt > current.lastSaleAt)
        ) {
          current.lastSaleAt = row.lastSaleAt;
        }
      }
    }
    for (const sample of chunk.fallbackSamples) {
      if (fallbackSamples.length >= MAX_FALLBACK_SAMPLES) break;
      fallbackSamples.push(sample);
    }
  }

  const rows = [...monthly.values()].sort((left, right) =>
    `${left.month}\u0000${left.barcode}`.localeCompare(
      `${right.month}\u0000${right.barcode}`,
    ),
  );

  return {
    fetchedRows: chunks.reduce((sum, chunk) => sum + chunk.fetchedRows, 0),
    acceptedRows: chunks.reduce((sum, chunk) => sum + chunk.acceptedRows, 0),
    ignoredRows: chunks.reduce((sum, chunk) => sum + chunk.ignoredRows, 0),
    unmappedRows: chunks.reduce((sum, chunk) => sum + chunk.unmappedRows, 0),
    duplicateRows: chunks.reduce((sum, chunk) => sum + chunk.duplicateRows, 0),
    totalBaseUnits: rows.reduce((sum, row) => sum + row.quantity, 0),
    totalRevenue: rows.reduce((sum, row) => sum + row.revenue, 0),
    monthlyRowCount: rows.length,
    barcodeCount: new Set(rows.map((row) => row.barcode)).size,
    months: [...new Set(rows.map((row) => row.month))].sort(),
    rows,
    fallbackResolvedRows: chunks.reduce(
      (sum, chunk) => sum + chunk.fallbackResolvedRows,
      0,
    ),
    fallbackBaseUnits: chunks.reduce(
      (sum, chunk) => sum + chunk.fallbackBaseUnits,
      0,
    ),
    fallbackRevenue: chunks.reduce(
      (sum, chunk) => sum + chunk.fallbackRevenue,
      0,
    ),
    fallbackRejectedDirectCodeConflict: chunks.reduce(
      (sum, chunk) => sum + chunk.fallbackRejectedDirectCodeConflict,
      0,
    ),
    fallbackRejectedGoodsKeyMismatch: chunks.reduce(
      (sum, chunk) => sum + chunk.fallbackRejectedGoodsKeyMismatch,
      0,
    ),
    fallbackSamples,
  };
}
