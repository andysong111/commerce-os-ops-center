import { calculateProductDecisionPlan } from "@/lib/productDecisionEngine";
import type { ProductDecisionSnapshot } from "@/lib/productDecisionSnapshot";
import {
  normalizeShoplingClaim,
  normalizeShoplingOrder,
  normalizeShoplingBarcode,
  type ShoplingRawRow,
} from "@/lib/shopling/shoplingNormalize";
import type { ShoplingDateRange } from "@/lib/shopling/shoplingReadClient";

const DAY_MS = 24 * 60 * 60 * 1000;
const BUCKET_DAYS = 30;
const BUCKET_COUNT = 12;
const ANALYSIS_SPAN_MS = DAY_MS * BUCKET_DAYS * BUCKET_COUNT;

export type PlanningListing = {
  goodsKey?: string | null;
  optionId?: string | null;
  unitsPerOrder?: number;
  active?: boolean;
};

export type PlanningProduct = {
  skuId: string;
  modelNo?: string | null;
  barcode: string;
  productName: string;
  optionName?: string | null;
  skuActive?: boolean;
  moq?: number;
  cartonQuantity?: number;
  latestCostKrw?: number;
  protectedCostKrw?: number;
  inventoryQuantity?: number;
  inventoryConfirmed?: boolean;
  inventoryVerified?: boolean;
  inventoryBaselineAt?: string | null;
  inventoryBaselineKind?: string | null;
  inventoryBaselineQuantity?: number | null;
  inventoryRequiresReview?: boolean;
  listings?: PlanningListing[];
};

export type ProductPlanningSnapshot = {
  generatedAt: string;
  products: PlanningProduct[];
};

export type ShoplingOrderReference = {
  orderNo: string;
  productId: string | null;
  mallProductKey: string | null;
  optionId: string | null;
  barcode: string;
  unitsPerOrder: number;
};

export type ShoplingOrderProductAggregate = {
  barcode: string;
  units: number[];
  revenue: number[];
  shippedOrders: number[];
};

export type ShoplingClaimProductAggregate = {
  barcode: string;
  weightedClaims: number[];
  claimQuantity: number[];
};

export type ShoplingOrderChunkSummary = {
  range: ShoplingDateRange;
  fetchedRows: number;
  acceptedRows: number;
  unmappedRows: number;
  recent30Revenue: number;
  products: ShoplingOrderProductAggregate[];
  references: ShoplingOrderReference[];
};

export type ShoplingClaimChunkSummary = {
  range: ShoplingDateRange;
  fetchedRows: number;
  acceptedRows: number;
  unmappedRows: number;
  products: ShoplingClaimProductAggregate[];
};

export type ShoplingLiveAggregate = {
  analysisAsOf: string;
  recent30Revenue: number;
  products: Array<{
    planning: PlanningProduct;
    units: number[];
    revenue: number[];
    shippedOrders: number[];
    weightedClaims: number[];
    claimQuantity: number[];
  }>;
};

type ListingIdentity = {
  barcode: string;
  unitsPerOrder: number;
};

type PlanningIndex = {
  products: Map<string, PlanningProduct>;
  byOptionId: Map<string, ListingIdentity>;
  byGoodsKey: Map<string, ListingIdentity>;
};

