import { zipSync } from "fflate";
import { PDFDocument, rgb, degrees, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { createCode128Layout, encodeCode128Auto } from "./code128";
import { getEncodedBarcodeValue } from "./barcodeValue";
import { calculateBarcodeLabelPrint } from "./barcodeLabelPrint";
import type { FreightApplication, FreightApplicationItem } from "../types/freightBarcodeRequest";

export const FREIGHT_FORWARDER_MVP_WIDTH_PT = 90;
export const FREIGHT_FORWARDER_MVP_HEIGHT_PT = 147;
const LOGICAL_WIDTH_PT = 147;
const GENERATED_FONT_PATH = "/generated-fonts/NotoSansKR-VF.ttf";
const NODE_MODULE_FONT_CANDIDATES = [
  "node_modules/@noto-pdf-ts/fonts-kr/NotoSansKR-VF.ttf",
  "node_modules/@noto-pdf-ts/fonts-kr/fonts/NotoSansKR-VF.ttf",
  "node_modules/@noto-pdf-ts/fonts-kr/dist/NotoSansKR-VF.ttf",
];
let cachedFontBytes: Uint8Array | undefined;

export const FREIGHT_FORWARDER_KOREAN_FONT_SOURCE = "@noto-pdf-ts/fonts-kr/NotoSansKR-VF.ttf";


export interface FreightForwarderMvpValidRow { item: FreightApplicationItem; rowNo: number; printCount: number; barcodeValue: string; }
export interface FreightForwarderMvpExcludedRow { rowNo?: number; reason: string; }
export interface FreightForwarderMvpValidationResult { total: number; validRows: FreightForwarderMvpValidRow[]; excludedRows: FreightForwarderMvpExcludedRow[]; labelWrapOccurred?: boolean; }
export interface FreightForwarderMvpZipResult extends FreightForwarderMvpValidationResult { zipFilename: string; folderName: string; zipBytes: Uint8Array; statusMessage: string; }

export function buildFreightForwarderMvpFilename(applicationNo: string, rowNo: number, printCount: number): string { return `${applicationNo}-${rowNo}번 ${printCount}개.pdf`; }
export function sortRowsByRowNo<T extends { rowNo: number }>(items: T[]): T[] { return [...items].sort((a, b) => a.rowNo - b.rowNo); }

export function validateFreightForwarderMvpRows(items: FreightApplicationItem[]): FreightForwarderMvpValidationResult {
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
    if (!rowLabel) { excludedRows.push({ reason: "순번 없음" }); continue; }
    if (duplicateRowNos.has(rowNo)) { excludedRows.push({ rowNo, reason: "중복 순번" }); continue; }
    const barcodeValue = getEncodedBarcodeValue(item.barcode);
    if (!item.barcode?.trim()) { excludedRows.push({ rowNo, reason: "바코드 값 없음" }); continue; }
    if (!barcodeValue) { excludedRows.push({ rowNo, reason: "바코드 형식 오류" }); continue; }
    const { printCount } = calculateBarcodeLabelPrint({ quantity: item.quantity, memo: item.memo, bundleUnit: item.bundleUnit, printCount: item.labelPrintCount });
    if (!Number.isInteger(printCount) || printCount <= 0) { excludedRows.push({ rowNo, reason: "출력 수량 없음" }); continue; }
    validRows.push({ item, rowNo, printCount, barcodeValue });
  }
  return { total: items.length, validRows: sortRowsByRowNo(validRows), excludedRows: [...excludedRows].sort((a, b) => (a.rowNo ?? Number.MAX_SAFE_INTEGER) - (b.rowNo ?? Number.MAX_SAFE_INTEGER)) };
}

export function buildFreightForwarderMvpStatusMessage(result: FreightForwarderMvpValidationResult): string {
  const wrapLine = result.labelWrapOccurred ? "\n라벨 문구 자동 줄바꿈 발생" : "";
  if (result.excludedRows.length === 0) return `총 ${result.validRows.length}개 PDF 생성 완료${wrapLine}`;
  const excludedDetails = result.excludedRows.map((row) => `- ${row.rowNo ? `${row.rowNo}번` : "순번 없음"}: ${row.reason}`).join("\n");
  return `총 ${result.total}개 품목 중 ${result.validRows.length}개 PDF 생성 완료${wrapLine}\n${result.excludedRows.length}개 제외:\n${excludedDetails}`;
}

export async function buildFreightForwarderMvpPdf(item: FreightApplicationItem, printCount: number): Promise<Uint8Array> {
  void printCount;
  const barcodeValue = getEncodedBarcodeValue(item.barcode);
  if (!barcodeValue) throw new Error("Valid barcode is required to build freight-forwarder MVP PDF.");
  return (await buildPdfDocument(item, barcodeValue)).pdfBytes;
}

export async function buildFreightForwarderMvpZip(application: FreightApplication): Promise<FreightForwarderMvpZipResult> {
  const applicationNo = application.applicationNo.trim() || "unknown";
  const validation = validateFreightForwarderMvpRows(application.items);
  const folderName = applicationNo;
  const files: Record<string, Uint8Array> = { [`${folderName}/`]: new Uint8Array() };
  let labelWrapOccurred = false;
  for (const row of validation.validRows) {
    const { pdfBytes, wrapped } = await buildPdfDocument(row.item, row.barcodeValue);
    labelWrapOccurred ||= wrapped;
    files[`${folderName}/${buildFreightForwarderMvpFilename(applicationNo, row.rowNo, row.printCount)}`] = pdfBytes;
  }
  const result = { ...validation, labelWrapOccurred };
  return { ...result, zipFilename: `${applicationNo}.zip`, folderName, zipBytes: zipSync(files), statusMessage: buildFreightForwarderMvpStatusMessage(result) };
}

