import { zipSync } from "fflate";
import { createCode128Layout } from "./code128";
import { getEncodedBarcodeValue } from "./barcodeValue";
import { calculateBarcodeLabelPrint } from "./barcodeLabelPrint";
import type { FreightApplication, FreightApplicationItem } from "../types/freightBarcodeRequest";

export const FREIGHT_FORWARDER_MVP_WIDTH_PT = 90;
export const FREIGHT_FORWARDER_MVP_HEIGHT_PT = 147;
const FREIGHT_FORWARDER_LOGICAL_WIDTH_PT = 147;

export interface FreightForwarderMvpValidRow {
  item: FreightApplicationItem;
  rowNo: number;
  printCount: number;
  barcodeValue: string;
}

export interface FreightForwarderMvpExcludedRow {
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
    .map((row) => `- ${row.rowNo ? `${row.rowNo}번` : "순번 없음"}: ${row.reason}`)
    .join("\n");

  return `총 ${result.total}개 품목 중 ${result.validRows.length}개 PDF 생성 완료\n${result.excludedRows.length}개 제외:\n${excludedDetails}`;
}

export function buildFreightForwarderMvpPdf(item: FreightApplicationItem, printCount: number): Uint8Array {
  void printCount;
  const barcodeValue = getEncodedBarcodeValue(item.barcode);
  if (!barcodeValue) throw new Error("Valid barcode is required to build freight-forwarder MVP PDF.");

  const layout = createCode128Layout(barcodeValue);
  const barcodeX = 7;
  const barcodeY = 41;
  const barcodeWidth = 133;
  const barcodeHeight = 64;
  const moduleScale = barcodeWidth / layout.width;
  const bars = layout.bars
    .map((bar) => `${formatPdfNumber(barcodeX + bar.x * moduleScale)} ${barcodeY} ${formatPdfNumber(bar.width * moduleScale)} ${barcodeHeight} re f`)
    .join("\n");
  const originText = "MADE IN CHINA";
  const originFontSize = 9;
  const barcodeTextFontSize = 9;
  const rotatedContent = [
    `BT /F1 ${originFontSize} Tf ${formatPdfNumber(centeredLogicalTextX(originText, originFontSize))} ${formatPdfNumber(107)} Td (${originText}) Tj ET`,
    bars,
    `BT /F1 ${barcodeTextFontSize} Tf ${formatPdfNumber(centeredLogicalTextX(barcodeValue, barcodeTextFontSize))} ${formatPdfNumber(30)} Td (${escapePdfText(barcodeValue)}) Tj ET`,
  ].join("\n");
  const content = [
    "q",
    // Rotate the enlarged vector barcode artwork clockwise inside the unchanged 90 x 147pt page.
    // Matrix: x' = y - 28, y' = -x + 147 keeps the barcode outer bounds at x=13..77, y=7..140.
    "0 -1 1 0 -28 147 cm",
    rotatedContent,
    "Q",
  ].join("\n");

  return new TextEncoder().encode(buildPdfDocument(content));
}

export function buildFreightForwarderMvpZip(application: FreightApplication): FreightForwarderMvpZipResult {
  const applicationNo = application.applicationNo.trim() || "unknown";
  const validation = validateFreightForwarderMvpRows(application.items);
  const folderName = applicationNo;
  const files: Record<string, Uint8Array> = { [`${folderName}/`]: new Uint8Array() };

  for (const row of validation.validRows) {
    files[`${folderName}/${buildFreightForwarderMvpFilename(applicationNo, row.rowNo, row.printCount)}`] =
      buildFreightForwarderMvpPdf(row.item, row.printCount);
  }

  return {
    ...validation,
    zipFilename: `${applicationNo}.zip`,
    folderName,
    zipBytes: zipSync(files),
    statusMessage: buildFreightForwarderMvpStatusMessage(validation),
  };
}

function buildPdfDocument(content: string): string {
  const streamLength = new TextEncoder().encode(content).length;
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n",
    `3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 ${FREIGHT_FORWARDER_MVP_WIDTH_PT} ${FREIGHT_FORWARDER_MVP_HEIGHT_PT}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj\n`,
    "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n",
    `5 0 obj << /Length ${streamLength} >> stream\n${content}\nendstream endobj\n`,
  ];
  let offset = "%PDF-1.4\n".length;
  const xrefOffsets = ["0000000000 65535 f "];
  for (const object of objects) {
    xrefOffsets.push(`${String(offset).padStart(10, "0")} 00000 n `);
    offset += object.length;
  }
  const body = objects.join("");
  const xrefOffset = "%PDF-1.4\n".length + body.length;
  return `%PDF-1.4\n${body}xref\n0 6\n${xrefOffsets.join("\n")}\ntrailer << /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
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
