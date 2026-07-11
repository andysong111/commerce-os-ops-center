import { zipSync } from "fflate";
import { createCode128Layout } from "./code128";
import { getEncodedBarcodeValue } from "./barcodeValue";
import type { FreightApplication, FreightApplicationItem } from "../types/freightBarcodeRequest";

export const FREIGHT_FORWARDER_MVP_WIDTH_PT = 90;
export const FREIGHT_FORWARDER_MVP_HEIGHT_PT = 147;

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

    const printCount = item.labelPrintCount;
    if (typeof printCount !== "number" || !Number.isInteger(printCount) || printCount <= 0) {
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
  const barcodeX = 10;
  const barcodeY = 52;
  const barcodeWidth = 70;
  const barcodeHeight = 42;
  const moduleScale = barcodeWidth / layout.width;
  const bars = layout.bars
    .map((bar) => `${formatPdfNumber(barcodeX + bar.x * moduleScale)} ${barcodeY} ${formatPdfNumber(bar.width * moduleScale)} ${barcodeHeight} re f`)
    .join("\n");
  const content = [
    "BT /F1 8 Tf 15 116 Td (MADE IN CHINA) Tj ET",
    bars,
    `BT /F1 7 Tf ${formatPdfNumber(centeredTextX(barcodeValue, 7))} 38 Td (${escapePdfText(barcodeValue)}) Tj ET`,
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

function centeredTextX(value: string, fontSize: number): number {
  return Math.max(4, (FREIGHT_FORWARDER_MVP_WIDTH_PT - value.length * fontSize * 0.55) / 2);
}

function formatPdfNumber(value: number): string {
  return Number(value.toFixed(3)).toString();
}
