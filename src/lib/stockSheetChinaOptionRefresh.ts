import type { ProductLaunchTrackerState } from "@/lib/productLaunchTrackerOptimized";

type R = Record<string, unknown>;

export type StockSheetChinaOptionRow = {
  rowNumber: number;
  modelNumber: string;
  productName: string;
  saleOption: string;
  chinaOption: string;
};

type MatchResult =
  | { ok: true; value: string; sourceRows: number[]; strategy: string }
  | { ok: false; reason: "no_match" | "ambiguous"; candidates: string[]; sourceRows: number[] };

export type StockSheetChinaOptionIssue = {
  itemId: string;
  modelNumber: string;
  productName: string;
  saleOption: string;
  candidates?: string[];
  sourceRows?: number[];
};

export type StockSheetChinaOptionReport = {
  version: string;
  sourceRowCount: number;
  usableSourceRowCount: number;
  sourceModelCount: number;
  stateItemCount: number;
  matchedModelItems: number;
  changedItems: number;
  changedOptions: number;
  filledEmptyOptions: number;
  replacedPlaceholderOptions: number;
  preservedExistingOptions: number;
  noOrderOptionItems: number;
  ambiguousOptionCount: number;
  unmatchedOptionCount: number;
  sourceRowsUsed: number[];
  ambiguousOptions: StockSheetChinaOptionIssue[];
  unmatchedOptions: StockSheetChinaOptionIssue[];
};

const MAX_REPORT_DETAILS = 160;
const INVALID_SOURCE_VALUES = new Set(["", "미정", "ㅁ", "상품조합", "미입력", "확인필요", "검토필요"]);
const REPLACEABLE_EXISTING_VALUES = new Set([...INVALID_SOURCE_VALUES, "단품"]);

export function isUsableStockSheetChinaOption(value: unknown) {
  const option = text(value);
  if (!option) return false;
  const compact = normalizeOption(option);
  if (INVALID_SOURCE_VALUES.has(compact)) return false;
  const hasHangul = /[가-힣]/.test(option);
  const hasHan = /[\u3400-\u9fff]/.test(option);
  return !hasHangul || hasHan;
}

export function prepareStockSheetChinaOptionRefresh(
  stateInput: ProductLaunchTrackerState,
  rawRows: StockSheetChinaOptionRow[],
  version: string,
) {
  const state = cloneJson(stateInput);
  const items = Array.isArray(state.items) ? state.items.filter(isRecord) : [];
  const sheetRows = expandAlignedCommaOptions(rawRows);
  const rowsByModel = new Map<string, StockSheetChinaOptionRow[]>();
  for (const row of sheetRows) {
    const modelNumber = normalizeModel(row.modelNumber);
    if (!modelNumber || !isUsableStockSheetChinaOption(row.chinaOption)) continue;
    rowsByModel.set(modelNumber, [...(rowsByModel.get(modelNumber) ?? []), row]);
  }

  const sourceRowsUsed = new Set<number>();
  const changedItemIds: string[] = [];
  const report: StockSheetChinaOptionReport = {
    version,
    sourceRowCount: rawRows.length,
    usableSourceRowCount: rawRows.filter((row) => isUsableStockSheetChinaOption(row.chinaOption)).length,
    sourceModelCount: rowsByModel.size,
    stateItemCount: items.length,
    matchedModelItems: 0,
    changedItems: 0,
    changedOptions: 0,
    filledEmptyOptions: 0,
    replacedPlaceholderOptions: 0,
    preservedExistingOptions: 0,
    noOrderOptionItems: 0,
    ambiguousOptionCount: 0,
    unmatchedOptionCount: 0,
    sourceRowsUsed: [],
    ambiguousOptions: [],
    unmatchedOptions: [],
  };

  state.items = items.map((item) => {
    const modelNumber = normalizeModel(item.modelNumber);
    const candidates = rowsByModel.get(modelNumber) ?? [];
    if (!candidates.length) return item;
    report.matchedModelItems += 1;

    const currentOptions = Array.isArray(item.orderOptions)
      ? item.orderOptions.map((option) => (isRecord(option) ? { ...option } : {}))
      : [];
    if (!currentOptions.length) {
      report.noOrderOptionItems += 1;
      return item;
    }

    let itemChanged = false;
    const nextOptions = currentOptions.map((option) => {
      const existing = text(option.chinaOption);
      const saleOption = text(option.saleOption ?? option.value);
      const match = findChinaOptionMatch(text(item.productName), saleOption, currentOptions.length, candidates);

      if (match.ok === false) {
        if (!isReplaceableExisting(existing)) {
          report.preservedExistingOptions += 1;
          return option;
        }
        const issue: StockSheetChinaOptionIssue = {
          itemId: text(item.id), modelNumber, productName: text(item.productName), saleOption,
          candidates: match.candidates, sourceRows: match.sourceRows,
        };
        if (match.reason === "ambiguous") {
          report.ambiguousOptionCount += 1;
          if (report.ambiguousOptions.length < MAX_REPORT_DETAILS) report.ambiguousOptions.push(issue);
        } else {
          report.unmatchedOptionCount += 1;
          if (report.unmatchedOptions.length < MAX_REPORT_DETAILS) report.unmatchedOptions.push(issue);
        }
        return option;
      }

      if (!isReplaceableExisting(existing) || existing === match.value) {
        report.preservedExistingOptions += 1;
        return option;
      }

      itemChanged = true;
      report.changedOptions += 1;
      if (existing) report.replacedPlaceholderOptions += 1;
      else report.filledEmptyOptions += 1;
      for (const rowNumber of match.sourceRows) sourceRowsUsed.add(rowNumber);
      return { ...option, chinaOption: match.value };
    });

    if (!itemChanged) return item;
    report.changedItems += 1;
    changedItemIds.push(text(item.id));
    return { ...item, orderOptions: nextOptions, updatedAt: new Date().toISOString(), updatedBy: "승준" };
  });

  report.sourceRowsUsed = [...sourceRowsUsed].sort((left, right) => left - right);
  return { state, report, changedItemIds };
}

