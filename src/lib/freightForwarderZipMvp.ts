import { zipSync } from "fflate";
import { createCode128Layout } from "./code128.ts";
import { getEncodedBarcodeValue } from "./barcodeValue.ts";
import { calculateBarcodeLabelPrint, formatBarcodeBundleUnit } from "./barcodeLabelPrint.ts";
import { getFreightApplicationNumbers } from "./freightApplicationBatch.ts";
import type { FreightApplication, FreightApplicationItem } from "../types/freightBarcodeRequest.ts";

export const FREIGHT_FORWARDER_MVP_WIDTH_PT = 90;
export const FREIGHT_FORWARDER_MVP_HEIGHT_PT = 147;
const FREIGHT_FORWARDER_LOGICAL_WIDTH_PT = 147;
const LABEL_TEXT_FONT_SIZE_PT = 10;
const LABEL_TEXT_MAX_WIDTH_PT = 137;
const LABEL_TEXT_MIN_HORIZONTAL_SCALE = 60;

export interface FreightForwarderMvpValidRow {
  item: FreightApplicationItem;
  applicationNo?: string;
  rowNo: number;
  printCount: number;
  barcodeValue: string;
}

export interface FreightForwarderMvpExcludedRow {
  applicationNo?: string;
  rowNo?: number;
  reason: string;
}

export interface FreightForwarderMvpValidationResult {
  total: number;
  validRows: FreightForwarderMvpValidRow[];
  excludedRows: FreightForwarderMvpExcludedRow[];
}

export interface FreightForwarderMvpZipResult extends FreightForwarderMvpValidationResult {
  zipFilename: string;
  folderName: string;
  applicationNos: string[];
  zipBytes: Uint8Array;
  statusMessage: string;
}

export function buildFreightForwarderMvpFilename(
  applicationNo: string,
  rowNo: number,
  printCount: number,
): string {
  return `${applicationNo}-${rowNo}번 ${printCount}개.pdf`;
}

export function sortRowsByRowNo<T extends { rowNo: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.rowNo - b.rowNo);
}

export function validateFreightForwarderMvpRows(
  items: FreightApplicationItem[],
): FreightForwarderMvpValidationResult {
  const duplicateRowNos = new Set<number>();
  const seenRowNos = new Set<number>();

  for (const item of items) {
    if (Number.isInteger(item.rowNo) && item.rowNo > 0) {
      if (seenRowNos.has(item.rowNo)) duplicateRowNos.add(item.rowNo);
      seenRowNos.add(item.rowNo);
    }
  }

  const validRows: FreightForwarderMvpValidRow[] = [];
  const excludedRows: FreightForwarderMvpExcludedRow[] = [];

  for (const item of items) {
    const rowNo = item.rowNo;
    const rowLabel = Number.isInteger(rowNo) && rowNo > 0 ? rowNo : undefined;

    if (!rowLabel) {
      excludedRows.push({ reason: "순번 없음" });
      continue;
    }
    if (duplicateRowNos.has(rowNo)) {
      excludedRows.push({ rowNo, reason: "중복 순번" });
      continue;
    }

    const barcodeValue = getEncodedBarcodeValue(item.barcode);
    if (!item.barcode?.trim()) {
      excludedRows.push({ rowNo, reason: "바코드 값 없음" });
      continue;
    }
    if (!barcodeValue) {
      excludedRows.push({ rowNo, reason: "바코드 형식 오류" });
      continue;
    }

    const { printCount } = calculateBarcodeLabelPrint({
      quantity: item.quantity,
      memo: item.memo,
      bundleUnit: item.bundleUnit,
      printCount: item.labelPrintCount,
    });
    if (!Number.isInteger(printCount) || printCount <= 0) {
      excludedRows.push({ rowNo, reason: "출력 수량 없음" });
      continue;
    }

    validRows.push({ item, rowNo, printCount, barcodeValue });
  }

  return {
    total: items.length,
    validRows: sortRowsByRowNo(validRows),
    excludedRows: [...excludedRows].sort((a, b) => (a.rowNo ?? Number.MAX_SAFE_INTEGER) - (b.rowNo ?? Number.MAX_SAFE_INTEGER)),
  };
}

export function buildFreightForwarderMvpStatusMessage(result: FreightForwarderMvpValidationResult): string {
  if (result.excludedRows.length === 0) {
    return `총 ${result.validRows.length}개 PDF 생성 완료`;
  }

  const excludedDetails = result.excludedRows
    .map((row) => `- ${row.applicationNo ? `${row.applicationNo} / ` : ""}${row.rowNo ? `${row.rowNo}번` : "순번 없음"}: ${row.reason}`)
    .join("\n");

  return `총 ${result.total}개 품목 중 ${result.validRows.length}개 PDF 생성 완료\n${result.excludedRows.length}개 제외:\n${excludedDetails}`;
}

