import { zipSync } from "fflate";
import { buildBarcodeLabelPages, calculateBarcodeLabelPrint } from "./barcodeLabelPrint";
import { BARCODE_ORIGIN_LABEL, getEncodedBarcodeValue } from "./barcodeValue";
import { createCode128Layout } from "./code128";
import type { FreightApplication, FreightApplicationItem } from "../types/freightBarcodeRequest";

export const SMALL_BARCODE_LABEL_SIZE_PT = { width: 90, height: 147 } as const;
export const LARGE_BARCODE_LABEL_SIZE_PT = { width: 425.25, height: 255 } as const;

const PDF_ESCAPE_PATTERN = /[\\()]/g;
const NON_LATIN_TEXT_PATTERN = /[^\u0020-\u007E]/g;

export function buildFreightBarcodePdfZip(application: FreightApplication): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  const folderName = buildFreightZipFolderName(application.applicationNo);

  for (const item of application.items) {
    const barcodeValue = getEncodedBarcodeValue(item.barcode);
    if (!barcodeValue) continue;

    const calculation = calculateBarcodeLabelPrint({
      quantity: item.quantity,
      memo: item.memo,
      bundleUnit: item.bundleUnit,
      printCount: item.labelPrintCount,
    });
    const filename = buildFreightBarcodePdfFilename({
      applicationNo: application.applicationNo,
      rowNo: item.rowNo,
      printCount: calculation.printCount,
    });
    entries[`${folderName}/${filename}`] = createFreightBarcodeItemPdf(item, calculation.printCount);
  }

  return zipSync(entries, { level: 6 });
}

export function buildFreightZipFolderName(applicationNo: string): string {
  return sanitizePathSegment(applicationNo.trim() || "신청번호없음");
}

export function buildFreightBarcodePdfFilename({
  applicationNo,
  rowNo,
  printCount,
}: {
  applicationNo: string;
  rowNo: number;
  printCount: number;
}): string {
  return `${sanitizePathSegment(applicationNo.trim() || "신청번호없음")}-${rowNo}번 ${printCount}개.pdf`;
}

export function createFreightBarcodeItemPdf(
  item: FreightApplicationItem,
  printCount = calculateBarcodeLabelPrint({
    quantity: item.quantity,
    memo: item.memo,
    bundleUnit: item.bundleUnit,
    printCount: item.labelPrintCount,
  }).printCount,
): Uint8Array {
  const pages = buildBarcodeLabelPages([{ ...item, printCount }]);
  const objects: string[] = [];
  const pageObjectIds: number[] = [];
  const catalogId = 1;
  const pagesId = 2;
  const fontId = 3;

  objects[catalogId] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[fontId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";

  pages.forEach((page, index) => {
    const pageId = 4 + index * 2;
    const contentId = pageId + 1;
    pageObjectIds.push(pageId);
    const content = buildFreightBarcodePageContent(page.item, page.labelNumber, page.printCount);
    objects[pageId] = `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${LARGE_BARCODE_LABEL_SIZE_PT.width} ${LARGE_BARCODE_LABEL_SIZE_PT.height}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${byteLength(content)} >>\nstream\n${content}\nendstream`;
  });

  objects[pagesId] = `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageObjectIds.length} >>`;
  return writePdf(objects, Math.max(pagesId, fontId, ...pageObjectIds, ...pageObjectIds.map((id) => id + 1)), catalogId);
}

function buildFreightBarcodePageContent(item: FreightApplicationItem, labelNumber: number, printCount: number): string {
  const barcodeValue = getEncodedBarcodeValue(item.barcode) ?? "";
  const layout = createCode128Layout(barcodeValue);
  const scale = 330 / layout.width;
  const left = 47;
  const top = 70;
  const bars = layout.bars.map((bar) => `${formatNumber(left + bar.x * scale)} ${formatNumber(top)} ${formatNumber(bar.width * scale)} 78 re f`);
  const productLine = latinPdfText([item.modelNo, item.displayName || item.itemName, item.optionName || item.optionText].filter(Boolean).join(" / "));

  return [
    "q",
    "1 1 1 rg 0 0 425.25 255 re f",
    "0 0 0 rg",
    ...bars,
    textLine(BARCODE_ORIGIN_LABEL, 48, 178, 18),
    textLine(barcodeValue, 48, 154, 15),
    textLine(`Item ${item.rowNo} (${labelNumber}/${printCount})`, 48, 34, 11),
    productLine ? textLine(productLine, 48, 20, 8) : "",
    "Q",
  ].filter(Boolean).join("\n");
}

function textLine(value: string, x: number, y: number, size: number): string {
  return `BT /F1 ${size} Tf ${x} ${y} Td (${escapePdfString(value)}) Tj ET`;
}

function latinPdfText(value: string): string {
  return value.replace(NON_LATIN_TEXT_PATTERN, "").replace(/\s+/g, " ").trim();
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "_").trim() || "신청번호없음";
}

function escapePdfString(value: string): string {
  return value.replace(PDF_ESCAPE_PATTERN, "\\$&");
}

function writePdf(objects: string[], maxObjectId: number, catalogId: number): Uint8Array {
  const chunks = ["%PDF-1.4\n%\xE2\xE3\xCF\xD3\n"];
  const offsets = [0];
  for (let id = 1; id <= maxObjectId; id += 1) {
    offsets[id] = byteLength(chunks.join(""));
    chunks.push(`${id} 0 obj\n${objects[id]}\nendobj\n`);
  }
  const xrefOffset = byteLength(chunks.join(""));
  chunks.push(`xref\n0 ${maxObjectId + 1}\n0000000000 65535 f \n`);
  for (let id = 1; id <= maxObjectId; id += 1) chunks.push(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  chunks.push(`trailer\n<< /Size ${maxObjectId + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
  return new TextEncoder().encode(chunks.join(""));
}

function formatNumber(value: number): string {
  return Number(value.toFixed(3)).toString();
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}
