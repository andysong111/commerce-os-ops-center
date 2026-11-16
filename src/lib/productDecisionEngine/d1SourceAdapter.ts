import {
  calculateProductDecisionPlan,
  type ProductDecisionEngineProductInput,
  type ProductDecisionPlan,
} from "./index.ts";
import {
  DEFAULT_MINIMUM_ORDER_AMOUNT,
  DEFAULT_PAYMENT_FEE_MULTIPLIER,
  DEFAULT_PURCHASE_COST_MULTIPLIER,
} from "./portfolio.ts";

const MANAGED_BARCODE_PATTERN = /^[A-Z]{3}\d+-\d+$/;
const ANALYSIS_BUCKET_DAYS = 30;
const ANALYSIS_BUCKET_COUNT = 12;
const DAY_MS = 24 * 60 * 60 * 1000;
const ANALYSIS_SPAN_MS =
  ANALYSIS_BUCKET_DAYS * ANALYSIS_BUCKET_COUNT * DAY_MS;
const ACTIVE_COMMITMENT_STATUSES = new Set([
  "RESERVED",
  "EXPORTED",
  "ORDERED",
  "PARTIALLY_RECEIVED",
]);

export type PortableD1ProductDecisionTables = {
  app_settings?: unknown[];
  canonical_products?: unknown[];
  claims?: unknown[];
  decision_evidence?: unknown[];
  decision_items?: unknown[];
  decision_runs?: unknown[];
  inventory_positions?: unknown[];
  order_lines?: unknown[];
  product_planning_profiles?: unknown[];
  purchase_commitments?: unknown[];
};

export type D1ProductEngineInput = ProductDecisionEngineProductInput & {
  rollingUnits: number[];
  rollingRevenue: number[];
  shippedOrders: number;
  weightedClaimRate: number;
};

export type D1ProductDecisionSource = {
  runId: string;
  analysisAsOf: string;
  recent30DayRevenue: number;
  paymentFeeMultiplier: number;
  purchaseCostMultiplier: number;
  minimumOrderAmount: number;
  products: D1ProductEngineInput[];
};

export type D1ProductDecisionReplay = {
  source: D1ProductDecisionSource;
  plan: ProductDecisionPlan;
};

type WorkingProduct = {
  product: Record<string, unknown>;
  rollingUnits: number[];
  rollingRevenue: number[];
  rollingOrders: Array<Set<string>>;
  rollingWeightedClaims: number[];
};

export function normalizeManagedBarcode(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/\s+/g, "");
}

export function isManagedBarcode(value: unknown) {
  return MANAGED_BARCODE_PATTERN.test(normalizeManagedBarcode(value));
}

