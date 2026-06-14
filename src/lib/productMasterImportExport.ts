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

export const DEFAULT_PRODUCT_ORIGIN = "MADE IN CHINA";

export type ProductMasterImportField =
  (typeof PRODUCT_MASTER_EXPORT_HEADERS)[number];

export type ProductMasterImportRow = Record<ProductMasterImportField, string>;

export interface ParsedProductMasterRow {
  rowNumber: number;
  values: ProductMasterImportRow;
}

export interface ProductMasterImportIssue {
  rowNumber: number;
  modelNo?: string;
  messages: string[];
}

export interface ProductMasterImportWarning {
  rowNumbers: number[];
  modelNo?: string;
  message: string;
}

export interface ProductMasterImportSummary {
  totalRows: number;
  validCount: number;
  invalidCount: number;
  warningCount: number;
  duplicateCount: number;
}

export interface ProductMasterImportValidationResult {
  validItems: ProductMasterItem[];
  invalidRows: ProductMasterImportIssue[];
  warnings: ProductMasterImportWarning[];
  duplicateModelNos: string[];
  summary: ProductMasterImportSummary;
}

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

function emptyImportRow(): ProductMasterImportRow {
  return {
    modelNo: "",
    modelName: "",
    optionName: "",
    barcode: "",
    origin: "",
    displayName: "",
    memo: "",
  };
}

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
      record.push(value);
      value = "";
      continue;
    }

    if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && csvText[index + 1] === "\n") index += 1;
      record.push(value);
      records.push(record);
      record = [];
      value = "";
      continue;
    }

    value += character;
  }

  record.push(value);
  records.push(record);
  return records;
}

export function parseProductMasterCsv(
  csvText: string,
): ParsedProductMasterRow[] {
  const records = parseCsvRecords(csvText);
  const headerIndex = records.findIndex((record) =>
    record.some((value) => value.trim()),
  );
  if (headerIndex === -1) return [];

  const fields = records[headerIndex].map((header) =>
    FIELD_BY_HEADER.get(normalizeHeader(header)),
  );

  return records
    .slice(headerIndex + 1)
    .map((record, index) => ({
      rowNumber: headerIndex + index + 2,
      values: record.reduce((row, value, columnIndex) => {
        const field = fields[columnIndex];
        if (field && !row[field]) row[field] = value.trim();
        return row;
      }, emptyImportRow()),
    }))
    .filter(({ values }) =>
      PRODUCT_MASTER_EXPORT_HEADERS.some((field) => values[field]),
    );
}

function createImportId(
  row: ProductMasterImportRow,
  rowNumber: number,
): string {
  const optionKey = row.optionName || "default";
  return `${row.modelNo}-${optionKey}-${rowNumber}`
    .toLocaleLowerCase("ko-KR")
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function validateProductMasterImport(
  rows: ParsedProductMasterRow[],
): ProductMasterImportValidationResult {
  const invalidRows: ProductMasterImportIssue[] = [];
  const validItems: ProductMasterItem[] = [];
  const rowsByModelNo = new Map<
    string,
    { modelNo: string; rowNumbers: number[] }
  >();

  for (const { rowNumber, values } of rows) {
    const messages: string[] = [];
    if (!values.modelNo) messages.push("modelNo is required.");
    if (!values.modelName && !values.displayName) {
      messages.push("modelName or displayName is required.");
    }

    if (messages.length > 0) {
      invalidRows.push({
        rowNumber,
        modelNo: values.modelNo || undefined,
        messages,
      });
      continue;
    }

    const normalizedModelNo = values.modelNo.toLocaleLowerCase("ko-KR");
    const duplicate = rowsByModelNo.get(normalizedModelNo);
    if (duplicate) {
      duplicate.rowNumbers.push(rowNumber);
    } else {
      rowsByModelNo.set(normalizedModelNo, {
        modelNo: values.modelNo,
        rowNumbers: [rowNumber],
      });
    }

    validItems.push({
      id: createImportId(values, rowNumber),
      modelNo: values.modelNo,
      modelName: values.modelName || values.displayName,
      optionName: values.optionName,
      barcode: values.barcode || undefined,
      origin: values.origin || DEFAULT_PRODUCT_ORIGIN,
      displayName: values.displayName || values.modelName,
      memo: values.memo || undefined,
    });
  }

  const duplicateEntries = Array.from(rowsByModelNo.values()).filter(
    ({ rowNumbers }) => rowNumbers.length > 1,
  );
  const duplicateModelNos = duplicateEntries.map(({ modelNo }) => modelNo);
  const warnings = duplicateEntries.map(({ modelNo, rowNumbers }) => ({
    modelNo,
    rowNumbers,
    message: `Duplicate modelNo "${modelNo}" appears on rows ${rowNumbers.join(", ")}.`,
  }));

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

export function previewProductMasterCsv(
  csvText: string,
): ProductMasterImportValidationResult {
  return validateProductMasterImport(parseProductMasterCsv(csvText));
}

function escapeCsvValue(value: string): string {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
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

export function exportProductMasterItemsToCsv(
  items: ProductMasterItem[],
): string {
  const lines = [
    PRODUCT_MASTER_EXPORT_HEADERS.join(","),
    ...items.map((item) => {
      const row = toExportRow(item);
      return PRODUCT_MASTER_EXPORT_HEADERS.map((field) =>
        escapeCsvValue(row[field]),
      ).join(",");
    }),
  ];
  return lines.join("\n");
}

export function exportProductMasterItemsToJson(
  items: ProductMasterItem[],
): string {
  return JSON.stringify(items.map(toExportRow), null, 2);
}