type OrderReferenceIndex = {
  byOrderProduct: Map<string, ShoplingOrderReference>;
  byOrderMallProduct: Map<string, ShoplingOrderReference>;
  uniqueByOrder: Map<string, ShoplingOrderReference>;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function quantity(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function decimal(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function managedBarcode(value: unknown) {
  const barcode = normalizeShoplingBarcode(value);
  return /^[A-Z]{3}\d+-\d+$/.test(barcode) ? barcode : "";
}

function unitsPerOrder(value: unknown) {
  return Math.max(1, quantity(value) || 1);
}

function emptyNumbers() {
  return Array.from({ length: BUCKET_COUNT }, () => 0);
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

function bucketIndex(occurredAt: string, analysisEndMs: number) {
  const timestamp = Date.parse(occurredAt);
  if (!Number.isFinite(timestamp)) return -1;
  const age = analysisEndMs - timestamp;
  if (age < 0 || age >= ANALYSIS_SPAN_MS) return -1;
  return Math.floor(age / (BUCKET_DAYS * DAY_MS));
}

function registerUnique(
  target: Map<string, ListingIdentity>,
  ambiguous: Set<string>,
  key: string,
  value: ListingIdentity,
) {
  if (!key || ambiguous.has(key)) return;
  const current = target.get(key);
  if (!current) {
    target.set(key, value);
    return;
  }
  if (
    current.barcode !== value.barcode ||
    current.unitsPerOrder !== value.unitsPerOrder
  ) {
    target.delete(key);
    ambiguous.add(key);
  }
}

export function buildProductPlanningIndex(
  snapshot: ProductPlanningSnapshot,
): PlanningIndex {
  const products = new Map<string, PlanningProduct>();
  const byOptionId = new Map<string, ListingIdentity>();
  const byGoodsKey = new Map<string, ListingIdentity>();
  const ambiguousOption = new Set<string>();
  const ambiguousGoods = new Set<string>();

  for (const raw of snapshot.products ?? []) {
    const barcode = managedBarcode(raw.barcode);
    if (!barcode || raw.skuActive === false) continue;
    const product: PlanningProduct = {
      ...raw,
      barcode,
      skuId: text(raw.skuId) || `sku:${barcode}`,
      productName: text(raw.productName) || barcode,
      moq: Math.max(1, quantity(raw.moq) || 1),
      cartonQuantity: Math.max(1, quantity(raw.cartonQuantity) || 1),
      listings: Array.isArray(raw.listings) ? raw.listings : [],
    };
    products.set(barcode, product);

    for (const listing of product.listings ?? []) {
      if (listing.active === false) continue;
      const identity = {
        barcode,
        unitsPerOrder: unitsPerOrder(listing.unitsPerOrder),
      };
      registerUnique(
        byOptionId,
        ambiguousOption,
        text(listing.optionId),
        identity,
      );
      registerUnique(
        byGoodsKey,
        ambiguousGoods,
        text(listing.goodsKey),
        identity,
      );
    }
  }

  return { products, byOptionId, byGoodsKey };
}

function resolveListingIdentity(
  index: PlanningIndex,
  input: {
    optionId?: string | null;
    productId?: string | null;
    mallProductKey?: string | null;
    barcode?: string | null;
  },
): ListingIdentity | null {
  const option = text(input.optionId);
  if (option && index.byOptionId.has(option)) return index.byOptionId.get(option)!;
  const directBarcode = managedBarcode(input.barcode);
  if (directBarcode && index.products.has(directBarcode)) {
    return { barcode: directBarcode, unitsPerOrder: 1 };
  }
  for (const key of [text(input.productId), text(input.mallProductKey)]) {
    if (key && index.byGoodsKey.has(key)) return index.byGoodsKey.get(key)!;
  }
  return null;
}

function productAggregate(
  target: Map<string, ShoplingOrderProductAggregate & { orderSets: Set<string>[] }>,
  barcode: string,
) {
  const current = target.get(barcode);
  if (current) return current;
  const created = {
    barcode,
    units: emptyNumbers(),
    revenue: emptyNumbers(),
    shippedOrders: emptyNumbers(),
    orderSets: Array.from({ length: BUCKET_COUNT }, () => new Set<string>()),
  };
  target.set(barcode, created);
  return created;
}

function referenceKey(reference: ShoplingOrderReference) {
  return [
    reference.orderNo,
    reference.productId ?? "",
    reference.mallProductKey ?? "",
    reference.optionId ?? "",
    reference.barcode,
  ].join("\u0000");
}

export function aggregateShoplingOrderChunk(
  rows: ShoplingRawRow[],
  planning: ProductPlanningSnapshot,
  analysisAsOf: string,
  range: ShoplingDateRange,
): ShoplingOrderChunkSummary {
  const asOf = validIso(analysisAsOf);
  if (!asOf) throw new Error("SHOPLING_AGGREGATION_AS_OF_INVALID");
  const analysisEndMs = Date.parse(asOf);
  const recent30Start = analysisEndMs - 30 * DAY_MS;
  const index = buildProductPlanningIndex(planning);
  const aggregates = new Map<
    string,
    ShoplingOrderProductAggregate & { orderSets: Set<string>[] }
  >();
  const references = new Map<string, ShoplingOrderReference>();
  const seenOrderLines = new Set<string>();
  let acceptedRows = 0;
  let unmappedRows = 0;
  let recent30Revenue = 0;

  for (const raw of rows) {
    const order = normalizeShoplingOrder(raw);
    if (!order.id || seenOrderLines.has(order.id)) continue;
    seenOrderLines.add(order.id);
    if (!order.orderNo || !validSaleStatus(order.status)) continue;
    const orderedAt = validIso(order.orderedAt);
    if (!orderedAt || Date.parse(orderedAt) >= analysisEndMs) continue;
    if (Date.parse(orderedAt) >= recent30Start) {
      recent30Revenue += decimal(order.paidAmount);
    }
    const bucket = bucketIndex(orderedAt, analysisEndMs);
    if (bucket < 0) continue;
    const identity = resolveListingIdentity(index, order);
    if (!identity) {
      unmappedRows += 1;
      continue;
    }
    acceptedRows += 1;
    const units = quantity(order.quantity) * identity.unitsPerOrder;
    const aggregate = productAggregate(aggregates, identity.barcode);
    aggregate.units[bucket] += units;
    aggregate.revenue[bucket] += decimal(order.paidAmount);
    aggregate.orderSets[bucket].add(order.orderNo);

    const reference: ShoplingOrderReference = {
      orderNo: order.orderNo,
      productId: order.productId,
      mallProductKey: order.mallProductKey,
      optionId: order.optionId || null,
      barcode: identity.barcode,
      unitsPerOrder: identity.unitsPerOrder,
    };
    references.set(referenceKey(reference), reference);
  }

  return {
    range,
    fetchedRows: rows.length,
    acceptedRows,
    unmappedRows,
    recent30Revenue: Math.round(recent30Revenue),
    products: [...aggregates.values()].map((row) => ({
      barcode: row.barcode,
      units: row.units,
      revenue: row.revenue.map((value) => Math.round(value)),
      shippedOrders: row.orderSets.map((orders) => orders.size),
    })),
    references: [...references.values()],
  };
}

function registerReference(
  target: Map<string, ShoplingOrderReference>,
  ambiguous: Set<string>,
  key: string,
  reference: ShoplingOrderReference,
) {
  if (!key || ambiguous.has(key)) return;
  const current = target.get(key);
  if (!current) {
    target.set(key, reference);
    return;
  }
  if (
    current.barcode !== reference.barcode ||
    current.optionId !== reference.optionId
  ) {
    target.delete(key);
    ambiguous.add(key);
  }
}

function buildOrderReferenceIndex(
  references: ShoplingOrderReference[],
): OrderReferenceIndex {
  const byOrderProduct = new Map<string, ShoplingOrderReference>();
  const byOrderMallProduct = new Map<string, ShoplingOrderReference>();
  const uniqueByOrder = new Map<string, ShoplingOrderReference>();
  const ambiguousProduct = new Set<string>();
  const ambiguousMallProduct = new Set<string>();
  const ambiguousOrder = new Set<string>();

  for (const reference of references) {
    registerReference(
      uniqueByOrder,
      ambiguousOrder,
      reference.orderNo,
      reference,
    );
    if (reference.productId) {
      registerReference(
        byOrderProduct,
        ambiguousProduct,
        `${reference.orderNo}:product:${reference.productId}`,
        reference,
      );
    }
    if (reference.mallProductKey) {
      registerReference(
        byOrderMallProduct,
        ambiguousMallProduct,
        `${reference.orderNo}:mall-product:${reference.mallProductKey}`,
        reference,
      );
    }
  }
  return { byOrderProduct, byOrderMallProduct, uniqueByOrder };
}

function resolveClaimReference(
  index: OrderReferenceIndex,
  claim: ReturnType<typeof normalizeShoplingClaim>,
) {
  if (!claim.orderNo) return null;
  if (claim.productId) {
    const matched = index.byOrderProduct.get(
      `${claim.orderNo}:product:${claim.productId}`,
    );
    if (matched) return matched;
  }
  if (claim.mallProductKey) {
    const matched = index.byOrderMallProduct.get(
      `${claim.orderNo}:mall-product:${claim.mallProductKey}`,
    );
    if (matched) return matched;
  }
  return index.uniqueByOrder.get(claim.orderNo) ?? null;
}

function claimAggregate(
  target: Map<string, ShoplingClaimProductAggregate>,
  barcode: string,
) {
  const current = target.get(barcode);
  if (current) return current;
  const created = {
    barcode,
    weightedClaims: emptyNumbers(),
    claimQuantity: emptyNumbers(),
  };
  target.set(barcode, created);
  return created;
}

export function aggregateShoplingClaimChunk(
  rows: ShoplingRawRow[],
  planning: ProductPlanningSnapshot,
  orderReferences: ShoplingOrderReference[],
  analysisAsOf: string,
  range: ShoplingDateRange,
): ShoplingClaimChunkSummary {
  const asOf = validIso(analysisAsOf);
  if (!asOf) throw new Error("SHOPLING_AGGREGATION_AS_OF_INVALID");
  const analysisEndMs = Date.parse(asOf);
  const planningIndex = buildProductPlanningIndex(planning);
  const referenceIndex = buildOrderReferenceIndex(orderReferences);
  const aggregates = new Map<string, ShoplingClaimProductAggregate>();
  const seenClaims = new Set<string>();
  let acceptedRows = 0;
  let unmappedRows = 0;

  for (const raw of rows) {
    const claim = normalizeShoplingClaim(raw);
    if (!claim.claimKey || seenClaims.has(claim.claimKey)) continue;
    seenClaims.add(claim.claimKey);
    const claimedAt = validIso(claim.claimedAt);
    if (!claimedAt) continue;
    const bucket = bucketIndex(claimedAt, analysisEndMs);
    if (bucket < 0) continue;
    const direct = resolveListingIdentity(planningIndex, claim);
    const reference = direct ? null : resolveClaimReference(referenceIndex, claim);
    const identity = direct ??
      (reference
        ? {
            barcode: reference.barcode,
            unitsPerOrder: reference.unitsPerOrder,
          }
        : null);
    if (!identity) {
      unmappedRows += 1;
      continue;
    }
    acceptedRows += 1;
    const claimedUnits =
      Math.max(1, quantity(claim.quantity) || 1) * identity.unitsPerOrder;
    const aggregate = claimAggregate(aggregates, identity.barcode);
    aggregate.claimQuantity[bucket] += claimedUnits;
    aggregate.weightedClaims[bucket] +=
      claimedUnits * decimal(claim.severityWeight);
  }

  return {
    range,
    fetchedRows: rows.length,
    acceptedRows,
    unmappedRows,
    products: [...aggregates.values()].map((row) => ({
      ...row,
      weightedClaims: row.weightedClaims.map(
        (value) => Math.round(value * 1000) / 1000,
      ),
    })),
  };
}

function addArrays(target: number[], source: number[]) {
  for (let index = 0; index < BUCKET_COUNT; index += 1) {
    target[index] += decimal(source[index]);
  }
}

export function combineShoplingLiveChunks(
  planning: ProductPlanningSnapshot,
  orderChunks: ShoplingOrderChunkSummary[],
  claimChunks: ShoplingClaimChunkSummary[],
  analysisAsOf: string,
): ShoplingLiveAggregate {
  const index = buildProductPlanningIndex(planning);
  const products = new Map<
    string,
    ShoplingLiveAggregate["products"][number]
  >();
  for (const [barcode, product] of index.products) {
    products.set(barcode, {
      planning: product,
      units: emptyNumbers(),
      revenue: emptyNumbers(),
      shippedOrders: emptyNumbers(),
      weightedClaims: emptyNumbers(),
      claimQuantity: emptyNumbers(),
    });
  }

  for (const chunk of orderChunks) {
    for (const row of chunk.products) {
      const product = products.get(managedBarcode(row.barcode));
      if (!product) continue;
      addArrays(product.units, row.units);
      addArrays(product.revenue, row.revenue);
      addArrays(product.shippedOrders, row.shippedOrders);
    }
  }
  for (const chunk of claimChunks) {
    for (const row of chunk.products) {
      const product = products.get(managedBarcode(row.barcode));
      if (!product) continue;
      addArrays(product.weightedClaims, row.weightedClaims);
      addArrays(product.claimQuantity, row.claimQuantity);
    }
  }

  return {
    analysisAsOf,
    recent30Revenue: orderChunks.reduce(
      (total, chunk) => total + quantity(chunk.recent30Revenue),
      0,
    ),
    products: [...products.values()],
  };
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function percentileFactors(values: Map<string, number>) {
  const positive = [...values.values()]
    .filter((value) => value > 0)
    .sort((left, right) => left - right);
  const result = new Map<string, number>();
  for (const [barcode, value] of values) {
    if (value <= 0 || !positive.length) {
      result.set(barcode, 0);
      continue;
    }
    const below = positive.filter((candidate) => candidate < value).length;
    result.set(
      barcode,
      positive.length <= 1 ? 1 : below / (positive.length - 1),
    );
  }
  return result;
}

export function buildLiveProductDecisionSnapshot(
  requestId: string,
  aggregate: ShoplingLiveAggregate,
  commitments: Map<string, number>,
): ProductDecisionSnapshot {
  const quantity90 = new Map<string, number>();
  const revenue90 = new Map<string, number>();
  for (const product of aggregate.products) {
    quantity90.set(product.planning.barcode, sum(product.units.slice(0, 3)));
    revenue90.set(product.planning.barcode, sum(product.revenue.slice(0, 3)));
  }
  const quantityFactors = percentileFactors(quantity90);
  const revenueFactors = percentileFactors(revenue90);
  const totalShipped = aggregate.products.reduce(
    (total, product) => total + sum(product.shippedOrders.slice(0, 6)),
    0,
  );
  const totalWeightedClaims = aggregate.products.reduce(
    (total, product) => total + sum(product.weightedClaims.slice(0, 6)),
    0,
  );
  const portfolioClaimRate = totalShipped
    ? (totalWeightedClaims / totalShipped) * 100
    : 0;

  const engineProducts = aggregate.products.map((product) => {
    const recentUnits = sum(product.units.slice(0, 3));
    const recentRevenue = sum(product.revenue.slice(0, 3));
    const shippedOrders = sum(product.shippedOrders.slice(0, 6));
    const weightedClaims = sum(product.weightedClaims.slice(0, 6));
    const rawClaimRate = shippedOrders
      ? (weightedClaims / shippedOrders) * 100
      : 0;
    const weightedClaimRate =
      shippedOrders < 20
        ? ((weightedClaims + (portfolioClaimRate / 100) * 20) /
            (shippedOrders + 20)) *
          100
        : rawClaimRate;
    const storedCost = quantity(product.planning.latestCostKrw);
    const unitCost =
      storedCost > 0
        ? storedCost
        : recentUnits > 0
          ? Math.round((recentRevenue / recentUnits) * 0.5)
          : 0;
    const inventoryKnown = Boolean(
      product.planning.inventoryConfirmed &&
        !product.planning.inventoryRequiresReview,
    );
    return {
      barcode: product.planning.barcode,
      name: product.planning.productName,
      monthlyUnits: product.units,
      monthlyRevenue: product.revenue,
      unitCost,
      weightedClaimRate,
      salesPowerFactor:
        ((quantityFactors.get(product.planning.barcode) ?? 0) +
          (revenueFactors.get(product.planning.barcode) ?? 0)) /
        2,
      moq: Math.max(1, quantity(product.planning.moq) || 1),
      cartonQuantity: Math.max(
        1,
        quantity(product.planning.cartonQuantity) || 1,
      ),
      inventoryKnown,
      availableQuantity: inventoryKnown
        ? quantity(product.planning.inventoryQuantity)
        : 0,
      reservedQuantity: 0,
      incomingQuantity: 0,
      ledgerCommitment: quantity(
        commitments.get(product.planning.barcode),
      ),
    };
  });

  const plan = calculateProductDecisionPlan({
    generatedAt: aggregate.analysisAsOf,
    recent30DayRevenue: aggregate.recent30Revenue,
    products: engineProducts,
  });

  return {
    mode: "LIVE",
    notice:
      "Ops Center가 Shopling 판매·클레임, Product Master 확인재고·원가·MOQ, 중국 미입고 원장을 직접 읽어 계산한 발주안입니다. 실제 주문은 별도 승인 전까지 실행하지 않습니다.",
    runId: requestId,
    runStatus: "DRAFT",
    generatedAt: aggregate.analysisAsOf,
    periodLabel: "요청시점 최근 360일 · 30일 12구간 전면재계산",
    budget: plan.productOrderBudget,
    budgetBasis:
      `최근30일 정상매출 ${aggregate.recent30Revenue.toLocaleString("ko-KR")}원 ÷ 2 · ` +
      `배송대행 포함 배수 ${plan.purchaseCostMultiplier.toFixed(2)}`,
    expectedSpend: plan.expectedSpend,
    products: plan.products
      .map((row) => ({
        barcode: row.input.barcode,
        name: row.input.name,
        modelNo:
          aggregate.products.find(
            (product) =>
              product.planning.barcode === row.input.barcode,
          )?.planning.modelNo ?? null,
        status: row.finalGroup,
        trend: row.sales.trendLabel,
        recommendedQty: row.finalQuantity,
        rawRecommendedQty: row.sales.rawRecommendedQuantity,
        forecastUnits: row.sales.forecastUnits,
        expectedCost: row.expectedCost,
        estimatedStock: row.netRequirement.estimatedStock,
        openCommitment: row.netRequirement.openCommitment,
        securedQuantity: row.netRequirement.securedQuantity,
        netRequiredRaw: row.netRequirement.netRequiredRaw,
        inventoryKnown: row.netRequirement.inventoryKnown,
        score: { total: row.sales.priorityScore },
      }))
      .sort(
        (left, right) =>
          Number(right.score?.total ?? 0) -
            Number(left.score?.total ?? 0) ||
          text(left.barcode).localeCompare(text(right.barcode), "ko"),
      ),
  };
}
