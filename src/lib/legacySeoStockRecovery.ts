const STOCK_SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/13hSSgEX5SHjoshdg89GaBdOwy4xSQjvvZB7gI_IuZ4o/export?format=csv&gid=428248334";

export const LEGACY_SEO_CONFIRMED_STOCK_MODELS = [
  "AAA012",
  "AAA030",
  "AAA031",
  "AAA032",
  "AAA034",
  "AAA037",
  "AAA038",
  "AAA039",
  "AAA040",
  "AAA042",
  "AAA043",
  "AAA044",
  "AAA048",
  "AAA049",
  "AAA057",
  "AAA058",
  "AAA059",
  "AAA065",
  "AAA068",
  "AAA069",
  "AAA071",
  "AAA074",
  "AAA074-1",
  "AAA075",
  "AAA077",
  "AAA078",
  "AAA079",
  "AAA080",
  "AAA083",
  "AAA086",
  "AAA090",
  "AAA092",
  "AAA093",
  "AAA094",
  "AAA095",
  "AAA098",
  "AAA103",
  "AAA137",
  "AAA147",
  "AAA161",
  "AAA220",
  "AAA225",
  "AAA229",
  "AAA274",
  "AAA360",
  "AAA361",
] as const;

export type LegacySeoStockTarget = {
  modelNumber: string;
  productName: string;
  productNames: string[];
  optionLabels: string[];
  orderOptions: Array<Record<string, unknown>>;
  links: string[];
  sourceRows: number[];
  saleStatuses: string[];
};

type StockRow = {
  rowNumber: number;
  modelNumber: string;
  productName: string;
  saleOption: string;
  chinaOption: string;
  saleStatus: string;
  links: string[];
};

export function normalizeLegacySeoStockModel(value: unknown) {
  return cleanText(value).replace(/\s+/g, "").toUpperCase();
}

export async function loadLegacySeoConfirmedStockTargets(
  modelNumbers: readonly string[] = LEGACY_SEO_CONFIRMED_STOCK_MODELS,
) {
  const requested = new Set(modelNumbers.map(normalizeLegacySeoStockModel).filter(Boolean));
  if (!requested.size) return [] as LegacySeoStockTarget[];

  const response = await fetch(STOCK_SHEET_CSV_URL, {
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`LEGACY_SEO_STOCK_SHEET_HTTP_${response.status}`);
  }
  const csv = await response.text();
  if (/<!doctype html|<html/i.test(csv.slice(0, 500))) {
    throw new Error("LEGACY_SEO_STOCK_SHEET_HTML_RESPONSE");
  }
  return parseLegacySeoStockTargets(csv, requested);
}

