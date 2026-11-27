import { loadIndexedShoplingGoodsKeys } from "./shoplingBcodeIndex";
import { readShoplingStockVariants } from "./shoplingOptionStatus";
import { shoplingReadConfigFromEnv } from "./shoplingReadClient";
import { buildStockBatchPlan, signStockItemPlan, validateStockProductStep, verifyStockItemPlan, type StockBatchItem, type StockItemPlan } from "./shoplingStockBatchPlan";

function normalizedItem(value: unknown): StockBatchItem {
  if (!value || typeof value !== "object") throw new Error("SHOPLING_STOCK_BATCH_ITEM_INVALID");
  const row = value as Record<string, unknown>;
  const barcode = String(row.barcode ?? "").normalize("NFKC").toUpperCase().replace(/[‐‑‒–—−]/g, "-").replace(/\s+/g, "");
  const desiredStatus = String(row.desiredStatus ?? "").trim().toUpperCase();
  const productKind = String(row.productKind ?? "").trim().toUpperCase();
  if (!/^B[A-Z]{2}\d+-\d+$/.test(barcode) || (desiredStatus !== "SOLD_OUT" && desiredStatus !== "ON_SALE") || (productKind !== "OPTION" && productKind !== "SINGLE")) {
    throw new Error("SHOPLING_STOCK_BATCH_ITEM_INVALID");
  }
  const rawKeys = row.goodsKeys ?? [];
  if (!Array.isArray(rawKeys) || rawKeys.some((key) => !/^\d{1,12}$/.test(String(key).trim()))) throw new Error("SHOPLING_STOCK_BATCH_KEYS_INVALID");
  const goodsKeys = [...new Set(rawKeys.map((key) => String(key).trim()))];
  return {barcode, desiredStatus, productKind, goodsKeys};
}

function planSecret() {
  const {authKey, loginId, companyId} = shoplingReadConfigFromEnv(process.env);
  return JSON.stringify([companyId, loginId, authKey]);
}

async function indexedKeysFor(item: StockBatchItem) {
  const indexed = await loadIndexedShoplingGoodsKeys(item.barcode);
  if (!indexed.length) throw new Error(`SHOPLING_BCODE_INDEX_MISSING:${item.barcode}`);
  return indexed;
}

export async function prepareShoplingStockBatch(values: unknown) {
  if (!Array.isArray(values) || !values.length || values.length > 50) throw new Error("SHOPLING_STOCK_BATCH_SIZE_INVALID");
  const items = values.map(normalizedItem);
  if (new Set(items.map((i) => i.barcode)).size !== items.length) throw new Error("SHOPLING_STOCK_BATCH_DUPLICATE_BARCODE");
  const candidates = new Map<string, string[]>();
  for (let offset = 0; offset < items.length; offset += 8) {
    await Promise.all(items.slice(offset, offset + 8).map(async (item) => {
      const indexed = await indexedKeysFor(item);
      candidates.set(item.barcode, [...new Set([...indexed, ...item.goodsKeys])].sort());
    }));
  }
  const rows = await readShoplingStockVariants([...new Set([...candidates.values()].flat())]);
  const { plans, products } = buildStockBatchPlan(items, candidates, rows);
  const secret = planSecret();
  return {
    planVersion: 2 as const, products,
    items: plans.map((p) => ({barcode: p.barcode, desiredStatus: p.desiredStatus, productKind: p.productKind,
      dependencies: p.dependencies, stockBatchPlan: signStockItemPlan(p, secret)})),
  };
}

export async function resolveShoplingStockItem(input: unknown, token: unknown, upgradedClient: boolean) {
  const item = normalizedItem(input);
  const indexedGoodsKeys = await indexedKeysFor(item);
  const candidateKeys = [...new Set([...indexedGoodsKeys, ...item.goodsKeys])].sort();
  const rows = await readShoplingStockVariants(candidateKeys);
  let plan: StockItemPlan;
  if (token !== undefined && token !== null) {
    plan = verifyStockItemPlan(token, planSecret());
    if (plan.barcode !== item.barcode || plan.desiredStatus !== item.desiredStatus || plan.productKind !== item.productKind
      || JSON.stringify(plan.candidateKeys) !== JSON.stringify(candidateKeys)) {
      throw new Error(`SHOPLING_STOCK_BATCH_PLAN_STALE:${item.barcode}`);
    }
  } else {
    plan = buildStockBatchPlan([item], new Map([[item.barcode, candidateKeys]]), rows).plans[0];
  }
  if (!upgradedClient && plan.steps.some((step) => step.optionCount > 1 && step.parentDesiredStatus)) {
    throw new Error("SHOPLING_STOCK_PARENT_EXTENSION_REQUIRED");
  }
  for (const key of candidateKeys) {
    const siblings = rows.filter((r) => r.goodsKey === key);
    if (!siblings.length) throw new Error(`SHOPLING_STOCK_BATCH_PRODUCT_MISSING:${key}`);
    const matches = siblings.filter((r) => r.partnerOptionCode === item.barcode);
    const step = plan.steps.find((s) => s.goodsKey === key);
    if (step ? matches.length !== 1 : matches.length > 0) throw new Error(`SHOPLING_STOCK_BATCH_PLAN_STALE:${key}`);
    if (step) {
      validateStockProductStep(step, siblings, "BEFORE");
    }
  }
  return {plan, indexedGoodsKeys};
}