export function buildProductDecisionSourceFromD1(
  tables: PortableD1ProductDecisionTables,
): D1ProductDecisionSource {
  const run = latestDecisionRun(tables.decision_runs ?? []);
  const runId = text(run.id);
  const analysisAsOf = iso(run.generated_at);
  if (!runId || !analysisAsOf) {
    throw new Error("D1_LATEST_PRODUCT_DECISION_RUN_REQUIRED");
  }
  const analysisEndMs = Date.parse(analysisAsOf);
  const analysisStartMs = analysisEndMs - ANALYSIS_SPAN_MS;

  const products = new Map<string, WorkingProduct>();
  for (const raw of tables.canonical_products ?? []) {
    const product = record(raw);
    const barcode = normalizeManagedBarcode(product.barcode);
    if (!isManagedBarcode(barcode)) continue;
    products.set(barcode, {
      product,
      rollingUnits: Array.from({ length: ANALYSIS_BUCKET_COUNT }, () => 0),
      rollingRevenue: Array.from({ length: ANALYSIS_BUCKET_COUNT }, () => 0),
      rollingOrders: Array.from(
        { length: ANALYSIS_BUCKET_COUNT },
        () => new Set<string>(),
      ),
      rollingWeightedClaims: Array.from(
        { length: ANALYSIS_BUCKET_COUNT },
        () => 0,
      ),
    });
  }
  if (!products.size) throw new Error("D1_MANAGED_PRODUCTS_REQUIRED");

  const validOrders: Record<string, unknown>[] = [];
  for (const raw of tables.order_lines ?? []) {
    const row = record(raw);
    const orderedAt = timestamp(row.ordered_at);
    if (
      orderedAt === null ||
      orderedAt < analysisStartMs ||
      orderedAt >= analysisEndMs ||
      !validSaleStatus(text(row.status))
    ) {
      continue;
    }
    validOrders.push(row);
    const barcode = normalizeManagedBarcode(row.barcode);
    const working = products.get(barcode);
    if (!working) continue;
    const index = rollingIndex(orderedAt, analysisEndMs);
    if (index < 0) continue;
    const quantity = nonnegative(row.quantity);
    working.rollingUnits[index] += quantity;
    working.rollingRevenue[index] += orderRevenue(row);
    const orderNo = text(row.order_no);
    if (orderNo) working.rollingOrders[index].add(orderNo);
  }

  for (const raw of tables.claims ?? []) {
    const row = record(raw);
    const claimedAt = timestamp(row.claimed_at);
    if (
      claimedAt === null ||
      claimedAt < analysisStartMs ||
      claimedAt >= analysisEndMs
    ) {
      continue;
    }
    const barcode = normalizeManagedBarcode(row.barcode);
    const working = products.get(barcode);
    if (!working) continue;
    const index = rollingIndex(claimedAt, analysisEndMs);
    if (index < 0) continue;
    const quantity = Math.max(1, nonnegative(row.quantity));
    working.rollingWeightedClaims[index] +=
      quantity * nonnegativeNumber(row.severity_weight);
  }

  const quantity90 = new Map<string, number>();
  const revenue90 = new Map<string, number>();
  for (const [barcode, working] of products) {
    quantity90.set(barcode, sum(working.rollingUnits.slice(0, 3)));
    revenue90.set(barcode, sum(working.rollingRevenue.slice(0, 3)));
  }
  const quantityFactors = percentileFactors(quantity90);
  const revenueFactors = percentileFactors(revenue90);

  const totalShipped = sum(
    [...products.values()].map((working) =>
      sum(working.rollingOrders.slice(0, 6).map((orders) => orders.size)),
    ),
  );
  const totalWeightedClaims = sum(
    [...products.values()].map((working) =>
      sum(working.rollingWeightedClaims.slice(0, 6)),
    ),
  );
  const portfolioClaimRate = totalShipped
    ? (totalWeightedClaims / totalShipped) * 100
    : 0;

  const profiles = byBarcode(tables.product_planning_profiles ?? []);
  const inventories = byBarcode(tables.inventory_positions ?? []);
  const commitments = openCommitmentsByBarcode(
    tables.purchase_commitments ?? [],
  );

  const engineProducts: D1ProductEngineInput[] = [];
  for (const [barcode, working] of products) {
    const product = working.product;
    const profile = profiles.get(barcode);
    const inventory = inventories.get(barcode);
    const shippedOrders = sum(
      working.rollingOrders.slice(0, 6).map((orders) => orders.size),
    );
    const weightedClaims = sum(working.rollingWeightedClaims.slice(0, 6));
    const rawClaimRate = shippedOrders
      ? (weightedClaims / shippedOrders) * 100
      : 0;
    const weightedClaimRate =
      shippedOrders < 20
        ? ((weightedClaims + (portfolioClaimRate / 100) * 20) /
            (shippedOrders + 20)) *
          100
        : rawClaimRate;
    const recentUnits = sum(working.rollingUnits.slice(0, 3));
    const recentRevenue = sum(working.rollingRevenue.slice(0, 3));
    const storedUnitCost = nonnegativeNumber(product.unit_cost);
    const unitCost =
      storedUnitCost > 0
        ? storedUnitCost
        : recentUnits > 0
          ? Math.round((recentRevenue / recentUnits) * 0.5)
          : 0;
    const inventoryKnown = Boolean(inventory?.confirmed);

    engineProducts.push({
      barcode,
      name: text(product.canonical_name) || barcode,
      monthlyUnits: working.rollingUnits,
      monthlyRevenue: working.rollingRevenue,
      rollingUnits: working.rollingUnits,
      rollingRevenue: working.rollingRevenue,
      unitCost,
      weightedClaimRate,
      shippedOrders,
      salesPowerFactor:
        ((quantityFactors.get(barcode) ?? 0) +
          (revenueFactors.get(barcode) ?? 0)) /
        2,
      moq: positive(profile?.moq, 1),
      cartonQuantity: positive(profile?.carton_quantity, 1),
      inventoryKnown,
      availableQuantity: inventoryKnown
        ? nonnegative(inventory?.available_quantity)
        : 0,
      reservedQuantity: inventoryKnown
        ? nonnegative(inventory?.reserved_quantity)
        : 0,
      incomingQuantity: inventoryKnown
        ? nonnegative(inventory?.incoming_quantity)
        : 0,
      ledgerCommitment: commitments.get(barcode) ?? 0,
    });
  }

  const settings = appSettings(tables.app_settings ?? []);
  const recent30StartMs = analysisEndMs - 30 * DAY_MS;
  const recent30DayRevenue = validOrders
    .filter((row) => {
      const orderedAt = timestamp(row.ordered_at);
      return orderedAt !== null && orderedAt >= recent30StartMs;
    })
    .reduce((total, row) => total + orderRevenue(row), 0);

  return {
    runId,
    analysisAsOf,
    recent30DayRevenue: Math.round(recent30DayRevenue),
    paymentFeeMultiplier: DEFAULT_PAYMENT_FEE_MULTIPLIER,
    purchaseCostMultiplier: boundedNumber(
      settings.get("purchase_cost_multiplier"),
      1,
      3,
      DEFAULT_PURCHASE_COST_MULTIPLIER,
    ),
    minimumOrderAmount: boundedInteger(
      settings.get("minimum_product_order_amount"),
      0,
      1_000_000,
      DEFAULT_MINIMUM_ORDER_AMOUNT,
    ),
    products: engineProducts,
  };
}

