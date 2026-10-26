import {
  normalizeShoplingBarcode,
  normalizeShoplingOrder,
  type ShoplingRawRow,
} from "@/lib/shopling/shoplingNormalize";
import type { ShoplingDateRange } from "@/lib/shopling/shoplingReadClient";
import type { ProductPlanningSnapshot } from "@/lib/shopling/shoplingLiveAggregation";

export const PRODUCT_MASTER_SALES_EVENT_FORMAT = "commerce-os-sales-events-v1";
export const PRODUCT_MASTER_SALES_EVENT_SOURCE = "shopling_orders_event_v1";
export const PRODUCT_MASTER_SALES_EVENT_ANALYSIS_DAYS = 360;
const DAY_MS = 24 * 60 * 60 * 1000;

export type ProductMasterSalesEventRow = {
  externalId: string;
  barcode: string;
  occurredAt: string;
  quantity: number;
  revenue: number;
  validSale: boolean;
  syncedAt: string;
};

export type ProductMasterShoplingSalesEventChunk = {
  range: ShoplingDateRange;
  fetchedRows: number;
  eventRows: number;
  validRows: number;
  tombstoneRows: number;
  ignoredRows: number;
  unmappedRows: number;
  duplicateRows: number;
  totalBaseUnits: number;
  totalRevenue: number;
  events: ProductMasterSalesEventRow[];
  unmappedSamples: Array<{
    externalId: string;
    orderNo: string;
    orderedAt: string;
    optionId: string | null;
    productId: string | null;
    mallProductKey: string | null;
    managedCode: string | null;
    status: string;
  }>;
};

export type ProductMasterSalesEventAggregationOptions = {
  syncedAt?: string;
  analysisAsOf?: string;
};

type ListingIdentity = {
  barcode: string;
  unitsPerOrder: number;
};

type HistoricalBarcodeEvidence = {
  barcode: string;
  ownUnits: Set<number>;
};

type PlanningIndex = {
  products: Set<string>;
  byOptionId: Map<string, ListingIdentity>;
  byGoodsKey: Map<string, ListingIdentity>;
  byBarcode: Map<string, ListingIdentity>;
  historicalByBarcode: Map<string, HistoricalBarcodeEvidence>;
  unitsByGoodsKey: Map<string, Set<number>>;
  managedOptionIds: Set<string>;
};