function expandAlignedCommaOptions(rows: StockSheetChinaOptionRow[]) {
  const expanded: StockSheetChinaOptionRow[] = [];
  for (const row of rows) {
    expanded.push(row);
    const saleOptions = splitCommaList(row.saleOption);
    const chinaOptions = splitCommaList(row.chinaOption);
    if (saleOptions.length <= 1 || saleOptions.length !== chinaOptions.length) continue;
    for (let index = 0; index < saleOptions.length; index += 1) {
      expanded.push({ ...row, saleOption: saleOptions[index], chinaOption: chinaOptions[index] });
    }
  }
  return expanded;
}

function splitCommaList(value: unknown) {
  return text(value).split(/[,，]/).map((part) => part.trim()).filter(Boolean);
}

function isReplaceableExisting(value: unknown) {
  return REPLACEABLE_EXISTING_VALUES.has(normalizeOption(value));
}

function findChinaOptionMatch(
  itemProductName: string,
  saleOption: string,
  currentOptionCount: number,
  candidates: StockSheetChinaOptionRow[],
): MatchResult {
  const itemProduct = normalizeProduct(itemProductName);
  const normalizedSaleOption = normalizeOption(saleOption);
  const exactSaleRows = normalizedSaleOption
    ? candidates.filter((row) => normalizeOption(row.saleOption) === normalizedSaleOption)
    : [];
  const rankedExactSale = selectByProductRank(exactSaleRows, itemProduct);
  if (rankedExactSale) return rankedExactSale;
  const exactSaleFallback = selectUnique(exactSaleRows, "same-model-sale-option");
  if (exactSaleFallback) return exactSaleFallback;

  if (currentOptionCount === 1) {
    const rankedSingle = selectByProductRank(candidates, itemProduct);
    if (rankedSingle) return rankedSingle;
    const modelSingle = selectUnique(candidates, "single-option-model-fallback");
    if (modelSingle) return modelSingle;
  }
  return {
    ok: false,
    reason: exactSaleRows.length ? "ambiguous" : "no_match",
    candidates: uniqueStrings(exactSaleRows.map((row) => row.chinaOption)),
    sourceRows: uniqueNumbers(exactSaleRows.map((row) => row.rowNumber)),
  };
}

function selectByProductRank(rows: StockSheetChinaOptionRow[], itemProduct: string): MatchResult | null {
  if (!rows.length || !itemProduct) return null;
  for (const rank of [3, 2, 1]) {
    const ranked = rows.filter((row) => productRank(row.productName, itemProduct) === rank);
    if (!ranked.length) continue;
    return selectUnique(ranked, `product-rank-${rank}`) ?? {
      ok: false,
      reason: "ambiguous",
      candidates: uniqueStrings(ranked.map((row) => row.chinaOption)),
      sourceRows: uniqueNumbers(ranked.map((row) => row.rowNumber)),
    };
  }
  return null;
}

function selectUnique(rows: StockSheetChinaOptionRow[], strategy: string): MatchResult | null {
  if (!rows.length) return null;
  const values = uniqueStrings(rows.map((row) => row.chinaOption));
  if (values.length !== 1) {
    return values.length ? {
      ok: false,
      reason: "ambiguous",
      candidates: values,
      sourceRows: uniqueNumbers(rows.map((row) => row.rowNumber)),
    } : null;
  }
  return {
    ok: true,
    value: values[0],
    sourceRows: uniqueNumbers(rows.filter((row) => row.chinaOption === values[0]).map((row) => row.rowNumber)),
    strategy,
  };
}

function productRank(rowProductName: string, normalizedItemProduct: string) {
  const rowProduct = normalizeProduct(rowProductName);
  if (!rowProduct || !normalizedItemProduct) return 0;
  if (rowProduct === normalizedItemProduct) return 3;
  if (rowProduct.startsWith(normalizedItemProduct)) return 2;
  if (normalizedItemProduct.startsWith(rowProduct)) return 1;
  return 0;
}

function normalizeModel(value: unknown) { return text(value).normalize("NFKC").toUpperCase().replace(/\s+/g, ""); }
function normalizeProduct(value: unknown) { return text(value).normalize("NFKC").toLowerCase().replace(/\s+/g, ""); }
function normalizeOption(value: unknown) { return text(value).normalize("NFKC").toLowerCase().replace(/\s+/g, ""); }
function uniqueStrings(values: unknown[]) { return [...new Set(values.map(text).filter(Boolean))]; }
function uniqueNumbers(values: number[]) { return [...new Set(values)].sort((left, right) => left - right); }
function cloneJson<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function isRecord(value: unknown): value is R { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function text(value: unknown) { return String(value ?? "").trim(); }