export function buildFreightForwarderMvpPdf(item: FreightApplicationItem, printCount: number): Uint8Array {
  void printCount;
  const barcodeValue = getEncodedBarcodeValue(item.barcode);
  if (!barcodeValue) throw new Error("Valid barcode is required to build freight-forwarder MVP PDF.");

  const layout = createCode128Layout(barcodeValue);
  const barcodeX = 7;
  const barcodeY = 47;
  const barcodeWidth = 130;
  const barcodeHeight = 29;
  const moduleScale = barcodeWidth / layout.width;
  const bars = layout.bars
    .map((bar) => `${formatPdfNumber(barcodeX + bar.x * moduleScale)} ${barcodeY} ${formatPdfNumber(bar.width * moduleScale)} ${barcodeHeight} re f`)
    .join("\n");
  const originText = "MADE IN CHINA";
  const bundleUnitText = `소분단위: ${formatBarcodeBundleUnit(item)}`;
  const modelNameText = `모델명: ${item.modelName?.trim() || item.matchedModelName?.trim() || item.matchedProductNameKo?.trim() || "-"}`;
  const modelNoText = `모델번호: ${item.modelNo?.trim() || item.matchedModelNo?.trim() || "-"}`;
  const rotatedContent = [
    `BT /F1 ${LABEL_TEXT_FONT_SIZE_PT} Tf ${formatPdfNumber(centeredLogicalTextX(originText, LABEL_TEXT_FONT_SIZE_PT))} 80 Td (${originText}) Tj ET`,
    bars,
    `BT /F1 ${LABEL_TEXT_FONT_SIZE_PT} Tf ${formatPdfNumber(centeredLogicalTextX(barcodeValue, LABEL_TEXT_FONT_SIZE_PT))} 36 Td (${escapePdfText(barcodeValue)}) Tj ET`,
    buildUnicodeLabelTextCommand(bundleUnitText, 25),
    buildUnicodeLabelTextCommand(modelNameText, 14),
    buildUnicodeLabelTextCommand(modelNoText, 3),
  ].join("\n");
  const content = [
    "q",
    // Rotate the label artwork clockwise inside the unchanged 90 x 147pt page.
    // Logical y becomes physical x, leaving the full 90pt label width for six stacked rows.
    "0 -1 1 0 0 147 cm",
    rotatedContent,
    "Q",
  ].join("\n");

  return new TextEncoder().encode(buildPdfDocument(content));
}

export function buildFreightForwarderMvpZip(application: FreightApplication): FreightForwarderMvpZipResult {
  const declaredApplicationNos = getFreightApplicationNumbers(application);
  const fallbackApplicationNo =
    declaredApplicationNos.length === 1
      ? declaredApplicationNos[0]
      : application.applicationNo.trim() || "unknown";
  const groupedItems = new Map<string, FreightApplicationItem[]>();
  for (const item of application.items) {
    const applicationNo = item.applicationNo?.trim() || fallbackApplicationNo;
    const rows = groupedItems.get(applicationNo) ?? [];
    rows.push(item);
    groupedItems.set(applicationNo, rows);
  }
  if (groupedItems.size === 0) groupedItems.set(fallbackApplicationNo, []);

  const applicationNos = [...groupedItems.keys()];
  const hasMultipleApplications = applicationNos.length > 1;
  const folderName = applicationNos.length === 1
    ? applicationNos[0]
    : applicationNos.join("_");
  const files: Record<string, Uint8Array> = {};
  const validRows: FreightForwarderMvpValidRow[] = [];
  const excludedRows: FreightForwarderMvpExcludedRow[] = [];

  for (const [applicationNo, items] of groupedItems) {
    files[`${applicationNo}/`] = new Uint8Array();
    const groupValidation = validateFreightForwarderMvpRows(items);
    validRows.push(
      ...groupValidation.validRows.map((row) =>
        hasMultipleApplications ? { ...row, applicationNo } : row,
      ),
    );
    excludedRows.push(
      ...groupValidation.excludedRows.map((row) =>
        hasMultipleApplications ? { ...row, applicationNo } : row,
      ),
    );
    for (const row of groupValidation.validRows) {
      files[`${applicationNo}/${buildFreightForwarderMvpFilename(applicationNo, row.rowNo, row.printCount)}`] =
        buildFreightForwarderMvpPdf(row.item, row.printCount);
    }
  }
  const validation = { total: application.items.length, validRows, excludedRows };
  const statusMessage = buildFreightForwarderMvpStatusMessage(validation);

  return {
    ...validation,
    zipFilename: `${folderName}.zip`,
    folderName,
    applicationNos,
    zipBytes: zipSync(files),
    statusMessage:
      applicationNos.length > 1
        ? `신청서 ${applicationNos.length}건 · ${statusMessage}`
        : statusMessage,
  };
}

