import { zipSync, zlibSync } from "fflate";
import { createCode128Layout } from "./code128.ts";
import { getManagedBCodeValue } from "./barcodeValue.ts";
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

interface FreightForwarderLabelTextImage {
  width: number;
  height: number;
  compressedRgbBytes: Uint8Array;
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

    const barcodeValue = getManagedBCodeValue(item.barcode);
    if (!item.barcode?.trim()) {
      excludedRows.push({ rowNo, reason: "B코드 미배정" });
      continue;
    }
    if (!barcodeValue) {
      excludedRows.push({ rowNo, reason: "유효한 B코드 아님" });
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
  const barcodeValue = getManagedBCodeValue(item.barcode);
  if (!barcodeValue) throw new Error("Managed B-code is required to build freight-forwarder MVP PDF.");

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
  const modelNameText = item.modelName?.trim() || item.matchedModelName?.trim() || item.matchedProductNameKo?.trim() || "-";
  const modelNoText = item.modelNo?.trim() || item.matchedModelNo?.trim() || "-";
  const labelTextLines = [
    { text: originText, y: 80 },
    { text: barcodeValue, y: 36 },
    { text: bundleUnitText, y: 25 },
    { text: modelNameText, y: 14 },
    { text: modelNoText, y: 3 },
  ];
  const labelTextImage = buildBrowserLabelTextImage(labelTextLines);
  const labelTextContent = labelTextImage
    ? [
        "q",
        `${FREIGHT_FORWARDER_LOGICAL_WIDTH_PT} 0 0 ${FREIGHT_FORWARDER_MVP_WIDTH_PT} 0 0 cm`,
        "/Im1 Do",
        "Q",
      ]
    : [
        buildUnicodeLabelTextCommand(originText, 80),
        buildUnicodeLabelTextCommand(barcodeValue, 36),
        buildUnicodeLabelTextCommand(bundleUnitText, 25),
        buildUnicodeLabelTextCommand(modelNameText, 14),
        buildUnicodeLabelTextCommand(modelNoText, 3),
      ];
  const rotatedContent = [...labelTextContent, bars].join("\n");
  const content = [
    "q",
    // Rotate the label artwork clockwise inside the unchanged 90 x 147pt page.
    // Logical y becomes physical x, leaving the full 90pt label width for six stacked rows.
    "0 -1 1 0 0 147 cm",
    rotatedContent,
    "Q",
  ].join("\n");

  return buildPdfDocument(content, labelTextImage);
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

function buildPdfDocument(
  content: string,
  labelTextImage: FreightForwarderLabelTextImage | null,
): Uint8Array {
  const streamLength = new TextEncoder().encode(content).length;
  const imageResource = labelTextImage ? " /XObject << /Im1 8 0 R >>" : "";
  const objects: Uint8Array[] = [
    asciiBytes("1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n"),
    asciiBytes("2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n"),
    asciiBytes(`3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 ${FREIGHT_FORWARDER_MVP_WIDTH_PT} ${FREIGHT_FORWARDER_MVP_HEIGHT_PT}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >>${imageResource} >> /Contents 7 0 R >> endobj\n`),
    asciiBytes("4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n"),
    asciiBytes("5 0 obj << /Type /Font /Subtype /Type0 /BaseFont /HYGoThic-Medium /Encoding /UniKS-UCS2-H /DescendantFonts [6 0 R] >> endobj\n"),
    asciiBytes("6 0 obj << /Type /Font /Subtype /CIDFontType0 /BaseFont /HYGoThic-Medium /CIDSystemInfo << /Registry (Adobe) /Ordering (Korea1) /Supplement 2 >> /DW 1000 >> endobj\n"),
    asciiBytes(`7 0 obj << /Length ${streamLength} >> stream\n${content}\nendstream endobj\n`),
  ];
  if (labelTextImage) {
    objects.push(
      concatBytes([
        asciiBytes(`8 0 obj << /Type /XObject /Subtype /Image /Width ${labelTextImage.width} /Height ${labelTextImage.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${labelTextImage.compressedRgbBytes.length} >> stream\n`),
        labelTextImage.compressedRgbBytes,
        asciiBytes("\nendstream endobj\n"),
      ]),
    );
  }

  const header = asciiBytes("%PDF-1.4\n");
  let offset = header.length;
  const xrefOffsets = ["0000000000 65535 f "];
  for (const object of objects) {
    xrefOffsets.push(`${String(offset).padStart(10, "0")} 00000 n `);
    offset += object.length;
  }
  const body = concatBytes(objects);
  const xrefOffset = header.length + body.length;
  const objectCount = objects.length + 1;
  const trailer = asciiBytes(`xref\n0 ${objectCount}\n${xrefOffsets.join("\n")}\ntrailer << /Size ${objectCount} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
  return concatBytes([header, body, trailer]);
}

function buildBrowserLabelTextImage(
  lines: Array<{ text: string; y: number }>,
): FreightForwarderLabelTextImage | null {
  if (typeof document === "undefined") return null;

  const renderScale = 4;
  const canvas = document.createElement("canvas");
  canvas.width = FREIGHT_FORWARDER_LOGICAL_WIDTH_PT * renderScale;
  canvas.height = FREIGHT_FORWARDER_MVP_WIDTH_PT * renderScale;
  const context = canvas.getContext("2d");
  if (!context) return null;

  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#000";
  context.font = `${LABEL_TEXT_FONT_SIZE_PT * renderScale}px Arial, "Malgun Gothic", sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "alphabetic";

  const centerX = canvas.width / 2;
  const maxWidth = LABEL_TEXT_MAX_WIDTH_PT * renderScale;
  for (const line of lines) {
    const text = normalizeUnicodeLabelText(line.text);
    const measuredWidth = Math.max(1, context.measureText(text).width);
    const horizontalScale = Math.min(1, maxWidth / measuredWidth);
    const canvasY = (FREIGHT_FORWARDER_MVP_WIDTH_PT - line.y) * renderScale;

    context.save();
    context.translate(centerX, 0);
    context.scale(horizontalScale, 1);
    context.fillText(text, 0, canvasY);
    context.restore();
  }

  const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const rgb = new Uint8Array(canvas.width * canvas.height * 3);
  for (let sourceIndex = 0, targetIndex = 0; sourceIndex < rgba.length; sourceIndex += 4) {
    rgb[targetIndex] = rgba[sourceIndex];
    rgb[targetIndex + 1] = rgba[sourceIndex + 1];
    rgb[targetIndex + 2] = rgba[sourceIndex + 2];
    targetIndex += 3;
  }

  return {
    width: canvas.width,
    height: canvas.height,
    compressedRgbBytes: zlibSync(rgb, { level: 9 }),
  };
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

function asciiBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function formatPdfNumber(value: number): string {
  return Number(value.toFixed(3)).toString();
}
