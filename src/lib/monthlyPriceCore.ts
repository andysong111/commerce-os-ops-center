import { createHash } from "node:crypto";
import {
  buildInternalMallPriceTargets,
  internalPriceGroupTarget,
  normalizeInternalPriceGroup,
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
export type MonthlyPriceOption = { barcode: string; optionId: string; unitsPerOrder: number; currentCostKrw: number; protectedCostKrw: number };
export type MonthlyPriceCandidate = {
  goodsKey: string; productName: string; productGroup: string;
  inventoryCostBasis: "LEGACY_MIXED_UNRESOLVED" | "UNKNOWN_COST";
  options: MonthlyPriceOption[]; reason: string | null;
};
export type MonthlyOptionAmount = {
  optionId: string;
  before: number;
  target: number;
  currentEffectivePrice: number;
  targetEffectivePrice: number;
};
export type MonthlyPriceWrite = {
  mallKey: string | null;
  before: PriceValues;
  target: PriceValues;
  optionAmounts?: MonthlyOptionAmount[];
};
export type MonthlyPricePlan = {
  policy: typeof MONTHLY_PRICE_POLICY; goodsKey: string; productGroup: string;
  optionIds: string[]; targets: MonthlyPriceWrite[]; writes: MonthlyPriceWrite[];
  protectedDecreaseCount: number; fingerprint: string;
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
      const line = lines.find((item) => item.barcode === code)!;
      const group = groups.get(String(line.freightGroupId || `__${code}`))!;
      const purchaseCost = Math.round((decimal(line.unitPriceCny) + group.freight / group.quantity) * rate);
      if (captured.id !== `china-receipt:${receiptId}:${code}` || captured.receiptId !== receiptId || captured.barcode !== code || Number(captured.quantity) !== quantity || Number(captured.unitCostKrw) !== purchaseCost) throw new Error("MONTHLY_PRICE_CAPTURED_COST_CONFLICT");
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
function liveState(candidate: MonthlyPriceCandidate, rows: Record<string, unknown>[]) {
  if (!rows.length || rows.some((row) => String(row.goods_key) !== candidate.goodsKey)) throw new Error("MONTHLY_PRICE_LIVE_PRODUCT_REQUIRED");
  const expected = [...candidate.options.map((row) => row.optionId)].sort();
  const actual = rows.map((row) => String(row.optId ?? "")).sort();
  if (new Set(expected).size !== expected.length || JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error("MONTHLY_PRICE_OPTION_SCOPE_CONFLICT");
  const base = priceValues(rows[0]);
  const amounts = new Map<string, number>();
  for (const row of rows) {
    if (!samePrices(base, priceValues(row))) throw new Error("MONTHLY_PRICE_BASE_PRICE_CONFLICT");
    if (String(row.sale_status).trim().toUpperCase() !== "B") throw new Error("MONTHLY_PRICE_INACTIVE_LISTING");
    const optionId = String(row.optId ?? "");
    const amount = monthlyMoney(row.optAmt ?? 0, true);
    if (amounts.has(optionId)) throw new Error("MONTHLY_PRICE_OPTION_SCOPE_CONFLICT");
    amounts.set(optionId, amount);
  }
  return {
    base,
    optionAmounts: candidate.options
      .map((row) => ({ optionId: row.optionId, amount: amounts.get(row.optionId) }))
      .map((row) => {
        if (row.amount === undefined) throw new Error("MONTHLY_PRICE_OPTION_SCOPE_CONFLICT");
        return { optionId: row.optionId, amount: row.amount };
      })
      .sort((a, b) => a.optionId.localeCompare(b.optionId)),
  };
}
export function monthlyLiveProduct(candidate: MonthlyPriceCandidate, rows: Record<string, unknown>[]) {
  return liveState(candidate, rows).base;
}
export function monthlyLiveOptionAmounts(candidate: MonthlyPriceCandidate, rows: Record<string, unknown>[]) {
  return liveState(candidate, rows).optionAmounts;
}
export function monthlyMallPrices(observation: MonthlyObservation, mallKey: string): PriceValues {
  const rows = observation.rows.filter((row) => row.mallKey === mallKey);
  if (!rows.length || rows.some((row) => row.sellPrice <= 0)) throw new Error("MONTHLY_PRICE_MALL_CURRENT_PRICE_REQUIRED");
  if (rows.some((row) => !samePrices(row, rows[0]))) throw new Error("MONTHLY_PRICE_MALL_ACCOUNT_CONFLICT");
  return { sellPrice: rows[0].sellPrice, purchasePrice: rows[0].purchasePrice, consumerPrice: rows[0].consumerPrice };
}
export function buildMonthlyPricePlan(candidate: MonthlyPriceCandidate, liveRows: Record<string, unknown>[], observed: MonthlyObservation): MonthlyPricePlan {
  if (candidate.reason || !/^\d{5,9}$/.test(candidate.goodsKey) || !candidate.options.length) throw new Error(candidate.reason || "MONTHLY_PRICE_MAPPING_REQUIRED");
  const group = normalizeInternalPriceGroup(candidate.productGroup);
  if (!group) throw new Error("MONTHLY_PRICE_GROUP_REQUIRED");
  const live = liveState(candidate, liveRows);
  const base = live.base;
  const beforeByOption = new Map(live.optionAmounts.map((row) => [row.optionId, row.amount]));
  const costTargets = candidate.options.map((row) => {
    monthlyMoney(row.currentCostKrw); monthlyMoney(row.protectedCostKrw); monthlyMoney(row.unitsPerOrder);
    if (row.protectedCostKrw < row.currentCostKrw) throw new Error("MONTHLY_PRICE_COST_PROTECTION_INVALID");
    const target = internalPriceGroupTarget({ latestCostKrw: row.protectedCostKrw, unitsPerOrder: row.unitsPerOrder, productGroup: group });
    return { optionId: row.optionId, target: monthlyMoney(target) };
  });
  // Shopling stores one base sale_price plus one shared option surcharge vector.
  // Use the cheapest verified option target as the base floor, then raise each
  // option surcharge only when its own protected-cost target requires it.
  // Existing option surcharges are never reduced, so every option's effective
  // price is monotonic even when legacy stock/cost is unresolved.
  const desiredBase = Math.min(...costTargets.map((row) => row.target));
  const targetBaseSell = Math.max(base.sellPrice, monthlyMoney(desiredBase));
  const optionAmounts: MonthlyOptionAmount[] = costTargets
    .map((row) => {
      const before = beforeByOption.get(row.optionId);
      if (before === undefined) throw new Error("MONTHLY_PRICE_OPTION_SCOPE_CONFLICT");
      const required = Math.max(0, row.target - targetBaseSell);
      const target = Math.max(before, required);
      return {
        optionId: row.optionId,
        before,
        target,
        currentEffectivePrice: base.sellPrice + before,
        targetEffectivePrice: targetBaseSell + target,
      };
    })
    .sort((a, b) => a.optionId.localeCompare(b.optionId));
  if (optionAmounts.some((row) => row.target < row.before || row.targetEffectivePrice < row.currentEffectivePrice)) throw new Error("MONTHLY_PRICE_OPTION_DECREASE_BLOCKED");
  let protectedDecreaseCount = Number(desiredBase < base.sellPrice)
    + costTargets.filter((row) => row.target < base.sellPrice + (beforeByOption.get(row.optionId) ?? 0)).length;
  const productWrite: MonthlyPriceWrite = {
    mallKey: null,
    before: base,
    target: { ...base, sellPrice: targetBaseSell },
    optionAmounts,
  };
  const all: MonthlyPriceWrite[] = [productWrite];
  for (const mall of buildInternalMallPriceTargets({ productGroup: group, groupTargetPrice: desiredBase })) {
    const before = monthlyMallPrices(observed, mall.mallKey);
    monthlyMoney(mall.targetPrice);
    protectedDecreaseCount += Number(mall.targetPrice < before.sellPrice);
    // Existing display purchase/list values are preserved verbatim. They are
    // never treated as historical receipt cost and never regenerated as sale/2.
    all.push({ mallKey: mall.mallKey, before, target: { ...before, sellPrice: Math.max(before.sellPrice, mall.targetPrice) } });
  }
  const writes = all.filter((row) =>
    row.target.sellPrice > row.before.sellPrice
    || Boolean(row.optionAmounts?.some((option) => option.target > option.before))
  );
  const stable: Omit<MonthlyPricePlan, "fingerprint"> = { policy: MONTHLY_PRICE_POLICY, goodsKey: candidate.goodsKey, productGroup: group, optionIds: candidate.options.map((row) => row.optionId).sort(), targets: all, writes, protectedDecreaseCount };
  return { ...stable, fingerprint: monthlyHash(stable) };
}
function sameOptionAmounts(write: MonthlyPriceWrite, current: { optionId: string; amount: number }[], target = false) {
  if (!write.optionAmounts) return true;
  const expected = write.optionAmounts.map((row) => ({ optionId: row.optionId, amount: target ? row.target : row.before })).sort((a, b) => a.optionId.localeCompare(b.optionId));
  const actual = [...current].sort((a, b) => a.optionId.localeCompare(b.optionId));
  return JSON.stringify(expected) === JSON.stringify(actual);
}
export function assertMonthlyWritePreimage(write: MonthlyPriceWrite, current: PriceValues, currentOptions: { optionId: string; amount: number }[] = []) {
  const optionTargetsSafe = !write.optionAmounts || write.optionAmounts.every((row) => row.target >= row.before && row.targetEffectivePrice >= row.currentEffectivePrice);
  if (!optionTargetsSafe || write.target.sellPrice < write.before.sellPrice || write.target.purchasePrice !== write.before.purchasePrice || write.target.consumerPrice !== write.before.consumerPrice) throw new Error("MONTHLY_PRICE_WRITE_POLICY_VIOLATION");
  if (samePrices(current, write.target) && sameOptionAmounts(write, currentOptions, true)) return "ALREADY_APPLIED" as const;
  const hasIncrease = write.target.sellPrice > write.before.sellPrice || Boolean(write.optionAmounts?.some((row) => row.target > row.before));
  if (!samePrices(current, write.before) || !sameOptionAmounts(write, currentOptions, false) || !hasIncrease) throw new Error("MONTHLY_PRICE_CURRENT_PRICE_CHANGED");
  return "WRITE" as const;
}
export function verifyMonthlyPricePlan(plan: MonthlyPricePlan, candidate: MonthlyPriceCandidate, live: Record<string, unknown>[], observed: MonthlyObservation) {
  const base = monthlyLiveProduct(candidate, live);
  const options = monthlyLiveOptionAmounts(candidate, live);
  for (const target of plan.targets) {
    const current = target.mallKey ? monthlyMallPrices(observed, target.mallKey) : base;
    if (!samePrices(current, target.target) || (!target.mallKey && !sameOptionAmounts(target, options, true))) throw new Error("MONTHLY_PRICE_READBACK_MISMATCH");
  }
  return true;
}