export function parseLegacySeoStockTargets(
  csv: string,
  requestedModels: ReadonlySet<string> = new Set(LEGACY_SEO_CONFIRMED_STOCK_MODELS),
) {
  const requested = new Set(
    [...requestedModels].map(normalizeLegacySeoStockModel).filter(Boolean),
  );
  const table = parseCsv(csv);
  const groups = new Map<string, StockRow[]>();

  // Row 4 is the header. Read the full populated sheet instead of the old 1165-row cutoff.
  for (let index = 4; index < table.length; index += 1) {
    const row = table[index] ?? [];
    const modelNumber = normalizeLegacySeoStockModel(row[1]);
    if (!requested.has(modelNumber)) continue;
    const productName = cleanText(row[2]);
    if (!productName) continue;
    const sourceRow: StockRow = {
      rowNumber: index + 1,
      modelNumber,
      productName,
      saleOption: cleanText(row[4]),
      chinaOption: cleanText(row[5]),
      saleStatus: cleanText(row[7]),
      links: [row[55], row[56], row[57], row[58]]
        .map(canonicalize1688Link)
        .filter(Boolean),
    };
    const current = groups.get(modelNumber) ?? [];
    current.push(sourceRow);
    groups.set(modelNumber, current);
  }

  const targets: LegacySeoStockTarget[] = [];
  for (const modelNumber of requested) {
    const rows = groups.get(modelNumber) ?? [];
    if (!rows.length) continue;
    const base = chooseBaseRow(rows);
    const optionMap = collectOptions(rows, base);
    const optionLabels = [...optionMap.keys()];
    const finalLabels = optionLabels.length ? optionLabels : ["단품"];
    const productNames = uniqueStrings(rows.map((row) => row.productName));
    const links = uniqueStrings(rows.flatMap((row) => row.links)).slice(0, 4);
    const orderOptions = finalLabels.map((label, index) => ({
      id: `legacy-stock-${modelNumber}-${index + 1}`,
      optionName: finalLabels.length === 1 && label === "단품" ? "단품" : "옵션",
      saleOption: label,
      chinaOption: optionMap.get(label) ?? "",
      barcode: "",
      baseSalePriceKrw: 0,
      unitCostKrw: 0,
      sourceOrderItemId: null,
      source: "legacy_seo_stock_sheet_recovery_20260908",
    }));
    targets.push({
      modelNumber,
      productName: base.productName,
      productNames,
      optionLabels: finalLabels,
      orderOptions,
      links,
      sourceRows: rows.map((row) => row.rowNumber),
      saleStatuses: uniqueStrings(rows.map((row) => row.saleStatus)),
    });
  }

  return targets.sort((left, right) => left.sourceRows[0] - right.sourceRows[0]);
}

function collectOptions(rows: StockRow[], base: StockRow) {
  const optionMap = new Map<string, string>();
  for (const row of rows) {
    const labels = splitOptionLabels(row.saleOption);
    if (labels.length !== 1) continue;
    const label = labels[0];
    if (!label || isGenericOption(label)) continue;
    if (!optionMap.has(label)) optionMap.set(label, row.chinaOption);
  }
  if (optionMap.size) return optionMap;
  const baseLabels = splitOptionLabels(base.saleOption);
  for (const label of baseLabels) {
    if (!label || isGenericOption(label)) continue;
    optionMap.set(label, baseLabels.length === 1 ? base.chinaOption : "");
  }
  return optionMap;
}

function chooseBaseRow(rows: StockRow[]) {
  return [...rows].sort((left, right) => {
    const leftScore = baseRowScore(left);
    const rightScore = baseRowScore(right);
    if (leftScore !== rightScore) return rightScore - leftScore;
    return left.rowNumber - right.rowNumber;
  })[0] ?? rows[0];
}

function baseRowScore(row: StockRow) {
  let score = 0;
  if (/판매중/.test(row.saleStatus)) score += 10;
  if (row.saleOption.includes(",") || /아래\s*모든/.test(row.saleOption)) score += 6;
  if (row.productName && !row.saleOption) score += 3;
  if (normalizeForCompare(row.saleOption) === "단품") score += 2;
  return score;
}

function splitOptionLabels(value: unknown) {
  return String(value ?? "")
    .split(/[,\n]+/)
    .map(cleanText)
    .filter(Boolean);
}

function isGenericOption(value: string) {
  const compact = normalizeForCompare(value);
  return ["", "아래모든옵션", "전사이즈", "전체", "ㅁ", "미정"].includes(compact);
}

function canonicalize1688Link(value: unknown) {
  const input = String(value ?? "").trim();
  if (!input) return "";
  const offer = input.match(/detail\.1688\.com\/offer\/(\d+)\.html/i);
  if (offer) return `https://detail.1688.com/offer/${offer[1]}.html`;
  return input.split("?")[0].replace(/\/$/, "");
}

function parseCsv(input: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  row.push(field);
  rows.push(row);
  return rows;
}

function cleanText(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function normalizeForCompare(value: unknown) {
  return cleanText(value).replace(/\s+/g, "").toLowerCase();
}

function uniqueStrings(values: unknown[]) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = cleanText(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output;
}