async function buildPdfDocument(item: FreightApplicationItem, barcodeValue: string): Promise<{ pdfBytes: Uint8Array; wrapped: boolean }> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  const font = await pdfDoc.embedFont(loadKoreanFontBytes(), { subset: true });
  const page = pdfDoc.addPage([FREIGHT_FORWARDER_MVP_WIDTH_PT, FREIGHT_FORWARDER_MVP_HEIGHT_PT]);
  const layout = createCode128Layout(barcodeValue, encodeCode128Auto);
  const barcodeX = 8.16, barcodeY = 8.62, barcodeWidth = 129.84, barcodeHeight = 28.8;
  const moduleScale = barcodeWidth / layout.width;
  const label = labelLines(item);
  const product = fitLines([label[0] ?? ""], 132, 7.8, 4.8, font);
  const info = fitLines(label.slice(1), 132, 7, 4.8, font);
  const made = fitLines(["MADE IN CHINA"], 132, 6.4, 4.8, font);

  const map = (x: number, y: number) => ({ x: y, y: FREIGHT_FORWARDER_MVP_HEIGHT_PT - x });
  const rect = (x: number, y: number, width: number, height: number, color = rgb(0, 0, 0)) => {
    const p = map(x, y);
    page.drawRectangle({ x: p.x, y: p.y, width: height, height: width, rotate: degrees(-90), color });
  };
  const centered = (value: string, y: number, size: number, maxWidth: number) => {
    const width = Math.min(maxWidth, font.widthOfTextAtSize(value, size));
    const x = (LOGICAL_WIDTH_PT - width) / 2;
    const p = map(x, y);
    page.drawText(value, { x: p.x, y: p.y, size, font, rotate: degrees(-90), color: rgb(0, 0, 0) });
  };

  rect(barcodeX, barcodeY, barcodeWidth, barcodeHeight, rgb(1, 1, 1));
  for (const bar of layout.bars) rect(barcodeX + bar.x * moduleScale, barcodeY, Math.max(0.18, bar.width * moduleScale), barcodeHeight);
  centered(barcodeValue, 38.62, 12, 132);
  product.lines.forEach((line, i) => centered(line, 48.7 + i * 6.2, product.size, 132));
  info.lines.forEach((line, i) => centered(line, 55.66 + i * 5.2, info.size, 132));
  made.lines.forEach((line) => centered(line, 81.82 + (info.lines.length > 5 ? (info.lines.length - 5) * 5.2 : 0), made.size, 132));

  return { pdfBytes: await pdfDoc.save({ useObjectStreams: false }), wrapped: product.wrapped || info.wrapped };
}

function labelLines(item: FreightApplicationItem): string[] {
  const source = item.matchedLabelText || item.matchedProductNameKo || item.displayName || item.itemName || "";
  return String(source).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function fitLines(input: string[], maxWidth: number, startSize: number, minSize: number, font: PDFFont): { lines: string[]; size: number; wrapped: boolean } {
  let size = startSize;
  if (input.every((line) => font.widthOfTextAtSize(line, size) <= maxWidth)) return { lines: input, size, wrapped: false };
  while (size > minSize) {
    size = Math.max(minSize, Number((size - 0.2).toFixed(1)));
    if (input.every((line) => font.widthOfTextAtSize(line, size) <= maxWidth)) return { lines: input, size, wrapped: false };
  }
  return { lines: input.flatMap((line) => wrapLine(line, maxWidth, minSize, font)), size: minSize, wrapped: true };
}
function wrapLine(line: string, maxWidth: number, size: number, font: PDFFont): string[] { const out: string[] = []; let cur = ""; for (const ch of [...line]) { if (cur && font.widthOfTextAtSize(cur + ch, size) > maxWidth) { out.push(cur); cur = ch; } else cur += ch; } if (cur) out.push(cur); return out; }
function loadKoreanFontBytes(): Uint8Array {
  if (cachedFontBytes) return cachedFontBytes;

  const globalScope = globalThis as typeof globalThis & {
    window?: unknown;
    XMLHttpRequest?: new () => XMLHttpRequest;
  };

  if (globalScope.window && globalScope.XMLHttpRequest) {
    const request = new globalScope.XMLHttpRequest();
    request.open("GET", GENERATED_FONT_PATH, false);
    request.overrideMimeType("text/plain; charset=x-user-defined");
    request.send(null);
    if (request.status >= 200 && request.status < 300) {
      cachedFontBytes = Uint8Array.from(request.responseText, (character) => character.charCodeAt(0) & 0xff);
      return cachedFontBytes;
    }
    throw new Error(`배대지 PDF 한글 글꼴을 불러오지 못했습니다: ${GENERATED_FONT_PATH}`);
  }

  const requireFromNode = Function("return typeof require === 'function' ? require : undefined")() as
    | ((id: string) => unknown)
    | undefined;
  if (!requireFromNode) throw new Error("배대지 PDF 한글 글꼴을 불러올 수 있는 Node require가 없습니다.");

  const fs = requireFromNode("node:fs") as { existsSync(path: string): boolean; readFileSync(path: string): Uint8Array };
  const path = requireFromNode("node:path") as { join(...parts: string[]): string };
  const cwd = typeof process !== "undefined" ? process.cwd() : ".";
  const candidates = [path.join(cwd, "public", GENERATED_FONT_PATH), ...NODE_MODULE_FONT_CANDIDATES.map((candidate) => path.join(cwd, candidate))];
  const fontPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!fontPath) throw new Error(`배대지 PDF 한글 글꼴을 찾지 못했습니다. npm install 후 postinstall이 ${GENERATED_FONT_PATH} 파일을 생성했는지 확인하세요.`);

  cachedFontBytes = fs.readFileSync(fontPath);
  return cachedFontBytes;
}
