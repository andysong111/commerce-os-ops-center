import { createHash } from "node:crypto";
import {
  buildInternalMallPriceTargets,
  inferLegacyInternalPriceFamily,
  internalPriceGroupTarget,
  normalizeInternalPriceGroup,
  type InternalPriceGroup,
} from "./internalChinaPriceGroupPolicy.ts";

/** A click authorizes increases only. A stock count never certifies historical cost. */
import { MONTHLY_PRICE_POLICY } from "./monthlyPriceContract.ts";
export { MONTHLY_PRICE_POLICY, MONTHLY_PRICE_BRIDGE, MONTHLY_PRICE_EXTENSION_VERSION } from "./monthlyPriceContract.ts";
export const MONTHLY_PRICE_MAX = 100_000_000;
export type PriceValues = { sellPrice: number; purchasePrice: number; consumerPrice: number };
export type MonthlyObservedPrice = PriceValues & { mallKey: string; source: string };
export type MonthlyObservation = { goodsKey: string; pageUrl: string; observedAt: number; rows: MonthlyObservedPrice[] };
export type MonthlyCost = {
  barcode: string; unitCostKrw: number; quantity: number; draftId: string;
  cycleMonth: string; closedAt: string; receiptIds: string[];
  provenance: "CONFIRMED_RECEIPT_AND_CLOSED_COST";
};
export type MonthlyPriceOption = { barcode: string; optionId: string; productName?: string; unitsPerOrder: number; currentCostKrw: number; protectedCostKrw: number };
export type MonthlyPriceCandidate = {
  goodsKey: string; productName: string; productGroup: string;
  inventoryCostBasis: "LEGACY_MIXED_UNRESOLVED" | "UNKNOWN_COST";
  options: MonthlyPriceOption[]; reason: string | null;
};
export type MonthlyLiveOption = {
  optionId: string;
  barcode: string;
  optionBarcode: string;
  optionName: string;
  optionTitle: string;
  optionValue: string;
  amount: number;
  finalSellPrice: number;
};
export type MonthlyLiveProduct = { prices: PriceValues; options: MonthlyLiveOption[] };
export type MonthlyOptionPriceTarget = MonthlyLiveOption & {
  beforeAmount: number;
  beforeFinalSellPrice: number;
  targetAmount: number;
  targetFinalSellPrice: number;
  policyTargetSellPrice: number;
};
export type MonthlyPriceWrite = {
  mallKey: string | null;
  before: PriceValues;
  target: PriceValues;
  options?: MonthlyOptionPriceTarget[];
};
export type MonthlyPricePlan = {
  policy: typeof MONTHLY_PRICE_POLICY; goodsKey: string; productGroup: string;
  groupResolution: "EXACT" | "MALL_FAMILY" | "PRICE_RATIO";
  optionIds: string[]; targets: MonthlyPriceWrite[]; writes: MonthlyPriceWrite[];
  protectedDecreaseCount: number; optionChangeCount: number; fingerprint: string;
};
export type MonthlyPriceGroupResolution = {
  group: InternalPriceGroup | null;
  source: "EXACT" | "MALL_FAMILY" | "PRICE_RATIO" | "UNRESOLVED";
};

export function monthlyRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function monthlyHash(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export function monthlyMonth(value: unknown): string {
  if (typeof value !== "string" || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(value)) throw new Error("MONTHLY_PRICE_MONTH_INVALID");
  return value;
}
export function monthlyMoney(value: unknown, zero = false): number {
  if (typeof value === "boolean" || value === null || value === undefined || value === "") throw new Error("MONTHLY_PRICE_VALUE_MISSING");
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < (zero ? 0 : 1) || n > MONTHLY_PRICE_MAX) throw new Error("MONTHLY_PRICE_VALUE_INVALID");
  return n;
}
function decimal(value: unknown, zero = false) {
  if (typeof value === "boolean" || value === null || value === undefined || value === "") throw new Error("MONTHLY_PRICE_COST_INPUT_MISSING");
  const n = Number(value);
  if (!Number.isFinite(n) || n < (zero ? 0 : Number.EPSILON) || n > MONTHLY_PRICE_MAX) throw new Error("MONTHLY_PRICE_COST_INPUT_INVALID");
  return n;
}