const MANAGED_BARCODE = /^B[A-Z]{2}\d+-\d+$/;
const STRUCTURED_LEGACY_CODE = /^[A-Z]{3}\d+-\d+$/;
const MAX_UNMAPPED_SAMPLES = 50;

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizedStructuredCode(value: unknown) {
  const barcode = normalizeShoplingBarcode(value);
  return STRUCTURED_LEGACY_CODE.test(barcode) ? barcode : "";
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

function addUnits(target: Map<string, Set<number>>, key: string, units: number) {
  if (!key) return;
  const values = target.get(key) ?? new Set<number>();
  values.add(units);
  target.set(key, values);
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
  const activeUnitsByBarcode = new Map<string, Set<number>>();
  const unitsByGoodsKey = new Map<string, Set<number>>();
  const managedOptionIds = new Set<string>();
  const barcodeOwnerCount = new Map<string, number>();
  const historicalCandidates = new Map<string, HistoricalBarcodeEvidence>();

  for (const product of planning.products ?? []) {
    const barcode = managedBarcode(product.barcode);
    if (!barcode) continue;
    products.add(barcode);
    barcodeOwnerCount.set(barcode, (barcodeOwnerCount.get(barcode) ?? 0) + 1);
    const allListings = product.listings ?? [];

    if (product.skuActive === false) {
      historicalCandidates.set(barcode, {
        barcode,
        ownUnits: new Set(allListings.map((listing) => safeUnits(listing.unitsPerOrder))),
      });
      continue;
    }

    const activeListings = allListings.filter((listing) => listing.active !== false);
    if (!activeListings.length) {
      activeUnitsByBarcode.set(barcode, new Set([1]));
      continue;
    }
    for (const listing of activeListings) {
      const optionId = text(listing.optionId);
      const goodsKey = text(listing.goodsKey);
      const unitsPerOrder = safeUnits(listing.unitsPerOrder);
      if (optionId) managedOptionIds.add(optionId);
      const identity = { barcode, unitsPerOrder };
      registerUnique(byOptionId, ambiguousOptionIds, optionId, identity);
      registerUnique(byGoodsKey, ambiguousGoodsKeys, goodsKey, identity);
      addUnits(unitsByGoodsKey, goodsKey, unitsPerOrder);
      addUnits(activeUnitsByBarcode, barcode, unitsPerOrder);
    }
  }

  const ambiguousBarcodes = new Set(
    [...barcodeOwnerCount.entries()]
      .filter(([, count]) => count !== 1)
      .map(([barcode]) => barcode),
  );
  for (const barcode of ambiguousBarcodes) products.delete(barcode);
  for (const [key, identity] of [...byOptionId.entries()]) {
    if (ambiguousBarcodes.has(identity.barcode)) byOptionId.delete(key);
  }
  for (const [key, identity] of [...byGoodsKey.entries()]) {
    if (ambiguousBarcodes.has(identity.barcode)) byGoodsKey.delete(key);
  }

  const byBarcode = new Map<string, ListingIdentity>();
  for (const [barcode, units] of activeUnitsByBarcode) {
    if (ambiguousBarcodes.has(barcode) || units.size !== 1) continue;
    byBarcode.set(barcode, { barcode, unitsPerOrder: [...units][0] ?? 1 });
  }

  const historicalByBarcode = new Map<string, HistoricalBarcodeEvidence>();
  for (const [barcode, evidence] of historicalCandidates) {
    if (ambiguousBarcodes.has(barcode)) continue;
    historicalByBarcode.set(barcode, evidence);
  }

  return {
    products,
    byOptionId,
    byGoodsKey,
    byBarcode,
    historicalByBarcode,
    unitsByGoodsKey,
    managedOptionIds,
  };
}

function rawValue(row: ShoplingRawRow, keys: string[]) {
  for (const key of keys) {
    const direct = row[key];
    if (direct !== undefined && direct !== null && direct !== "") return text(direct);
    const match = Object.keys(row).find(
      (candidate) => candidate.toLowerCase() === key.toLowerCase(),
    );
    if (match && row[match] !== undefined && row[match] !== null) return text(row[match]);
  }
  return "";
}

function firstStructuredCode(row: ShoplingRawRow, keys: string[]) {
  for (const key of keys) {
    const code = normalizedStructuredCode(rawValue(row, [key]));
    if (code) return code;
  }
  return "";
}

function rawOptionStructuredCode(row: ShoplingRawRow) {
  return firstStructuredCode(row, [
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

function rawPartnerStructuredCode(row: ShoplingRawRow) {
  return firstStructuredCode(row, [
    "ptn_goods_cd",
    "mall_ptn_goods_cd",
    "buying_cd",
  ]);
}

function rawManagedCode(row: ShoplingRawRow) {
  return managedBarcode(rawOptionStructuredCode(row) || rawPartnerStructuredCode(row));
}

function isManagedSalesScope(
  index: PlanningIndex,
  order: ReturnType<typeof normalizeShoplingOrder>,
  raw: ShoplingRawRow,
) {
  const optionCode = rawOptionStructuredCode(raw) || normalizedStructuredCode(order.barcode);
  if (optionCode) return Boolean(managedBarcode(optionCode));
  const optionId = text(order.optionId);
  if (optionId && index.managedOptionIds.has(optionId)) return true;
  const partnerCode = rawPartnerStructuredCode(raw);
  if (partnerCode) return Boolean(managedBarcode(partnerCode));
  for (const key of [text(order.productId), text(order.mallProductKey)]) {
    if (key && index.byGoodsKey.has(key)) return true;
  }
  return false;
}

function historicalDirectIdentity(
  index: PlanningIndex,
  directCode: string,
  order: ReturnType<typeof normalizeShoplingOrder>,
): ListingIdentity | null {
  const evidence = index.historicalByBarcode.get(directCode);
  if (!evidence) return null;
  if (evidence.ownUnits.size === 1) {
    return { barcode: directCode, unitsPerOrder: [...evidence.ownUnits][0] ?? 1 };
  }
  if (evidence.ownUnits.size > 1) return null;

  const compatibleUnits = new Set<number>();
  let foundEvidence = false;
  for (const key of new Set([text(order.productId), text(order.mallProductKey)])) {
    if (!key) continue;
    const units = index.unitsByGoodsKey.get(key);
    if (!units?.size) continue;
    foundEvidence = true;
    for (const value of units) compatibleUnits.add(value);
  }
  if (!foundEvidence || compatibleUnits.size !== 1) return null;
  return { barcode: directCode, unitsPerOrder: [...compatibleUnits][0] ?? 1 };
}

function resolveIdentity(
  index: PlanningIndex,
  order: ReturnType<typeof normalizeShoplingOrder>,
  raw: ShoplingRawRow,
) {
  const optionId = text(order.optionId);
  const optionIdentity = optionId ? index.byOptionId.get(optionId) ?? null : null;
  const optionBarcode = managedBarcode(rawOptionStructuredCode(raw) || order.barcode);
  if (optionBarcode) {
    if (optionIdentity?.barcode === optionBarcode) return optionIdentity;
    const currentDirect = index.byBarcode.get(optionBarcode);
    if (currentDirect) return currentDirect;
    const historicalDirect = historicalDirectIdentity(index, optionBarcode, order);
    if (historicalDirect) return historicalDirect;
    for (const key of [text(order.productId), text(order.mallProductKey)]) {
      const identity = key ? index.byGoodsKey.get(key) : null;
      if (identity?.barcode === optionBarcode) return identity;
    }
    return null;
  }
  if (optionIdentity) return optionIdentity;
  const partnerCode = managedBarcode(rawPartnerStructuredCode(raw));
  if (partnerCode) {
    const currentDirect = index.byBarcode.get(partnerCode);
    if (currentDirect) return currentDirect;
    const historicalDirect = historicalDirectIdentity(index, partnerCode, order);
    if (historicalDirect) return historicalDirect;
    for (const key of [text(order.productId), text(order.mallProductKey)]) {
      const identity = key ? index.byGoodsKey.get(key) : null;
      if (identity?.barcode === partnerCode) return identity;
    }
    return null;
  }
  for (const key of [text(order.productId), text(order.mallProductKey)]) {
    if (key && index.byGoodsKey.has(key)) return index.byGoodsKey.get(key)!;
  }
  return null;
}

function insideGlobalAnalysisWindow(occurredAt: string, analysisAsOf?: string) {
  if (!analysisAsOf) return true;
  const occurredMs = Date.parse(occurredAt);
  const endMs = Date.parse(analysisAsOf);
  if (!Number.isFinite(occurredMs) || !Number.isFinite(endMs)) return false;
  const startMs = endMs - PRODUCT_MASTER_SALES_EVENT_ANALYSIS_DAYS * DAY_MS;
  return occurredMs >= startMs && occurredMs < endMs;
}

/**
 * `range` is the Shopling source-fetch partition, not an order-date contract.
 * Shopling can return a row in a later source range after the row was updated;
 * the canonical ledger must preserve the row by its actual mall_ord_dt and only
 * apply the one pinned 360-day analysis window. Cross-range duplicates are
 * collapsed later by externalId in combineProductMasterShoplingSalesEventChunks.
 */
export function aggregateProductMasterShoplingSalesEventChunk(
  rows: ShoplingRawRow[],
  planning: ProductPlanningSnapshot,
  range: ShoplingDateRange,
  options: ProductMasterSalesEventAggregationOptions = {},
): ProductMasterShoplingSalesEventChunk {
  const index = buildPlanningIndex(planning);
  const seen = new Set<string>();
  const events: ProductMasterSalesEventRow[] = [];
  const unmappedSamples: ProductMasterShoplingSalesEventChunk["unmappedSamples"] = [];
  let ignoredRows = 0;
  let unmappedRows = 0;
  let duplicateRows = 0;
  const syncedAt = options.syncedAt ?? new Date().toISOString();

  for (const raw of rows) {
    const order = normalizeShoplingOrder(raw);
    if (!order.id || seen.has(order.id)) {
      duplicateRows += 1;
      continue;
    }
    seen.add(order.id);
    const orderedAt = validIso(order.orderedAt);
    if (!order.orderNo || !orderedAt) {
      ignoredRows += 1;
      continue;
    }
    if (!insideGlobalAnalysisWindow(orderedAt, options.analysisAsOf)) {
      ignoredRows += 1;
      continue;
    }
    if (!isManagedSalesScope(index, order, raw)) {
      ignoredRows += 1;
      continue;
    }

    const identity = resolveIdentity(index, order, raw);
    if (!identity || !index.products.has(identity.barcode)) {
      unmappedRows += 1;
      if (unmappedSamples.length < MAX_UNMAPPED_SAMPLES) {
        unmappedSamples.push({
          externalId: order.id,
          orderNo: order.orderNo,
          orderedAt,
          optionId: order.optionId || null,
          productId: order.productId,
          mallProductKey: order.mallProductKey,
          managedCode: rawManagedCode(raw) || null,
          status: order.status,
        });
      }
      continue;
    }

    const quantity = Math.max(0, Math.round(number(order.quantity))) * identity.unitsPerOrder;
    const revenue = Math.max(0, Math.round(number(order.paidAmount)));
    const validSale = validSaleStatus(order.status) && quantity > 0;
    events.push({
      externalId: order.id,
      barcode: identity.barcode,
      occurredAt: orderedAt,
      quantity,
      revenue,
      validSale,
      syncedAt,
    });
  }

  events.sort((left, right) =>
    `${left.occurredAt}\u0000${left.externalId}`.localeCompare(
      `${right.occurredAt}\u0000${right.externalId}`,
    ),
  );
  const validRows = events.filter((row) => row.validSale);
  return {
    range,
    fetchedRows: rows.length,
    eventRows: events.length,
    validRows: validRows.length,
    tombstoneRows: events.length - validRows.length,
    ignoredRows,
    unmappedRows,
    duplicateRows,
    totalBaseUnits: validRows.reduce((sum, row) => sum + row.quantity, 0),
    totalRevenue: validRows.reduce((sum, row) => sum + row.revenue, 0),
    events,
    unmappedSamples,
  };
}

export function combineProductMasterShoplingSalesEventChunks(
  chunks: ProductMasterShoplingSalesEventChunk[],
) {
  const byExternalId = new Map<string, ProductMasterSalesEventRow>();
  const conflicts: string[] = [];
  for (const chunk of chunks) {
    for (const event of chunk.events) {
      const prior = byExternalId.get(event.externalId);
      if (!prior) {
        byExternalId.set(event.externalId, event);
        continue;
      }
      if (prior.barcode !== event.barcode || prior.occurredAt !== event.occurredAt) {
        conflicts.push(event.externalId);
        continue;
      }
      if (event.syncedAt >= prior.syncedAt) byExternalId.set(event.externalId, event);
    }
  }
  const events = [...byExternalId.values()].sort((left, right) =>
    `${left.occurredAt}\u0000${left.externalId}`.localeCompare(
      `${right.occurredAt}\u0000${right.externalId}`,
    ),
  );
  const valid = events.filter((row) => row.validSale);
  return {
    fetchedRows: chunks.reduce((sum, chunk) => sum + chunk.fetchedRows, 0),
    eventRows: events.length,
    validRows: valid.length,
    tombstoneRows: events.length - valid.length,
    ignoredRows: chunks.reduce((sum, chunk) => sum + chunk.ignoredRows, 0),
    unmappedRows: chunks.reduce((sum, chunk) => sum + chunk.unmappedRows, 0),
    duplicateRows: chunks.reduce((sum, chunk) => sum + chunk.duplicateRows, 0),
    totalBaseUnits: valid.reduce((sum, row) => sum + row.quantity, 0),
    totalRevenue: valid.reduce((sum, row) => sum + row.revenue, 0),
    conflictExternalIds: [...new Set(conflicts)].sort(),
    events,
  };
}
