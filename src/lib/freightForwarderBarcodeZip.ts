import { zipSync } from "fflate";
import type { FreightApplication, FreightApplicationItem } from "../types/freightBarcodeRequest.ts";
import { getEncodedBarcodeValue, isValidBarcodeValue } from "./barcodeValue.ts";

export type FreightForwarderBarcodeTemplateId = "small" | "large";

export type FreightForwarderBarcodeTemplate = {
  id: FreightForwarderBarcodeTemplateId;
  label: string;
  widthPt: number;
  heightPt: number;
};

export const FREIGHT_FORWARDER_BARCODE_TEMPLATES: FreightForwarderBarcodeTemplate[] = [
  { id: "small", label: "소형 90×147pt", widthPt: 90, heightPt: 147 },
  { id: "large", label: "대형 425.25×255pt", widthPt: 425.25, heightPt: 255 },
];

export type FreightForwarderBarcodeZipItem = {
  item: FreightApplicationItem;
  barcode: string;
  path: string;
  pdfBytes: Uint8Array<ArrayBuffer>;
};

export type FreightForwarderBarcodeZipExcludedItem = {
  item: FreightApplicationItem;
  reason: string;
};

export type FreightForwarderBarcodeZipResult = {
  fileName: string;
  zipBytes: Uint8Array;
  includedItems: FreightForwarderBarcodeZipItem[];
  excludedItems: FreightForwarderBarcodeZipExcludedItem[];
  template: FreightForwarderBarcodeTemplate;
};

const PDF_ESCAPE_PATTERN = /[\\()]/g;
const encoder = new TextEncoder();

export function getFreightForwarderBarcodeTemplate(
  templateId: FreightForwarderBarcodeTemplateId,
): FreightForwarderBarcodeTemplate {
  return (
    FREIGHT_FORWARDER_BARCODE_TEMPLATES.find((template) => template.id === templateId) ??
    FREIGHT_FORWARDER_BARCODE_TEMPLATES[0]
  );
}

export function buildFreightForwarderBarcodeZip(
  application: FreightApplication,
  templateId: FreightForwarderBarcodeTemplateId,
): FreightForwarderBarcodeZipResult {
  const template = getFreightForwarderBarcodeTemplate(templateId);
  const applicationNo = sanitizePathPart(application.applicationNo || "barcode-labels");
  const includedItems: FreightForwarderBarcodeZipItem[] = [];
  const excludedItems: FreightForwarderBarcodeZipExcludedItem[] = [];
  const zipEntries: Record<string, Uint8Array> = {};
  const usedPaths = new Map<string, number>();

  for (const item of application.items) {
    const rawBarcode = item.barcode?.trim() ?? "";
    const barcode = getEncodedBarcodeValue(rawBarcode);
    if (!rawBarcode) {
      excludedItems.push({ item, reason: "바코드 미입력" });
      continue;
    }
    if (!barcode || !isValidBarcodeValue(rawBarcode)) {
      excludedItems.push({ item, reason: "바코드 형식 오류" });
      continue;
    }

    const pdfBytes = createFreightForwarderBarcodePdf({ barcode, item, template });
    const path = getUniquePath(
      `${applicationNo}/${formatRowPrefix(item)}-${sanitizePathPart(barcode)}.pdf`,
      usedPaths,
    );
    zipEntries[path] = pdfBytes;
    includedItems.push({ item, barcode, path, pdfBytes });
  }

  const report = buildReport({ application, includedItems, excludedItems, template });
  zipEntries[`${applicationNo}/검증-제외-리포트.txt`] = encoder.encode(report);

  return {
    fileName: `${applicationNo}.zip`,
    zipBytes: zipSync(zipEntries),
    includedItems,
    excludedItems,
    template,
  };
}