/** Rebuild a price-only cost view from durable receipt quantities and a matching
 * final freight close. Never insert quantity events or relabel old stock costs. */
export function monthlyCostsFromEvidence(input: {
  draft: unknown; close: unknown; receiptRows: unknown[];
}): MonthlyCost[] {
  const draft = monthlyRecord(input.draft), close = monthlyRecord(input.close);
  const draftId = String(draft.draftId ?? "");
  const month = monthlyMonth(close.cycleMonth);
  if (!/^fast-purchase-draft:[a-f0-9]{20}$/.test(draftId) || close.draftId !== draftId || !Array.isArray(draft.lines) || !draft.lines.length) throw new Error("MONTHLY_PRICE_DRAFT_SCOPE_INVALID");
  const closedAt = String(close.closedAt ?? "");
  if (!Number.isFinite(Date.parse(closedAt))) throw new Error("MONTHLY_PRICE_FINAL_COST_REQUIRED");
  if (draft.savedAt && Date.parse(String(draft.savedAt)) > Date.parse(closedAt)) throw new Error("MONTHLY_PRICE_CLOSED_DRAFT_CHANGED");
  const rate = decimal(draft.exchangeRateKrwPerCny);
  const freight = decimal(close.actualCostKrw, true);
  const lines = draft.lines.map(monthlyRecord);
  const codes = new Set<string>();
  const groups = new Map<string, { quantity: number; freight: number }>();
  let productSum = 0, domesticSum = 0;
  for (const line of lines) {
    const barcode = String(line.barcode ?? "");
    if (!/^[A-Z]{3}\d+-\d+$/.test(barcode) || codes.has(barcode)) throw new Error("MONTHLY_PRICE_DRAFT_BARCODE_CONFLICT");
    codes.add(barcode);
    const quantity = monthlyMoney(line.quantity), cost = decimal(line.unitPriceCny);
    const domestic = decimal(line.domesticChinaFreightCny, true);
    const key = String(line.freightGroupId || `__${barcode}`);
    const group = groups.get(key) ?? { quantity: 0, freight: 0 };
    group.quantity += quantity; group.freight += domestic; groups.set(key, group);
    productSum += cost * quantity * rate; domesticSum += domestic * rate;
  }
  const productTotal = Math.round(productSum);
  if (productTotal <= 0 || productTotal !== monthlyMoney(close.productPurchaseCostKrw) || Math.round(domesticSum) !== monthlyMoney(close.domesticChinaFreightKrw, true)) throw new Error("MONTHLY_PRICE_CLOSED_DRAFT_CHANGED");
  const multiplier = (productTotal + freight) / productTotal;
  if (Math.abs(decimal(close.actualMultiplier) - multiplier) > 0.000051) throw new Error("MONTHLY_PRICE_CLOSED_COST_CONFLICT");
  const quantities = new Map<string, number>(), ids = new Map<string, Set<string>>(), seen = new Set<string>();
  for (const raw of input.receiptRows) {
    const row = monthlyRecord(raw), result = monthlyRecord(row.result_snapshot), event = monthlyRecord(row.input_snapshot), payload = monthlyRecord(event.payload);
    const code = String(result.barcode ?? ""), receiptId = String(result.receiptId ?? "");
    if (result.draftId !== draftId || result.cycleMonth !== month || event.sourceRunId !== draftId || event.barcode !== code || payload.receiptId !== receiptId || payload.draftId !== draftId || payload.cycleMonth !== month || event.sourceSystem !== "fast-purchase-mvp" || !["RECEIVED", "PARTIALLY_RECEIVED"].includes(String(event.status)) || !codes.has(code) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(receiptId)) throw new Error("MONTHLY_PRICE_RECEIPT_IDENTITY_CONFLICT");
    const key = `${receiptId}:${code}`;
    if (seen.has(key)) throw new Error("MONTHLY_PRICE_RECEIPT_DUPLICATE");
    seen.add(key);
    const quantity = monthlyMoney(result.receivedNow);
    if (result.receiptCost) {
      const captured = monthlyRecord(result.receiptCost);
      // receiptCost is a point-in-time receipt snapshot. Older receipts can
      // legitimately contain the provisional pre-close purchase cost (for
      // example before the 1688 service fee was reconciled). Once the immutable
      // paid-order draft and final forwarder close agree, that stronger evidence
      // rebases the landed cost. Preserve/validate receipt identity and quantity,
      // but never require its historical unitCostKrw to equal the rebased cost.
      monthlyMoney(captured.unitCostKrw);
      if (
        captured.id !== `china-receipt:${receiptId}:${code}` ||
        captured.receiptId !== receiptId ||
        captured.barcode !== code ||
        Number(captured.quantity) !== quantity
      ) throw new Error("MONTHLY_PRICE_CAPTURED_COST_CONFLICT");
    }
    if (payload.receivedNow !== undefined && Number(payload.receivedNow) !== quantity) throw new Error("MONTHLY_PRICE_RECEIPT_QUANTITY_CONFLICT");
    quantities.set(code, (quantities.get(code) ?? 0) + quantity);
    const receipts = ids.get(code) ?? new Set<string>(); receipts.add(receiptId); ids.set(code, receipts);
  }
  return lines.map((line) => {
    const barcode = String(line.barcode), quantity = monthlyMoney(line.quantity);
    if (quantities.get(barcode) !== quantity) throw new Error("MONTHLY_PRICE_RECEIPT_INCOMPLETE");
    const group = groups.get(String(line.freightGroupId || `__${barcode}`))!;
    const unitCostKrw = Math.round(decimal(line.unitPriceCny) * rate * multiplier + (group.freight / group.quantity) * rate);
    monthlyMoney(unitCostKrw);
    return { barcode, unitCostKrw, quantity, draftId, cycleMonth: month, closedAt, receiptIds: [...ids.get(barcode)!].sort(), provenance: "CONFIRMED_RECEIPT_AND_CLOSED_COST" as const };
  }).sort((a, b) => a.barcode.localeCompare(b.barcode));
}

