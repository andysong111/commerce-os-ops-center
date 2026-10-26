import {
  canonicalShoplingManagedCodeCandidate,
  normalizeShoplingBarcode,
  normalizeShoplingOrder,
  type ShoplingRawRow,
} from "@/lib/shopling/shoplingNormalize";
import { resolveShoplingDirectPackUnits } from "@/lib/shopling/shoplingDirectPackEvidence";
import type { ShoplingDateRange } from "@/lib/shopling/shoplingReadClient";
import type { ProductPlanningSnapshot } from "@/lib/shopling/shoplingLiveAggregation";

export type ProductMasterSalesMonthlyRow = {
  id: string;
  barcode: string;
  month: string;
  quantity: number;
  revenue: number;
  lastSaleAt: string | null;
  source: "shopling_orders_24m_v1";
};

export type ProductMasterSalesUnmappedSample = {
  orderLineId: string;
  orderNo: string;
  orderedAt: string;
  optionId: string | null;
  productId: string | null;
  mallProductKey: string | null;
  managedCode: string | null;
  status: string;
};

export type ProductMasterShoplingSalesChunk = {
  range: ShoplingDateRange;
  fetchedRows: number;
  acceptedRows: number;
  ignoredRows: number;
  unmappedRows: number;
  duplicateRows: number;
  totalBaseUnits: number;
  totalRevenue: number;
  monthlyRows: ProductMasterSalesMonthlyRow[];
  unmappedSamples: ProductMasterSalesUnmappedSample[];
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
  unitsByBarcode: Map<string, Set<number>>;
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
      registerUnique(
        byOptionId,
        ambiguousOptionIds,
        optionId,
        identity,
      );
      registerUnique(
        byGoodsKey,
        ambiguousGoodsKeys,
        goodsKey,
        identity,
      );
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
  for (const barcode of ambiguousBarcodes) activeUnitsByBarcode.delete(barcode);
  for (const [key, identity] of [...byOptionId.entries()]) {
    if (ambiguousBarcodes.has(identity.barcode)) byOptionId.delete(key);
  }
  for (const [key, identity] of [...byGoodsKey.entries()]) {
    if (ambiguousBarcodes.has(identity.barcode)) byGoodsKey.delete(key);
  }

  const byBarcode = new Map<string, ListingIdentity>();
  for (const [barcode, units] of activeUnitsByBarcode) {
    if (ambiguousBarcodes.has(barcode) || units.size !== 1) continue;
    byBarcode.set(barcode, {
      barcode,
      unitsPerOrder: [...units][0] ?? 1,
    });
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
    unitsByBarcode: activeUnitsByBarcode,
    historicalByBarcode,
    unitsByGoodsKey,
    managedOptionIds,
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

function firstStructuredCode(row: ShoplingRawRow, keys: string[]) {
  for (const key of keys) {
    const code = canonicalShoplingManagedCodeCandidate(rawValue(row, [key]));
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
  return managedBarcode(
    rawOptionStructuredCode(row) || rawPartnerStructuredCode(row),
  );
}

function isManagedSalesScope(
  index: PlanningIndex,
  order: ReturnType<typeof normalizeShoplingOrder>,
  raw: ShoplingRawRow,
) {
  // The option barcode is the strongest evidence for whether the historical
  // order belonged to the warehouse-managed B-code catalog. Product-level
  // partner codes must not override an exact managed option identity.
  const optionCode =
    rawOptionStructuredCode(raw) || normalizedStructuredCode(order.barcode);
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
    return {
      barcode: directCode,
      unitsPerOrder: [...evidence.ownUnits][0] ?? 1,
    };
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
  return {
    barcode: directCode,
    unitsPerOrder: [...compatibleUnits][0] ?? 1,
  };
}

function resolveIdentity(
  index: PlanningIndex,
  order: ReturnType<typeof normalizeShoplingOrder>,
  raw: ShoplingRawRow,
) {
  const optionId = text(order.optionId);
  const optionIdentity = optionId ? index.byOptionId.get(optionId) ?? null : null;
  const optionBarcode = managedBarcode(
    rawOptionStructuredCode(raw) || order.barcode,
  );

  // A real option barcode is historical SKU evidence. When it exists we keep
  // the sale on that B-code even if the same optionId is currently attached to
  // another SKU after later catalog edits. Pack size must still be deterministic.
  if (optionBarcode) {
    if (optionIdentity?.barcode === optionBarcode) return optionIdentity;

    const currentDirect = index.byBarcode.get(optionBarcode);
    if (currentDirect) return currentDirect;
    const evidencedUnits = resolveShoplingDirectPackUnits(
      raw,
      index.unitsByBarcode.get(optionBarcode) ?? [],
    );
    if (evidencedUnits) {
      return { barcode: optionBarcode, unitsPerOrder: evidencedUnits };
    }

    const historicalDirect = historicalDirectIdentity(
      index,
      optionBarcode,
      order,
    );
    if (historicalDirect) return historicalDirect;

    for (const key of [text(order.productId), text(order.mallProductKey)]) {
      const identity = key ? index.byGoodsKey.get(key) : null;
      if (identity?.barcode === optionBarcode) return identity;
    }
    return null;
  }

  // Exact current option identity is stronger than product-level partner codes
  // such as ptn_goods_cd. Those fields frequently carry one representative
  // product code across several options and must not create false conflicts.
  if (optionIdentity) return optionIdentity;

  const partnerCode = managedBarcode(rawPartnerStructuredCode(raw));
  if (partnerCode) {
    const currentDirect = index.byBarcode.get(partnerCode);
    if (currentDirect) return currentDirect;
    const evidencedUnits = resolveShoplingDirectPackUnits(
      raw,
      index.unitsByBarcode.get(partnerCode) ?? [],
    );
    if (evidencedUnits) {
      return { barcode: partnerCode, unitsPerOrder: evidencedUnits };
    }

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

function inDateRange(iso: string, range: ShoplingDateRange) {
  const date = iso.slice(0, 10);
  return date >= range.start && date <= range.end;
}

function monthlyId(barcode: string, month: string) {
  return `shopling-sales-v1:${barcode}:${month}`;
}

export function aggregateProductMasterShoplingSalesChunk(
  rows: ShoplingRawRow[],
  planning: ProductPlanningSnapshot,
  range: ShoplingDateRange,
): ProductMasterShoplingSalesChunk {
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
  const unmappedSamples: ProductMasterSalesUnmappedSample[] = [];
  let acceptedRows = 0;
  let ignoredRows = 0;
  let unmappedRows = 0;
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
      ignoredRows += 1;
      continue;
    }

    // Canonical sales include only B-prefixed warehouse-managed products.
    // An exact B-code can remain valid historical sales evidence even when
    // that SKU is now inactive. Inactive exact barcodes are accepted only
    // when the base-unit ratio is deterministic from their own listing or
    // compatible current listings for the same Shopling goods identity.
    if (!isManagedSalesScope(index, order, raw)) {
      ignoredRows += 1;
      continue;
    }

    const identity = resolveIdentity(index, order, raw);
    if (!identity || !index.products.has(identity.barcode)) {
      unmappedRows += 1;
      if (unmappedSamples.length < MAX_UNMAPPED_SAMPLES) {
        unmappedSamples.push({
          orderLineId: order.id,
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

    acceptedRows += 1;
    const month = orderedAt.slice(0, 7);
    const key = `${identity.barcode}\u0000${month}`;
    const current = monthly.get(key) ?? {
      barcode: identity.barcode,
      month,
      quantity: 0,
      revenue: 0,
      lastSaleAt: null,
    };
    current.quantity += quantity * identity.unitsPerOrder;
    current.revenue += Math.max(0, number(order.paidAmount));
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
    unmappedSamples,
  };
}

export function combineProductMasterShoplingSalesChunks(
  chunks: ProductMasterShoplingSalesChunk[],
) {
  const monthly = new Map<string, ProductMasterSalesMonthlyRow>();
  const sampleKeys = new Set<string>();
  const unmappedSamples: ProductMasterSalesUnmappedSample[] = [];

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
    for (const sample of chunk.unmappedSamples) {
      if (sampleKeys.has(sample.orderLineId) || unmappedSamples.length >= 100) {
        continue;
      }
      sampleKeys.add(sample.orderLineId);
      unmappedSamples.push(sample);
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
    unmappedSamples,
  };
}
