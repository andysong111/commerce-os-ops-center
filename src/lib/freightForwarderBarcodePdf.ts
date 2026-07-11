import { BARCODE_ORIGIN_LABEL, getEncodedBarcodeValue } from "./barcodeValue.ts";
import { createCode128Layout } from "./code128.ts";
import type { FreightApplicationItem } from "../types/freightBarcodeRequest.ts";

export const FREIGHT_FORWARDER_SMALL_TEMPLATE = {
  id: "small",
  label: "90×147pt",
  widthPt: 90,
  heightPt: 147,
} as const;

export const FREIGHT_FORWARDER_LARGE_TEMPLATE = {
  id: "large",
  label: "150×90mm",
  widthPt: 425.25,
  heightPt: 255,
} as const;

export type FreightForwarderBarcodeTemplateId =
  | typeof FREIGHT_FORWARDER_SMALL_TEMPLATE.id
  | typeof FREIGHT_FORWARDER_LARGE_TEMPLATE.id;

export interface FreightForwarderBarcodeLabelData {
  rowNo: number;
  barcode: string;
  barcodeText: string;
  origin: string;
  itemName?: string;
  optionText?: string;
  matchedModelNo?: string;
  matchedModelName?: string;
  matchedProductNameKo?: string;
  matchedLabelText?: string;
  templateId?: FreightForwarderBarcodeTemplateId;
}

export interface FreightForwarderBarcodePdfOptions {
  templateId?: FreightForwarderBarcodeTemplateId;
}

const PDF_ESCAPE_PATTERN = /[\\()]/g;
const NON_LATIN_PATTERN = /[^\u0009\u000a\u000d\u0020-\u007e]/;

export function containsNonLatinPdfText(value: string): boolean {
  return NON_LATIN_PATTERN.test(value);
}

export function getFreightForwarderTemplate(templateId: FreightForwarderBarcodeTemplateId = "small") {
  return templateId === "large" ? FREIGHT_FORWARDER_LARGE_TEMPLATE : FREIGHT_FORWARDER_SMALL_TEMPLATE;
}

export function buildFreightForwarderBarcodeLabelData(
  item: FreightApplicationItem,
  options: FreightForwarderBarcodePdfOptions = {},
): FreightForwarderBarcodeLabelData | null {
  const barcodeText = getEncodedBarcodeValue(item.barcode);
  if (!barcodeText) return null;

  return {
    rowNo: item.rowNo,
    barcode: item.barcode?.trim() ?? "",
    barcodeText,
    origin: item.origin?.trim() || item.matchedOriginLabel?.trim() || BARCODE_ORIGIN_LABEL,
    itemName: cleanOptionalText(item.itemName),
    optionText: cleanOptionalText(item.optionText),
    matchedModelNo: cleanOptionalText(item.matchedModelNo),
    matchedModelName: cleanOptionalText(item.matchedModelName),
    matchedProductNameKo: cleanOptionalText(item.matchedProductNameKo),
    matchedLabelText: cleanOptionalText(item.matchedLabelText),
    templateId: options.templateId,
  };
}

export function createFreightForwarderBarcodePdf(
  label: FreightForwarderBarcodeLabelData,
  options: FreightForwarderBarcodePdfOptions = {},
): Uint8Array<ArrayBuffer> {
  const template = getFreightForwarderTemplate(label.templateId ?? options.templateId);
  const objects: string[] = [];
  const catalogId = 1;
  const pagesId = 2;
  const fontId = 3;
  const pageId = 4;
  const contentId = 5;
  const content = buildPageContent(label, template.widthPt, template.heightPt);

  objects[catalogId] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId] = `<< /Type /Pages /Kids [${pageId} 0 R] /Count 1 >>`;
  objects[fontId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  objects[pageId] = `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${formatNumber(template.widthPt)} ${formatNumber(template.heightPt)}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`;
  objects[contentId] = `<< /Length ${byteLength(content)} >>\nstream\n${content}\nendstream`;

  return buildPdf(objects, contentId);
}