export function monthlyProtectedCosts(current: MonthlyCost[], history: MonthlyCost[]) {
  return new Map(current.map((cost) => [cost.barcode, Math.max(cost.unitCostKrw, ...history.filter((row) => row.barcode === cost.barcode && row.provenance === "CONFIRMED_RECEIPT_AND_CLOSED_COST").map((row) => row.unitCostKrw))]));
}
export function monthlyValidateObservation(value: unknown, goodsKey: string, now = Date.now()): MonthlyObservation {
  const input = monthlyRecord(value);
  const time = Number(input.observedAt);
  let url: URL;
  try { url = new URL(String(input.pageUrl)); } catch { throw new Error("MONTHLY_PRICE_BROWSER_IDENTITY_INVALID"); }
  if (input.goodsKey !== goodsKey || url.origin !== "https://a.shopling.co.kr" || url.pathname !== "/prod/prodShopInfo.phtml" || url.searchParams.get("mode") !== "price_chg" || url.searchParams.get("prod_id") !== goodsKey || !Number.isFinite(time) || time > now + 5000 || now - time > 30_000) throw new Error("MONTHLY_PRICE_BROWSER_EVIDENCE_STALE");
  if (!Array.isArray(input.rows) || !input.rows.length || input.rows.length > 100) throw new Error("MONTHLY_PRICE_BROWSER_ROWS_REQUIRED");
  const rows = input.rows.map((raw) => {
    const row = monthlyRecord(raw), mallKey = String(row.mallKey ?? ""), source = String(row.source ?? "");
    if (!/^SMALL_\d{5}$/.test(mallKey) || !["header", "input_name"].includes(source)) throw new Error("MONTHLY_PRICE_BROWSER_MAPPING_AMBIGUOUS");
    return { mallKey, source, sellPrice: monthlyMoney(row.sellPrice, true), purchasePrice: monthlyMoney(row.purchasePrice, true), consumerPrice: monthlyMoney(row.consumerPrice, true) };
  });
  return { goodsKey, pageUrl: url.href, observedAt: time, rows };
}
function priceValues(row: Record<string, unknown>): PriceValues {
  return { sellPrice: monthlyMoney(row.sale_price), purchasePrice: monthlyMoney(row.org_price, true), consumerPrice: monthlyMoney(row.list_price, true) };
}
function samePrices(a: PriceValues, b: PriceValues) {
  return a.sellPrice === b.sellPrice && a.purchasePrice === b.purchasePrice && a.consumerPrice === b.consumerPrice;
}
function optionPresentation(value: unknown, single: boolean) {
  const normalized = String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  const source = normalized || (single ? "단품" : "");
  if (!source) throw new Error("MONTHLY_PRICE_OPTION_NAME_REQUIRED");
  const parts = source.split(/\s*\/\s*/).filter(Boolean);
  if (parts.length !== 1) throw new Error("MONTHLY_PRICE_OPTION_MULTI_DIMENSION_REVIEW_REQUIRED");
  if (source === "단품") return { optionName: source, optionTitle: "단품", optionValue: "단품" };
  const index = source.search(/[:：]/);
  const optionTitle = index >= 0 ? source.slice(0, index).trim() : "옵션";
  const optionValue = index >= 0 ? source.slice(index + 1).trim() : source;
  if (!optionTitle || !optionValue || /[,，]/.test(optionTitle) || /[,，]/.test(optionValue)) throw new Error("MONTHLY_PRICE_OPTION_NAME_AMBIGUOUS");
  return { optionName: source, optionTitle, optionValue };
}
export function monthlyLiveProduct(candidate: MonthlyPriceCandidate, rows: Record<string, unknown>[]): MonthlyLiveProduct {
  if (!rows.length || rows.some((row) => String(row.goods_key) !== candidate.goodsKey)) throw new Error("MONTHLY_PRICE_LIVE_PRODUCT_REQUIRED");
  const expected = [...candidate.options.map((row) => row.optionId)].sort();
  const actual = rows.map((row) => String(row.optId ?? "")).sort();
  if (new Set(expected).size !== expected.length || JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error("MONTHLY_PRICE_OPTION_SCOPE_CONFLICT");
  const prices = priceValues(rows[0]);
  const candidateByOption = new Map(candidate.options.map((row) => [row.optionId, row]));
  const options = rows.map((row) => {
    if (!samePrices(prices, priceValues(row))) throw new Error("MONTHLY_PRICE_BASE_PRICE_CONFLICT");
    const saleStatus = String(row.sale_status).trim().toUpperCase();
    // Shopling: B=판매중, C=품절. Sold-out listings still need the same
    // protected price maintenance so that a later restock resumes at the
    // correct price. Waiting/stopped/ended/deleted listings stay excluded.
    if (!["B", "C"].includes(saleStatus)) throw new Error("MONTHLY_PRICE_INACTIVE_LISTING");
    const optionId = String(row.optId ?? "");
    const mapped = candidateByOption.get(optionId);
    if (!mapped) throw new Error("MONTHLY_PRICE_OPTION_SCOPE_CONFLICT");
    const barcode = String(row.optPtnOptCd ?? "").trim();
    if (!barcode || barcode !== mapped.barcode) throw new Error("MONTHLY_PRICE_OPTION_BARCODE_CONFLICT");
    const amount = monthlyMoney(row.optAmt ?? 0, true);
    const presentation = optionPresentation(row.optionName, rows.length === 1);
    return {
      optionId,
      barcode,
      optionBarcode: String(row.optBarcode ?? "").trim(),
      ...presentation,
      amount,
      finalSellPrice: prices.sellPrice + amount,
    };
  });
  if (new Set(options.map((row) => row.optionTitle)).size !== 1 || new Set(options.map((row) => row.optionValue)).size !== options.length) throw new Error("MONTHLY_PRICE_OPTION_NAME_AMBIGUOUS");
  return { prices, options };
}
export function resolveMonthlyPriceGroup(
  candidate: MonthlyPriceCandidate,
  liveRows: Record<string, unknown>[],
  observed: MonthlyObservation,
  registeredGroup?: unknown,
): MonthlyPriceGroupResolution {
  const registered = normalizeInternalPriceGroup(registeredGroup);
  if (registered) return { group: registered, source: "EXACT" };

  const live = monthlyLiveProduct(candidate, liveRows);
  const liveById = new Map(live.options.map((row) => [row.optionId, row]));
  const ratios = candidate.options.map((option) => {
    const current = liveById.get(option.optionId);
    const cost = Number(option.protectedCostKrw) * Number(option.unitsPerOrder);
    return current && Number.isFinite(cost) && cost > 0 ? current.finalSellPrice / cost : NaN;
  });
  const inferred = inferLegacyInternalPriceFamily({
    mallKeys: observed.rows.map((row) => row.mallKey),
    priceRatios: ratios,
  });
  return inferred
    ? { group: inferred.fallbackGroup, source: inferred.source }
    : { group: null, source: "UNRESOLVED" };
}

export function monthlyMallPrices(observation: MonthlyObservation, mallKey: string): PriceValues {
  const rows = observation.rows.filter((row) => row.mallKey === mallKey);
  if (!rows.length || rows.some((row) => row.sellPrice <= 0)) throw new Error("MONTHLY_PRICE_MALL_CURRENT_PRICE_REQUIRED");
  if (rows.some((row) => !samePrices(row, rows[0]))) throw new Error("MONTHLY_PRICE_MALL_ACCOUNT_CONFLICT");
  return { sellPrice: rows[0].sellPrice, purchasePrice: rows[0].purchasePrice, consumerPrice: rows[0].consumerPrice };
}
function sameOptionAmounts(current: MonthlyLiveOption[], target: MonthlyOptionPriceTarget[], side: "before" | "target") {
  if (current.length !== target.length) return false;
  const currentById = new Map(current.map((row) => [row.optionId, row]));
  return target.every((row) => {
    const live = currentById.get(row.optionId);
    if (!live || live.barcode !== row.barcode || live.optionTitle !== row.optionTitle || live.optionValue !== row.optionValue) return false;
    const amount = side === "before" ? row.beforeAmount : row.targetAmount;
    const final = side === "before" ? row.beforeFinalSellPrice : row.targetFinalSellPrice;
    return live.amount === amount && live.finalSellPrice === final;
  });
}
export function buildMonthlyPricePlan(
  candidate: MonthlyPriceCandidate,
  liveRows: Record<string, unknown>[],
  observed: MonthlyObservation,
  planOptions: {
    restrictMallKeys?: Iterable<string>;
    groupResolution?: "EXACT" | "MALL_FAMILY" | "PRICE_RATIO";
  } = {},
): MonthlyPricePlan {
  if (candidate.reason || !/^\d{5,9}$/.test(candidate.goodsKey) || !candidate.options.length) throw new Error(candidate.reason || "MONTHLY_PRICE_MAPPING_REQUIRED");
  const group = normalizeInternalPriceGroup(candidate.productGroup);
  if (!group) throw new Error("MONTHLY_PRICE_GROUP_REQUIRED");
  const live = monthlyLiveProduct(candidate, liveRows);
  const liveById = new Map(live.options.map((row) => [row.optionId, row]));
  const optionPolicy = candidate.options.map((row) => {
    monthlyMoney(row.currentCostKrw); monthlyMoney(row.protectedCostKrw); monthlyMoney(row.unitsPerOrder);
    if (row.protectedCostKrw < row.currentCostKrw) throw new Error("MONTHLY_PRICE_COST_PROTECTION_INVALID");
    const current = liveById.get(row.optionId);
    if (!current || current.barcode !== row.barcode) throw new Error("MONTHLY_PRICE_OPTION_SCOPE_CONFLICT");
    const policyTargetSellPrice = monthlyMoney(internalPriceGroupTarget({ latestCostKrw: row.protectedCostKrw, unitsPerOrder: row.unitsPerOrder, productGroup: group }));
    return { row, current, policyTargetSellPrice, protectedFinal: Math.max(current.finalSellPrice, policyTargetSellPrice) };
  });
  const targetBaseSellPrice = Math.max(live.prices.sellPrice, Math.min(...optionPolicy.map((row) => row.protectedFinal)));
  monthlyMoney(targetBaseSellPrice);
  const options: MonthlyOptionPriceTarget[] = optionPolicy.map(({ row, current, policyTargetSellPrice, protectedFinal }) => {
    const targetAmount = Math.max(0, protectedFinal - targetBaseSellPrice);
    const targetFinalSellPrice = targetBaseSellPrice + targetAmount;
    if (targetFinalSellPrice < current.finalSellPrice) throw new Error("MONTHLY_PRICE_OPTION_DECREASE_FORBIDDEN");
    return {
      ...current,
      beforeAmount: current.amount,
      beforeFinalSellPrice: current.finalSellPrice,
      targetAmount,
      targetFinalSellPrice,
      policyTargetSellPrice,
      amount: targetAmount,
      finalSellPrice: targetFinalSellPrice,
      barcode: row.barcode,
    };
  });
  let protectedDecreaseCount = optionPolicy.filter((row) => row.policyTargetSellPrice < row.current.finalSellPrice).length;
  const baseWrite: MonthlyPriceWrite = {
    mallKey: null,
    before: live.prices,
    target: { ...live.prices, sellPrice: targetBaseSellPrice },
    options,
  };
  const all: MonthlyPriceWrite[] = [baseWrite];
  const groupTarget = monthlyMoney(Math.min(...optionPolicy.map((row) => row.policyTargetSellPrice)));
  const restrictedMallKeys = planOptions.restrictMallKeys ? new Set(planOptions.restrictMallKeys) : null;
  for (const mall of buildInternalMallPriceTargets({ productGroup: group, groupTargetPrice: groupTarget })) {
    if (restrictedMallKeys && !restrictedMallKeys.has(mall.mallKey)) continue;
    const before = monthlyMallPrices(observed, mall.mallKey);
    monthlyMoney(mall.targetPrice);
    protectedDecreaseCount += Number(mall.targetPrice < before.sellPrice);
    all.push({ mallKey: mall.mallKey, before, target: { ...before, sellPrice: Math.max(before.sellPrice, mall.targetPrice) } });
  }
  const optionChangeCount = options.filter((row) => row.targetAmount !== row.beforeAmount).length;
  const writes = all.filter((row) => row.mallKey
    ? row.target.sellPrice > row.before.sellPrice
    : row.target.sellPrice > row.before.sellPrice || (row.options ?? []).some((option) => option.targetAmount !== option.beforeAmount));
  const stable: Omit<MonthlyPricePlan, "fingerprint"> = {
    policy: MONTHLY_PRICE_POLICY,
    goodsKey: candidate.goodsKey,
    productGroup: group,
    groupResolution: planOptions.groupResolution ?? "EXACT",
    optionIds: candidate.options.map((row) => row.optionId).sort(),
    targets: all,
    writes,
    protectedDecreaseCount,
    optionChangeCount,
  };
  return { ...stable, fingerprint: monthlyHash(stable) };
}
export function assertMonthlyWritePreimage(write: MonthlyPriceWrite, current: PriceValues, currentOptions: MonthlyLiveOption[] = []) {
  const optionTarget = write.options ?? [];
  const targetOptionsMatch = !optionTarget.length || sameOptionAmounts(currentOptions, optionTarget, "target");
  if (samePrices(current, write.target) && targetOptionsMatch) return "ALREADY_APPLIED" as const;
  const beforeOptionsMatch = !optionTarget.length || sameOptionAmounts(currentOptions, optionTarget, "before");
  const baseIncrease = write.target.sellPrice > write.before.sellPrice;
  const optionChange = optionTarget.some((row) => row.targetAmount !== row.beforeAmount);
  if (!samePrices(current, write.before) || !beforeOptionsMatch || (!baseIncrease && !optionChange) || write.target.sellPrice < current.sellPrice || write.target.purchasePrice !== current.purchasePrice || write.target.consumerPrice !== current.consumerPrice || optionTarget.some((row) => row.targetFinalSellPrice < row.beforeFinalSellPrice || row.targetAmount < 0)) throw new Error("MONTHLY_PRICE_CURRENT_PRICE_CHANGED");
  return "WRITE" as const;
}
export function verifyMonthlyPricePlan(plan: MonthlyPricePlan, candidate: MonthlyPriceCandidate, liveRows: Record<string, unknown>[], observed: MonthlyObservation) {
  const live = monthlyLiveProduct(candidate, liveRows);
  for (const target of plan.targets) {
    const current = target.mallKey ? monthlyMallPrices(observed, target.mallKey) : live.prices;
    if (!samePrices(current, target.target)) throw new Error("MONTHLY_PRICE_READBACK_MISMATCH");
    if (!target.mallKey && target.options && !sameOptionAmounts(live.options, target.options, "target")) throw new Error("MONTHLY_PRICE_OPTION_READBACK_MISMATCH");
  }
  return true;
}
