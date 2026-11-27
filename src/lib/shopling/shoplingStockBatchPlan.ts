import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { ShoplingOptionDesiredStatus, ShoplingOptionVariant } from "./shoplingOptionStatus";
import type { ShoplingLogicalProductKind } from "./shoplingGoodsKeyTransmission";

export type StockBatchItem = {
  barcode: string;
  desiredStatus: ShoplingOptionDesiredStatus;
  productKind: ShoplingLogicalProductKind;
  goodsKeys: string[];
};

export type StockProductStep = {
  goodsKey: string;
  optionCount: number;
  initialParent: string;
  beforeHash: string;
  afterHash: string;
  applyOption: boolean;
  parentDesiredStatus: ShoplingOptionDesiredStatus | null;
};

export type StockItemPlan = Omit<StockBatchItem, "goodsKeys"> & {
  candidateKeys: string[];
  steps: StockProductStep[];
  dependencies: string[];
};

type Availability = "ALL_ON_SALE" | "PARTIAL_SOLD_OUT" | "ALL_SOLD_OUT";

export type StockProductSummary = {
  goodsKey: string;
  productName: string;
  partnerGoodsCode: string;
  productSaleStatus: string;
  options: {barcode: string; optionId: string; selection: ShoplingOptionVariant["selection"]; optionStatus: string; plannedStatus: string}[];
  beforeAvailability: Availability | null;
  afterAvailability: Availability | null;
  finalizeBarcode: string | null;
  parentDesiredStatus: ShoplingOptionDesiredStatus | null;
};

function target(desired: ShoplingOptionDesiredStatus) {
  return desired === "ON_SALE" ? "B" : "C";
}

function availability(states: string[]): Availability {
  if (states.every((s) => s === "C")) return "ALL_SOLD_OUT";
  if (states.every((s) => s === "B")) return "ALL_ON_SALE";
  return "PARTIAL_SOLD_OUT";
}

/** Hash the complete selection identity (the modify API writes by selection), quantities and option states. */
function fingerprint(rows: ShoplingOptionVariant[]) {
  const canonical = rows.map((r) => JSON.stringify([
    r.goodsKey, r.partnerGoodsCode, r.optionId, r.partnerOptionCode,
    r.selection.map(({ title, value }) => [title, value]), r.optionStatus, r.optionQuantity,
  ])).sort();
  return createHash("sha256").update(JSON.stringify(["shopling-stock-siblings-v1", canonical])).digest("hex");
}

export function validateStockProductStep(step: StockProductStep, rows: ShoplingOptionVariant[], phase: "BEFORE" | "OPTIONS_APPLIED" | "COMPLETE") {
  const hash = fingerprint(rows);
  const parent = rows[0]?.productSaleStatus;
  const finalParent = step.parentDesiredStatus && target(step.parentDesiredStatus);
  const after = hash === step.afterHash;
  const allowedHash = after || (phase === "BEFORE" && hash === step.beforeHash);
  const allowedParent = phase === "COMPLETE" && finalParent ? parent === finalParent
    : parent === step.initialParent || (after && parent === finalParent);
  if (!allowedHash || !allowedParent || rows.some((r) => r.productSaleStatus !== parent)) {
    throw new Error(`SHOPLING_STOCK_BATCH_PLAN_STALE:${step.goodsKey}`);
  }
}