export function getSafePdfProductInfoLines(label: FreightForwarderBarcodeLabelData): string[] {
  return [
    label.matchedModelNo ? `MODEL: ${label.matchedModelNo}` : undefined,
    label.matchedModelName ? `SPEC: ${label.matchedModelName}` : undefined,
    label.matchedLabelText ? `PRODUCT: ${label.matchedLabelText}` : undefined,
    label.itemName ? `ITEM: ${label.itemName}` : undefined,
    label.optionText ? `OPTION: ${label.optionText}` : undefined,
  ].filter((line): line is string => Boolean(line && !containsNonLatinPdfText(line)));
}

function buildPageContent(label: FreightForwarderBarcodeLabelData, width: number, height: number): string {
  const margin = Math.max(6, Math.min(width, height) * 0.08);
  const barcodeHeight = Math.max(28, height * 0.34);
  const barcodeTop = height - margin - barcodeHeight - 14;
  const layout = createCode128Layout(label.barcodeText);
  const moduleWidth = Math.max(0.45, (width - margin * 2) / layout.width);
  const barcodeWidth = layout.width * moduleWidth;
  const barcodeX = (width - barcodeWidth) / 2;
  const lineFontSize = width < 120 ? 5.5 : 12;
  const barcodeTextFontSize = width < 120 ? 7 : 16;
  const originFontSize = width < 120 ? 7 : 15;
  const lines = getSafePdfProductInfoLines(label).slice(0, width < 120 ? 2 : 4);
  const textLines = [
    drawCenteredText(label.barcodeText, width / 2, barcodeTop - barcodeTextFontSize - 2, barcodeTextFontSize),
    drawCenteredText(label.origin, width / 2, margin, originFontSize),
    ...lines.map((line, index) => drawCenteredText(line, width / 2, barcodeTop - barcodeTextFontSize - 10 - (index + 1) * (lineFontSize + 2), lineFontSize)),
  ];

  return [
    "q",
    "1 1 1 rg",
    `0 0 ${formatNumber(width)} ${formatNumber(height)} re f`,
    "0 0 0 rg",
    ...layout.bars.map((bar) => `${formatNumber(barcodeX + bar.x * moduleWidth)} ${formatNumber(barcodeTop)} ${formatNumber(bar.width * moduleWidth)} ${formatNumber(barcodeHeight)} re f`),
    ...textLines,
    "Q",
  ].join("\n");
}

function drawCenteredText(text: string, centerX: number, y: number, fontSize: number): string {
  const safeText = escapePdfString(text);
  const estimatedWidth = text.length * fontSize * 0.58;
  return ["BT", `/F1 ${formatNumber(fontSize)} Tf`, `${formatNumber(centerX - estimatedWidth / 2)} ${formatNumber(y)} Td`, `(${safeText}) Tj`, "ET"].join("\n");
}

function cleanOptionalText(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function escapePdfString(value: string): string {
  return value.replace(PDF_ESCAPE_PATTERN, "\\$&");
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function buildPdf(objects: string[], maxObjectId: number): Uint8Array<ArrayBuffer> {
  const chunks = ["%PDF-1.4\n%\xE2\xE3\xCF\xD3\n"];
  const offsets = [0];
  for (let id = 1; id <= maxObjectId; id += 1) {
    offsets[id] = byteLength(chunks.join(""));
    chunks.push(`${id} 0 obj\n${objects[id]}\nendobj\n`);
  }
  const xrefOffset = byteLength(chunks.join(""));
  chunks.push(`xref\n0 ${maxObjectId + 1}\n0000000000 65535 f \n`);
  for (let id = 1; id <= maxObjectId; id += 1) chunks.push(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  chunks.push(`trailer\n<< /Size ${maxObjectId + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
  return new TextEncoder().encode(chunks.join(""));
}
