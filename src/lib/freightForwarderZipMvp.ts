import { zipSync } from "fflate";
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

export function buildFreightForwarderMvpPdf(item: FreightApplicationItem, printCount: number): Uint8Array {
  void printCount;
  const barcodeValue = getEncodedBarcodeValue(item.barcode);
  if (!barcodeValue) throw new Error("Valid barcode is required to build freight-forwarder MVP PDF.");
  const { content } = buildLogicalLabelContent(item, barcodeValue);
  return buildPdfDocument(content);
}

export function buildFreightForwarderMvpZip(application: FreightApplication): FreightForwarderMvpZipResult {
  const applicationNo = application.applicationNo.trim() || "unknown";
  const validation = validateFreightForwarderMvpRows(application.items);
  const folderName = applicationNo;
  const files: Record<string, Uint8Array> = { [`${folderName}/`]: new Uint8Array() };
  let labelWrapOccurred = false;
  for (const row of validation.validRows) {
    const built = buildLogicalLabelContent(row.item, row.barcodeValue);
    labelWrapOccurred ||= built.wrapped;
    files[`${folderName}/${buildFreightForwarderMvpFilename(applicationNo, row.rowNo, row.printCount)}`] = buildPdfDocument(built.content);
  }
  const result = { ...validation, labelWrapOccurred };
  return { ...result, zipFilename: `${applicationNo}.zip`, folderName, zipBytes: zipSync(files), statusMessage: buildFreightForwarderMvpStatusMessage(result) };
}

function buildLogicalLabelContent(item: FreightApplicationItem, barcodeValue: string): { content: string; wrapped: boolean } {
  const layout = createCode128Layout(barcodeValue, encodeCode128Auto);
  const barcodeX = 8.16, barcodeY = 8.62, barcodeWidth = 129.84, barcodeHeight = 28.8;
  const moduleScale = barcodeWidth / layout.width;
  const bars = layout.bars.map((bar) => `${n(barcodeX + bar.x * moduleScale)} ${n(barcodeY)} ${n(Math.max(0.18, bar.width * moduleScale))} ${n(barcodeHeight)} re f`).join("\n");
  const label = labelLines(item);
  const product = fitLines([label[0] ?? ""], 132, 7.8, 4.8);
  const info = fitLines(label.slice(1), 132, 7, 4.8);
  const made = fitLines(["MADE IN CHINA"], 132, 6.4, 4.8);
  const text = [
    drawCentered(barcodeValue, 38.62, 12, 132),
    ...product.lines.slice(0, 1).map((line, i) => drawCentered(line, 48.7 + i * 6.2, product.size, 132)),
    ...info.lines.slice(0, 5).map((line, i) => drawCentered(line, 55.66 + i * 5.2, info.size, 132)),
    ...made.lines.map((line) => drawCentered(line, 81.82, made.size, 132)),
  ].join("\n");
  return { content: ["q", "0 -1 1 0 0 147 cm", "1 1 1 rg", `${n(barcodeX)} ${n(barcodeY)} ${n(barcodeWidth)} ${n(barcodeHeight)} re f`, "0 0 0 rg", bars, text, "Q"].join("\n"), wrapped: product.wrapped || info.wrapped };
}

