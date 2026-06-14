import type { ProductMasterItem } from "../types/productMaster.ts";

export const PRODUCT_MASTER_EXPORT_HEADERS = [
  "modelNo",
  "modelName",
  "optionName",
  "barcode",
  "origin",
  "displayName",
  "memo",
] as const;

export type ProductMasterImportField =
  (typeof PRODUCT_MASTER_EXPORT_HEADERS)[number];

export type ProductMasterImportRow = Record<ProductMasterImportField, string>;

export interface ProductMasterImportIssue {
  rowNumber: number;
  modelNo?: string;
  messages: string[];
  row: ProductMasterImportRow;
}

export interface ProductMasterImportWarning {
  rowNumber: number;
  modelNo?: string;
  message: string;
}

export interface ProductMasterImportValidationResult {
  validItems: ProductMasterItem[];
  invalidRows: ProductMasterImportIssue[];
  warnings: ProductMasterImportWarning[];
  duplicateModelNos: string[];
  summary: {
    totalRows: number;
    validCount: number;
    invalidCount: number;
    warningCount: number;
    duplicateCount: number;
  };
}

const DEFAULT_ORIGIN = "MADE IN CHINA";

const HEADER_ALIASES: Record<ProductMasterImportField, string[]> = {
  modelNo: [
    "modelNo",
    "model_no",
    "모델번호",
    "모델 No",
    "모델NO",
    "모델명번호",
  ],
  modelName: ["modelName", "model_name", "모델명", "상품명"],
  optionName: ["optionName", "option_name", "옵션명", "옵션", "색상", "규격"],
  barcode: ["barcode", "바코드", "상품바코드", "barcodeNo"],
  origin: ["origin", "원산지", "제조국", "madeIn"],
  displayName: [
    "displayName",
    "display_name",
    "표시명",
    "노출명",
    "작업명",
  ],
  memo: ["memo", "메모", "비고", "note"],
};

function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLocaleLowerCase("ko-KR")
    .replace(/[\s_-]+/g, "");
}

const FIELD_BY_HEADER = new Map<string, ProductMasterImportField>(
  Object.entries(HEADER_ALIASES).flatMap(([field, aliases]) =>
    aliases.map((alias) => [
      normalizeHeader(alias),
      field as ProductMasterImportField,
    ]),
  ),
);

function parseCsvRecords(csvText: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < csvText.length; index += 1) {
    const character = csvText[index];

    if (character === '"') {
      if (quoted && csvText[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (character === "," && !quoted) {
      record.push(value.trim());
      value = "";
      continue;
    }

    if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && csvText[index + 1] === "\n") index += 1;
      record.push(value.trim());
      if (record.some((cell) => cell.length > 0)) records.push(record);
      record = [];
      value = "";
      continue;
    }

    value += character;
  }

  record.push(value.trim());
  if (record.some((cell) => cell.length > 0)) records.push(record);
  return records;
}

export function parseProductMasterCsv(csvText: string): ProductMasterImportRow[] {
  const [headers = [], ...records] = parseCsvRecords(csvText);
  const fields = headers.map((header) => FIELD_BY_HEADER.get(normalizeHeader(header)));

  return records.map((record) => {
    const row = Object.fromEntries(
      PRODUCT_MASTER_EXPORT_HEADERS.map((field) => [field, ""]),
    ) as unknown as ProductMasterImportRow;

    fields.forEach((field, index) => {
      if (field) row[field] = (record[index] ?? "").trim();
    });
    return row;
  });
}

function createImportId(row: ProductMasterImportRow, rowNumber: number): string {
  const optionPart = row.optionName
    .toLocaleLowerCase("ko-KR")
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${row.modelNo.toLocaleLowerCase("ko-KR")}-${optionPart || rowNumber}`;
}

export function validateProductMasterImport(
  rows: ProductMasterImportRow[],
): ProductMasterImportValidationResult {
  const modelNoCounts = new Map<string, number>();
  rows.forEach((row) => {
    const normalized = row.modelNo.toLocaleLowerCase("ko-KR");
    if (normalized) modelNoCounts.set(normalized, (modelNoCounts.get(normalized) ?? 0) + 1);
  });

  const duplicateModelNos = Array.from(modelNoCounts)
    .filter(([, count]) => count > 1)
    .map(([modelNo]) => modelNo);
  const duplicateSet = new Set(duplicateModelNos);
  const validItems: ProductMasterItem[] = [];
  const invalidRows: ProductMasterImportIssue[] = [];
  const warnings: ProductMasterImportWarning[] = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const messages: string[] = [];
    const normalizedModelNo = row.modelNo.toLocaleLowerCase("ko-KR");

    if (!row.modelNo) messages.push("modelNo is required.");
    if (!row.modelName && !row.displayName) {
      messages.push("modelName or displayName is required.");
    }
    if (normalizedModelNo && duplicateSet.has(normalizedModelNo)) {
      messages.push(`Duplicate modelNo: ${row.modelNo}`);
    }

    if (messages.length > 0) {
      invalidRows.push({ rowNumber, modelNo: row.modelNo || undefined, messages, row });
      return;
    }

    const origin = row.origin || DEFAULT_ORIGIN;
    if (!row.origin) {
      warnings.push({
        rowNumber,
        modelNo: row.modelNo,
        message: `origin was empty and defaulted to ${DEFAULT_ORIGIN}.`,
      });
    }

    validItems.push({
      id: createImportId(row, rowNumber),
      modelNo: row.modelNo,
      modelName: row.modelName || row.displayName,
      optionName: row.optionName,
      barcode: row.barcode || undefined,
      origin,
      displayName: row.displayName || row.modelName,
      memo: row.memo || undefined,
    });
  });

  return {
    validItems,
    invalidRows,
    warnings,
    duplicateModelNos,
    summary: {
      totalRows: rows.length,
      validCount: validItems.length,
      invalidCount: invalidRows.length,
      warningCount: warnings.length,
      duplicateCount: duplicateModelNos.length,
    },
  };
}

function escapeCsvValue(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function toExportRow(item: ProductMasterItem): ProductMasterImportRow {
  return {
    modelNo: item.modelNo,
    modelName: item.modelName,
    optionName: item.optionName,
    barcode: item.barcode ?? "",
    origin: item.origin ?? "",
    displayName: item.displayName,
    memo: item.memo ?? "",
  };
}

export function exportProductMasterCsv(items: ProductMasterItem[]): string {
  return [
    PRODUCT_MASTER_EXPORT_HEADERS.join(","),
    ...items.map((item) =>
      PRODUCT_MASTER_EXPORT_HEADERS.map((field) =>
        escapeCsvValue(toExportRow(item)[field]),
      ).join(","),
    ),
  ].join("\n");
}

export function exportProductMasterJson(items: ProductMasterItem[]): string {
  return JSON.stringify(items.map(toExportRow), null, 2);
}