function buildPdfDocument(content: string): string {
  const streamLength = new TextEncoder().encode(content).length;
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n",
    `3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 ${FREIGHT_FORWARDER_MVP_WIDTH_PT} ${FREIGHT_FORWARDER_MVP_HEIGHT_PT}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 7 0 R >> endobj\n`,
    "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n",
    "5 0 obj << /Type /Font /Subtype /Type0 /BaseFont /HYGoThic-Medium /Encoding /UniKS-UCS2-H /DescendantFonts [6 0 R] >> endobj\n",
    "6 0 obj << /Type /Font /Subtype /CIDFontType0 /BaseFont /HYGoThic-Medium /CIDSystemInfo << /Registry (Adobe) /Ordering (Korea1) /Supplement 2 >> /DW 1000 >> endobj\n",
    `7 0 obj << /Length ${streamLength} >> stream\n${content}\nendstream endobj\n`,
  ];
  let offset = "%PDF-1.4\n".length;
  const xrefOffsets = ["0000000000 65535 f "];
  for (const object of objects) {
    xrefOffsets.push(`${String(offset).padStart(10, "0")} 00000 n `);
    offset += object.length;
  }
  const body = objects.join("");
  const xrefOffset = "%PDF-1.4\n".length + body.length;
  return `%PDF-1.4\n${body}xref\n0 8\n${xrefOffsets.join("\n")}\ntrailer << /Size 8 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
}

function escapePdfText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function helveticaTextWidth(value: string, fontSize: number): number {
  return [...value].reduce((total, character) => total + getHelveticaGlyphWidth(character), 0) / 1000 * fontSize;
}

function centeredLogicalTextX(value: string, fontSize: number): number {
  return (FREIGHT_FORWARDER_LOGICAL_WIDTH_PT - helveticaTextWidth(value, fontSize)) / 2;
}

function buildUnicodeLabelTextCommand(value: string, y: number): string {
  const fitted = fitUnicodeLabelText(value);
  return `BT /F2 ${LABEL_TEXT_FONT_SIZE_PT} Tf ${formatPdfNumber(fitted.horizontalScale)} Tz ${formatPdfNumber(fitted.x)} ${formatPdfNumber(y)} Td <${toUtf16BeHex(fitted.text)}> Tj ET`;
}

function fitUnicodeLabelText(value: string): {
  text: string;
  horizontalScale: number;
  x: number;
} {
  const normalized = normalizeUnicodeLabelText(value);
  const maxCharactersAtMinimumScale = Math.max(
    4,
    Math.floor(
      LABEL_TEXT_MAX_WIDTH_PT /
        (LABEL_TEXT_FONT_SIZE_PT * (LABEL_TEXT_MIN_HORIZONTAL_SCALE / 100)),
    ),
  );
  const characters = Array.from(normalized);
  const text = characters.length > maxCharactersAtMinimumScale
    ? `${characters.slice(0, maxCharactersAtMinimumScale - 3).join("")}...`
    : normalized;
  const textWidthAtFullScale = Math.max(1, Array.from(text).length * LABEL_TEXT_FONT_SIZE_PT);
  const horizontalScale = Math.max(
    LABEL_TEXT_MIN_HORIZONTAL_SCALE,
    Math.min(100, (LABEL_TEXT_MAX_WIDTH_PT / textWidthAtFullScale) * 100),
  );
  const fittedWidth = textWidthAtFullScale * (horizontalScale / 100);

  return {
    text,
    horizontalScale,
    x: (FREIGHT_FORWARDER_LOGICAL_WIDTH_PT - fittedWidth) / 2,
  };
}

function normalizeUnicodeLabelText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[^\u0000-\uFFFF]/gu, "?")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toUtf16BeHex(value: string): string {
  let hex = "";
  for (let index = 0; index < value.length; index += 1) {
    hex += value.charCodeAt(index).toString(16).padStart(4, "0").toUpperCase();
  }
  return hex;
}

function getHelveticaGlyphWidth(character: string): number {
  if (character >= "0" && character <= "9") return 556;

  switch (character) {
    case " ":
      return 278;
    case "-":
      return 333;
    case "A":
    case "B":
    case "E":
    case "S":
      return 667;
    case "C":
    case "D":
    case "H":
    case "N":
      return 722;
    case "I":
      return 278;
    case "M":
      return 833;
    case "F":
    case "K":
    case "L":
    case "P":
    case "R":
    case "T":
    case "V":
    case "X":
    case "Y":
    case "Z":
      return 611;
    case "G":
    case "O":
    case "Q":
      return 778;
    case "J":
      return 500;
    case "U":
      return 722;
    case "W":
      return 944;
    default:
      return 556;
  }
}

function formatPdfNumber(value: number): string {
  return Number(value.toFixed(3)).toString();
}