function labelLines(item: FreightApplicationItem): string[] {
  const source = item.matchedLabelText || item.matchedProductNameKo || item.displayName || item.itemName || "";
  return String(source).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function fitLines(input: string[], maxWidth: number, startSize: number, minSize: number): { lines: string[]; size: number; wrapped: boolean } {
  let size = startSize;
  while (size > minSize && input.every((line) => textWidth(line, size) <= maxWidth)) return { lines: input, size, wrapped: false };
  while (size > minSize) { size = Math.max(minSize, Number((size - 0.2).toFixed(1))); if (input.every((line) => textWidth(line, size) <= maxWidth)) return { lines: input, size, wrapped: false }; }
  return { lines: input.flatMap((line) => wrapLine(line, maxWidth, minSize)), size: minSize, wrapped: true };
}
function wrapLine(line: string, maxWidth: number, size: number): string[] { const out: string[] = []; let cur = ""; for (const ch of [...line]) { if (cur && textWidth(cur + ch, size) > maxWidth) { out.push(cur); cur = ch; } else cur += ch; } if (cur) out.push(cur); return out; }
function textWidth(value: string, size: number): number { return [...value].reduce((sum, ch) => sum + ((ch.codePointAt(0) ?? 0) > 127 ? 0.92 : 0.56) * size, 0); }
function drawCentered(value: string, y: number, size: number, maxWidth: number): string { const x = (LOGICAL_WIDTH_PT - Math.min(maxWidth, textWidth(value, size))) / 2; return `BT /F1 ${n(size)} Tf 1 0 0 1 ${n(x)} ${n(y)} Tm <${utf16beHex(value)}> Tj ET`; }
function utf16beHex(value: string): string { return [...value].map((ch) => { const cp = ch.codePointAt(0) ?? 32; return cp <= 0xffff ? cp.toString(16).padStart(4, "0") : "0020"; }).join(""); }
function n(value: number): string { return Number(value.toFixed(3)).toString(); }
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

function buildPdfDocument(content: string): Uint8Array {
  const enc = new TextEncoder();
  const font = loadKoreanFontBytes();
  const stream = enc.encode(content);
  const objects: Uint8Array[] = [
    enc.encode("1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n"),
    enc.encode("2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n"),
    enc.encode(`3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 ${FREIGHT_FORWARDER_MVP_WIDTH_PT} ${FREIGHT_FORWARDER_MVP_HEIGHT_PT}] /Resources << /Font << /F1 4 0 R >> >> /Contents 9 0 R >> endobj\n`),
    enc.encode("4 0 obj << /Type /Font /Subtype /Type0 /BaseFont /KoreanLabelFallback /Encoding /Identity-H /DescendantFonts [5 0 R] /ToUnicode 8 0 R >> endobj\n"),
    enc.encode("5 0 obj << /Type /Font /Subtype /CIDFontType2 /BaseFont /KoreanLabelFallback /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 6 0 R /W [0 [500]] >> endobj\n"),
    enc.encode(`6 0 obj << /Type /FontDescriptor /FontName /KoreanLabelFallback /Flags 4 /FontBBox [-1000 -1000 2000 2000] /ItalicAngle 0 /Ascent 1000 /Descent -300 /CapHeight 700 /StemV 80 /FontFile2 7 0 R >> endobj\n`),
    concat([enc.encode(`7 0 obj << /Length ${font.length} /Length1 ${font.length} >> stream\n`), font, enc.encode("\nendstream endobj\n")]),
    enc.encode(`8 0 obj << /Length ${TO_UNICODE_CMAP.length} >> stream\n${TO_UNICODE_CMAP}\nendstream endobj\n`),
    concat([enc.encode(`9 0 obj << /Length ${stream.length} >> stream\n`), stream, enc.encode("\nendstream endobj\n")]),
  ];
  const header = enc.encode("%PDF-1.4\n"); let offset = header.length; const xref = ["0000000000 65535 f "];
  for (const object of objects) { xref.push(`${String(offset).padStart(10, "0")} 00000 n `); offset += object.length; }
  const body = concat(objects); const xrefOffset = header.length + body.length;
  return concat([header, body, enc.encode(`xref\n0 10\n${xref.join("\n")}\ntrailer << /Size 10 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`)]);
}
function concat(chunks: Uint8Array[]): Uint8Array { const len = chunks.reduce((s, c) => s + c.length, 0); const out = new Uint8Array(len); let at = 0; for (const c of chunks) { out.set(c, at); at += c.length; } return out; }
const TO_UNICODE_CMAP = "/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n1 beginbfrange\n<0000> <FFFF> <0000>\nendbfrange\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend";
