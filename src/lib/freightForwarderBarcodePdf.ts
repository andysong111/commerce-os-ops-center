import { zipSync } from "fflate";
import { createCode128Layout } from "@/lib/code128";
import type { FreightApplicationItem } from "@/types/freightBarcodeRequest";

export type FreightForwarderBarcodePdfSize = "small" | "large";

export interface FreightForwarderBarcodePdfOptions {
  size?: FreightForwarderBarcodePdfSize;
}

export interface FreightForwarderBarcodeZipOptions extends FreightForwarderBarcodePdfOptions {
  applicationNo?: string;
}

export const FREIGHT_FORWARDER_BARCODE_PDF_SIZES = {
  small: { widthPt: mmToPt(50), heightPt: mmToPt(30) },
  large: { widthPt: mmToPt(100), heightPt: mmToPt(60) },
} as const;

const PDF_ESCAPE_PATTERN = /[\\()]/g;
const SAFE_FILENAME_PATTERN = /[^A-Za-z0-9._-]+/g;
const DEFAULT_SIZE: FreightForwarderBarcodePdfSize = "small";

export function createFreightForwarderBarcodePdf(
  item: Pick<FreightApplicationItem, "rowNo" | "barcode" | "quantity">,
  options: FreightForwarderBarcodePdfOptions = {},
): Uint8Array<ArrayBuffer> {
  const barcode = normalizeBarcodeValue(item.barcode);
  if (!barcode) throw new Error("바코드 값이 있는 품목만 PDF로 생성할 수 있습니다.");

  const size = resolvePdfSize(options.size);
  const page = FREIGHT_FORWARDER_BARCODE_PDF_SIZES[size];
  const content = buildSafeBarcodePageContent({
    barcode,
    rowNo: item.rowNo,
    quantity: item.quantity,
    width: page.widthPt,
    height: page.heightPt,
    size,
  });
  const objects: string[] = [];
  const catalogId = 1;
  const pagesId = 2;
  const fontId = 3;
  const pageId = 4;
  const contentId = 5;

  objects[catalogId] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId] = `<< /Type /Pages /Kids [${pageId} 0 R] /Count 1 >>`;
  objects[fontId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  objects[pageId] = `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${formatNumber(page.widthPt)} ${formatNumber(page.heightPt)}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`;
  objects[contentId] = `<< /Length ${byteLength(content)} >>\nstream\n${content}\nendstream`;

  return buildPdf(objects, catalogId);
}

export function createFreightForwarderBarcodeZip(
  items: FreightApplicationItem[],
  options: FreightForwarderBarcodeZipOptions = {},
): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  const seenNames = new Map<string, number>();

  for (const item of items) {
    const barcode = normalizeBarcodeValue(item.barcode);
    if (!barcode) continue;

    const baseName = buildFreightForwarderBarcodePdfFilename(item, options.applicationNo);
    const filename = dedupeFilename(baseName, seenNames);
    entries[filename] = createFreightForwarderBarcodePdf(item, options);
  }

  return zipSync(entries);
}

export function buildFreightForwarderBarcodePdfFilename(
  item: Pick<FreightApplicationItem, "rowNo" | "barcode">,
  applicationNo?: string,
): string {
  const prefix = applicationNo ? `${sanitizeFilenamePart(applicationNo)}_` : "";
  const rowNo = Number.isFinite(item.rowNo) ? String(item.rowNo).padStart(2, "0") : "item";
  const barcode = sanitizeFilenamePart(normalizeBarcodeValue(item.barcode) || "no-barcode");
  return `${prefix}item-${rowNo}_${barcode}.pdf`;
}

function buildSafeBarcodePageContent({
  barcode,
  rowNo,
  quantity,
  width,
  height,
  size,
}: {
  barcode: string;
  rowNo: number;
  quantity: number;
  width: number;
  height: number;
  size: FreightForwarderBarcodePdfSize;
}): string {
  const scale = size === "large" ? 1.75 : 1;
  const margin = 8 * scale;
  const titleSize = 9 * scale;
  const valueSize = 8 * scale;
  const metaSize = 5.5 * scale;
  const barcodeAreaWidth = width - margin * 2;
  const layout = createCode128Layout(barcode);
  const moduleWidth = barcodeAreaWidth / layout.width;
  const barHeight = Math.min(height * 0.42, 28 * scale);
  const barY = height * 0.34;
  const barCommands = layout.bars.map((bar) => {
    const x = margin + bar.x * moduleWidth;
    return `${formatNumber(x)} ${formatNumber(barY)} ${formatNumber(Math.max(bar.width * moduleWidth, 0.4))} ${formatNumber(barHeight)} re f`;
  });

  return [
    "q",
    "1 1 1 rg",
    `0 0 ${formatNumber(width)} ${formatNumber(height)} re f`,
    "0 0 0 rg",
    ...centerText("MADE IN CHINA", titleSize, width, height - margin - titleSize),
    ...barCommands,
    ...centerText(barcode, valueSize, width, barY - valueSize - 3 * scale),
    ...centerText(`ROW ${rowNo || "-"}  QTY ${sanitizeAsciiText(String(quantity || "-"))}`, metaSize, width, margin),
    "Q",
  ].join("\n");
}

function centerText(text: string, fontSize: number, pageWidth: number, y: number): string[] {
  const safeText = sanitizeAsciiText(text);
  const x = Math.max(0, (pageWidth - estimateHelveticaBoldWidth(safeText, fontSize)) / 2);
  return ["BT", `/F1 ${formatNumber(fontSize)} Tf`, `${formatNumber(x)} ${formatNumber(y)} Td`, `(${escapePdfString(safeText)}) Tj`, "ET"];
}

function buildPdf(objects: string[], catalogId: number): Uint8Array<ArrayBuffer> {
  const maxObjectId = objects.length - 1;
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

function resolvePdfSize(size: FreightForwarderBarcodePdfSize | undefined): FreightForwarderBarcodePdfSize {
  return size && size in FREIGHT_FORWARDER_BARCODE_PDF_SIZES ? size : DEFAULT_SIZE;
}

function normalizeBarcodeValue(value: unknown): string {
  return typeof value === "string" ? sanitizeAsciiText(value).trim() : "";
}

function sanitizeAsciiText(value: string): string {
  return [...value].filter((char) => {
    const codePoint = char.codePointAt(0) ?? 0;
    return codePoint >= 32 && codePoint <= 126;
  }).join("");
}

function dedupeFilename(filename: string, seenNames: Map<string, number>): string {
  const count = seenNames.get(filename) ?? 0;
  seenNames.set(filename, count + 1);
  if (count === 0) return filename;
  return filename.replace(/\.pdf$/i, `-${count + 1}.pdf`);
}

function sanitizeFilenamePart(value: string): string {
  return sanitizeAsciiText(value).trim().replace(SAFE_FILENAME_PATTERN, "-").replace(/^-+|-+$/g, "") || "item";
}

function estimateHelveticaBoldWidth(text: string, fontSize: number): number {
  let units = 0;
  for (const char of text) {
    if (char === "-") units += 333;
    else if (/[0-9]/.test(char)) units += 556;
    else if (/[A-Z]/.test(char)) units += 722;
    else if (/[a-z]/.test(char)) units += 556;
    else units += 300;
  }
  return (units / 1000) * fontSize;
}

function mmToPt(mm: number): number {
  return (mm / 25.4) * 72;
}

function escapePdfString(value: string): string {
  return value.replace(PDF_ESCAPE_PATTERN, "\\$&");
}

function formatNumber(value: number): string {
  return Number(value.toFixed(3)).toString();
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}