export function createFreightForwarderBarcodePdf({
  barcode,
  item,
  template,
}: {
  barcode: string;
  item: FreightApplicationItem;
  template: FreightForwarderBarcodeTemplate;
}): Uint8Array<ArrayBuffer> {
  const width = template.widthPt;
  const height = template.heightPt;
  const fontSize = template.id === "small" ? 11 : 28;
  const secondaryFontSize = template.id === "small" ? 7 : 14;
  const barcodeHeight = Math.max(24, height * 0.42);
  const barcodeWidth = Math.min(width * 0.78, barcode.length * fontSize * 0.72);
  const barcodeX = (width - barcodeWidth) / 2;
  const barcodeY = (height - barcodeHeight) / 2;
  const safeProductInfo = [item.matchedModelNo, item.orderNo, item.trackingNo]
    .map((value) => sanitizeLatinPdfText(value))
    .filter(Boolean)
    .join(" / ");

  const lines = [
    "q",
    "1 1 1 rg",
    `0 0 ${formatNumber(width)} ${formatNumber(height)} re f`,
    "0 0 0 rg",
    `${formatNumber(barcodeX)} ${formatNumber(barcodeY)} ${formatNumber(barcodeWidth)} ${formatNumber(barcodeHeight)} re f`,
    "BT",
    `/F1 ${formatNumber(fontSize)} Tf`,
    `${formatNumber(centerTextX(barcode, width, fontSize))} ${formatNumber(Math.max(8, barcodeY - fontSize * 1.4))} Td`,
    `(${escapePdfString(barcode)}) Tj`,
    "ET",
  ];

  if (safeProductInfo) {
    lines.push(
      "BT",
      `/F1 ${formatNumber(secondaryFontSize)} Tf`,
      `${formatNumber(centerTextX(safeProductInfo, width, secondaryFontSize))} ${formatNumber(height - secondaryFontSize * 1.8)} Td`,
      `(${escapePdfString(safeProductInfo)}) Tj`,
      "ET",
    );
  }

  lines.push("Q");
  return buildSinglePagePdf(lines.join("\n"), width, height);
}

function buildSinglePagePdf(content: string, width: number, height: number): Uint8Array<ArrayBuffer> {
  const objects = [
    "",
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${formatNumber(width)} ${formatNumber(height)}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Length ${byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  const chunks = ["%PDF-1.4\n%\xE2\xE3\xCF\xD3\n"];
  const offsets = [0];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = byteLength(chunks.join(""));
    chunks.push(`${id} 0 obj\n${objects[id]}\nendobj\n`);
  }
  const xrefOffset = byteLength(chunks.join(""));
  chunks.push(`xref\n0 ${objects.length}\n0000000000 65535 f \n`);
  for (let id = 1; id < objects.length; id += 1) {
    chunks.push(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  }
  chunks.push(`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
  return encoder.encode(chunks.join(""));
}

function buildReport({
  application,
  includedItems,
  excludedItems,
  template,
}: {
  application: FreightApplication;
  includedItems: FreightForwarderBarcodeZipItem[];
  excludedItems: FreightForwarderBarcodeZipExcludedItem[];
  template: FreightForwarderBarcodeTemplate;
}): string {
  return [
    `신청번호: ${application.applicationNo || "-"}`,
    `템플릿: ${template.label}`,
    `생성 PDF: ${includedItems.length}개`,
    `제외 품목: ${excludedItems.length}개`,
    "",
    "[생성 파일]",
    ...includedItems.map(({ item, path }) => `${item.rowNo}행 ${path}`),
    "",
    "[제외 품목]",
    ...(excludedItems.length
      ? excludedItems.map(({ item, reason }) => `${item.rowNo}행 ${reason}`)
      : ["없음"]),
  ].join("\n");
}

function sanitizeLatinPdfText(value?: string): string {
  return (value ?? "").replace(/[^\x20-\x7E]/g, "").trim();
}

function sanitizePathPart(value: string): string {
  return value.trim().replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ") || "barcode-labels";
}

function formatRowPrefix(item: FreightApplicationItem): string {
  return `${String(item.rowNo || 0).padStart(2, "0")}행`;
}

function getUniquePath(path: string, usedPaths: Map<string, number>): string {
  const count = usedPaths.get(path) ?? 0;
  usedPaths.set(path, count + 1);
  if (count === 0) return path;
  return path.replace(/\.pdf$/i, `-${count + 1}.pdf`);
}

function centerTextX(text: string, pageWidth: number, fontSize: number): number {
  return Math.max(2, (pageWidth - text.length * fontSize * 0.6) / 2);
}

function escapePdfString(value: string): string {
  return value.replace(PDF_ESCAPE_PATTERN, "\\$&");
}

function formatNumber(value: number): string {
  return Number(value.toFixed(3)).toString();
}

function byteLength(value: string): number {
  return encoder.encode(value).length;
}