export function buildStockBatchPlan(items: StockBatchItem[], candidates: Map<string, string[]>, rows: ShoplingOptionVariant[]) {
  const plans = items.map((item): StockItemPlan => ({
    barcode: item.barcode, productKind: item.productKind, desiredStatus: item.desiredStatus,
    candidateKeys: [...(candidates.get(item.barcode) || [])].sort(), steps: [], dependencies: [],
  }));
  const products: StockProductSummary[] = [];
  const productRows = new Map<string, ShoplingOptionVariant[]>();
  for (const row of rows) {
    const group = productRows.get(row.goodsKey) || [];
    if (!group.length) productRows.set(row.goodsKey, group);
    group.push(row);
  }
  const keys = [...new Set(plans.flatMap((plan) => plan.candidateKeys))].sort();
  for (const key of keys) {
    const variants = productRows.get(key);
    if (!variants?.length) throw new Error(`SHOPLING_STOCK_BATCH_PRODUCT_MISSING:${key}`);
    const matched = plans.filter((p) => variants.some((r) => r.partnerOptionCode === p.barcode));
    if (!matched.length) continue; // An old index entry points to a listing that no longer contains this option.
    if (matched.some((p) => !p.candidateKeys.includes(key))) throw new Error(`SHOPLING_STOCK_BATCH_INDEX_CHANGED:${key}`);
    const first = variants[0];
    const parent = first.productSaleStatus;
    const ended = parent === "E";
    if (!ended && parent !== "B" && parent !== "C") throw new Error(`SHOPLING_PRODUCT_STATUS_TRANSITION_BLOCKED:${parent || "EMPTY"}`);
    const selections = variants.map((r) => JSON.stringify(r.selection.map(({title,value}) => [title,value])));
    if (variants.some((r) => r.productSaleStatus !== parent || r.partnerGoodsCode !== first.partnerGoodsCode || !r.selection.length)
      || new Set(selections).size !== variants.length) throw new Error(`SHOPLING_STOCK_BATCH_AMBIGUOUS_OPTIONS:${key}`);
    if (!ended && variants.length > 1 && matched.some((p) => p.productKind === "SINGLE")) {
      throw new Error(`SHOPLING_STOCK_BATCH_PRODUCT_KIND_MISMATCH:${key}`);
    }
    // A logical SINGLE's stock state is the parent's status. Its dormant option is never written.
    const logicalSingle = variants.length === 1 && matched[0].productKind === "SINGLE";
    if (!ended && !logicalSingle) {
      const unknown = variants.find((r) => r.optionStatus !== "B" && r.optionStatus !== "C");
      if (unknown) throw new Error(`SHOPLING_OPTION_STATUS_TRANSITION_BLOCKED:${unknown.optionStatus || "EMPTY"}`);
    }
    const projected = variants.map((r) => ({...r}));
    const earlier: string[] = [];
    let parentDesiredStatus: ShoplingOptionDesiredStatus | null = null;
    let finalizeBarcode: string | null = null;
    for (const [index, plan] of matched.entries()) {
      const exact = projected.filter((r) => r.partnerOptionCode === plan.barcode);
      if (exact.length !== 1) throw new Error(`SHOPLING_OPTION_EXACT_MATCH_REQUIRED:${plan.barcode}:${exact.length}`);
      const beforeHash = fingerprint(projected);
      const applyOption = !ended && !logicalSingle;
      if (applyOption) exact[0].optionStatus = target(plan.desiredStatus);
      if (!ended && index === matched.length - 1) {
        if (variants.length === 1) parentDesiredStatus = plan.desiredStatus;
        else if (projected.every((r) => r.optionStatus === "C")) parentDesiredStatus = "SOLD_OUT";
        else if (parent === "C" || matched.some((p) => p.desiredStatus === "ON_SALE")) parentDesiredStatus = "ON_SALE";
        if (parentDesiredStatus) finalizeBarcode = plan.barcode;
      }
      if (!ended) {
        plan.dependencies = [...new Set([...plan.dependencies, ...earlier])];
        earlier.push(plan.barcode);
      }
      plan.steps.push({
        goodsKey: key, optionCount: variants.length, initialParent: parent, beforeHash,
        afterHash: fingerprint(projected), applyOption, parentDesiredStatus,
      });
    }
    products.push({
      goodsKey: key, productName: first.productName, partnerGoodsCode: first.partnerGoodsCode, productSaleStatus: parent,
      options: variants.map((r, i) => ({barcode: r.partnerOptionCode, optionId: r.optionId, selection: r.selection, optionStatus: r.optionStatus, plannedStatus: projected[i].optionStatus})),
      beforeAvailability: ended ? null : availability(logicalSingle ? [parent] : variants.map((r) => r.optionStatus)),
      afterAvailability: ended ? null : availability(logicalSingle ? [target(matched[0].desiredStatus)] : projected.map((r) => r.optionStatus)),
      finalizeBarcode, parentDesiredStatus,
    });
  }
  for (const p of plans) {
    if (!p.steps.length) throw new Error(`SHOPLING_BCODE_INDEX_STALE_NO_LIVE_MATCH:${p.barcode}`);
  }
  return { plans, products };
}

const PLAN_LIFETIME = 8 * 60 * 60 * 1000;
function signature(payload: string, secret: string) {
  return createHmac("sha256", secret).update("commerce-os/stock-plan/v2\0").update(payload).digest();
}
export function signStockItemPlan(plan: StockItemPlan, secret: string, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ plan, expires: now + PLAN_LIFETIME }), "utf8").toString("base64url");
  return payload + "." + signature(payload, secret).toString("hex");
}

export function verifyStockItemPlan(token: unknown, secret: string, now = Date.now()): StockItemPlan {
  if (typeof token !== "string") throw new Error("SHOPLING_STOCK_BATCH_PLAN_INVALID");
  const [payload, sig, extra] = token.split(".");
  if (extra !== undefined || !payload || !/^[a-f0-9]{64}$/.test(sig || "") ||
      !timingSafeEqual(Buffer.from(sig, "hex"), signature(payload, secret))) {
    throw new Error("SHOPLING_STOCK_BATCH_PLAN_INVALID");
  }
  const { plan, expires } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (now >= expires) throw new Error("SHOPLING_STOCK_BATCH_PLAN_EXPIRED");
  return plan;
}