export function replayProductDecisionFromD1(
  tables: PortableD1ProductDecisionTables,
): D1ProductDecisionReplay {
  const source = buildProductDecisionSourceFromD1(tables);
  return {
    source,
    plan: calculateProductDecisionPlan({
      generatedAt: source.analysisAsOf,
      recent30DayRevenue: source.recent30DayRevenue,
      paymentFeeMultiplier: source.paymentFeeMultiplier,
      purchaseCostMultiplier: source.purchaseCostMultiplier,
      minimumOrderAmount: source.minimumOrderAmount,
      products: source.products,
    }),
  };
}

function latestDecisionRun(values: unknown[]) {
  return values
    .map(record)
    .filter((row) => text(row.id) && iso(row.generated_at))
    .sort((left, right) =>
      text(right.generated_at).localeCompare(text(left.generated_at)),
    )[0] ?? {};
}

function rollingIndex(occurredAtMs: number, analysisEndMs: number) {
  const age = analysisEndMs - occurredAtMs;
  if (age < 0 || age >= ANALYSIS_SPAN_MS) return -1;
  return Math.floor(age / (ANALYSIS_BUCKET_DAYS * DAY_MS));
}

function validSaleStatus(status: string) {
  const normalized = status.toLowerCase();
  return !["취소", "반품", "환불", "cancel", "return", "refund"].some(
    (keyword) => normalized.includes(keyword),
  );
}

function orderRevenue(row: Record<string, unknown>) {
  const quantity = nonnegativeNumber(row.quantity);
  return Math.max(
    0,
    nonnegativeNumber(row.paid_amount) ||
      nonnegativeNumber(row.unit_price) * quantity -
        nonnegativeNumber(row.adjustment_amount),
  );
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

function byBarcode(values: unknown[]) {
  const result = new Map<string, Record<string, unknown>>();
  for (const raw of values) {
    const row = record(raw);
    const barcode = normalizeManagedBarcode(row.barcode);
    if (barcode) result.set(barcode, row);
  }
  return result;
}

function openCommitmentsByBarcode(values: unknown[]) {
  const result = new Map<string, number>();
  for (const raw of values) {
    const row = record(raw);
    if (!ACTIVE_COMMITMENT_STATUSES.has(text(row.status))) continue;
    const barcode = normalizeManagedBarcode(row.barcode);
    if (!barcode) continue;
    const committed =
      nonnegative(row.ordered_quantity) > 0
        ? nonnegative(row.ordered_quantity)
        : nonnegative(row.requested_quantity);
    const open = Math.max(
      0,
      committed -
        nonnegative(row.received_quantity) -
        nonnegative(row.cancelled_quantity),
    );
    result.set(barcode, (result.get(barcode) ?? 0) + open);
  }
  return result;
}

function appSettings(values: unknown[]) {
  const result = new Map<string, string>();
  for (const raw of values) {
    const row = record(raw);
    const key = text(row.key);
    if (key) result.set(key, text(row.value));
  }
  return result;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function timestamp(value: unknown) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function iso(value: unknown) {
  const parsed = timestamp(value);
  return parsed === null ? "" : new Date(parsed).toISOString();
}

function nonnegativeNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function nonnegative(value: unknown) {
  return Math.round(nonnegativeNumber(value));
}

function positive(value: unknown, fallback: number) {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : fallback;
}

function boundedNumber(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
) {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}
