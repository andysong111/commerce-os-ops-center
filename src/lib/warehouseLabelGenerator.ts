export const WAREHOUSE_LABEL_50X30_MM = {
  id: "50x30",
  label: "50×30mm",
  widthMm: 50,
  heightMm: 30,
  widthPt: mmToPt(50),
  heightPt: mmToPt(30),
} as const;

const PDF_ESCAPE_PATTERN = /[\\()]/g;

export type WarehouseLabelPdfOptions = {
  maxFontSize?: number;
  safeMarginMm?: number;
};

export const DEFAULT_WAREHOUSE_LABEL_MAX_FONT_SIZE = 22;
export const DEFAULT_WAREHOUSE_LABEL_SAFE_MARGIN_MM = 2;
export const MIN_WAREHOUSE_LABEL_FONT_SIZE = 10;

export function mmToPt(mm: number): number {
  return (mm / 25.4) * 72;
}

export function normalizeWarehouseCodes(codes: string[]): string[] {
  return codes.map((code) => code.trim()).filter(Boolean);
}

export function parseWarehouseCodesFromText(text: string): string[] {
  return normalizeWarehouseCodes(text.split(/\r?\n/));
}

export function parseWarehouseCodesFromCsv(csv: string): string[] {
  const rows = parseCsvRows(csv);
  if (rows.length === 0) return [];

  const header = rows[0].map((cell) => cell.trim().replace(/^\uFEFF/, ""));
  const codeColumnIndex = header.findIndex(
    (cell) => cell === "전체코드" || cell.toLowerCase() === "code",
  );

  if (codeColumnIndex === -1) return [];

  return normalizeWarehouseCodes(
    rows.slice(1).map((row) => row[codeColumnIndex] ?? ""),
  );
}

export function createWarehouseLabelPdf(
  codes: string[],
  options: WarehouseLabelPdfOptions = {},
): Uint8Array<ArrayBuffer> {
  const normalizedCodes = normalizeWarehouseCodes(codes);
  const resolvedOptions = resolveWarehouseLabelPdfOptions(options);
  const objects: string[] = [];
  const pageObjectIds: number[] = [];
  const contentObjectIds: number[] = [];
  const catalogId = 1;
  const pagesId = 2;
  const fontId = 3;

  objects[catalogId] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[fontId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";

  normalizedCodes.forEach((code, index) => {
    const pageId = 4 + index * 2;
    const contentId = pageId + 1;
    pageObjectIds.push(pageId);
    contentObjectIds.push(contentId);

    const content = buildLabelPageContent(code, resolvedOptions);
    objects[pageId] = `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${formatNumber(
      WAREHOUSE_LABEL_50X30_MM.widthPt,
    )} ${formatNumber(WAREHOUSE_LABEL_50X30_MM.heightPt)}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${byteLength(content)} >>\nstream\n${content}\nendstream`;
  });

  objects[pagesId] = `<< /Type /Pages /Kids [${pageObjectIds
    .map((id) => `${id} 0 R`)
    .join(" ")}] /Count ${pageObjectIds.length} >>`;

  const maxObjectId = Math.max(pagesId, fontId, ...pageObjectIds, ...contentObjectIds);
  const chunks = ["%PDF-1.4\n%\xE2\xE3\xCF\xD3\n"];
  const offsets = [0];

  for (let id = 1; id <= maxObjectId; id += 1) {
    offsets[id] = byteLength(chunks.join(""));
    chunks.push(`${id} 0 obj\n${objects[id]}\nendobj\n`);
  }

  const xrefOffset = byteLength(chunks.join(""));
  chunks.push(`xref\n0 ${maxObjectId + 1}\n`);
  chunks.push("0000000000 65535 f \n");
  for (let id = 1; id <= maxObjectId; id += 1) {
    chunks.push(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  }
  chunks.push(`trailer\n<< /Size ${maxObjectId + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  return new TextEncoder().encode(chunks.join(""));
}

function buildLabelPageContent(code: string, options: Required<WarehouseLabelPdfOptions>): string {
  const width = WAREHOUSE_LABEL_50X30_MM.widthPt;
  const height = WAREHOUSE_LABEL_50X30_MM.heightPt;
  const fontSize = getFontSizeForCode(code, options);
  const textWidth = estimateHelveticaBoldWidth(code, fontSize);
  const x = (width - textWidth) / 2;
  const y = (height - fontSize) / 2 + fontSize * 0.28;

  return [
    "q",
    "1 1 1 rg",
    `0 0 ${formatNumber(width)} ${formatNumber(height)} re f`,
    "0 0 0 rg",
    "BT",
    `/F1 ${formatNumber(fontSize)} Tf`,
    `${formatNumber(x)} ${formatNumber(y)} Td`,
    `(${escapePdfString(code)}) Tj`,
    "ET",
    "Q",
  ].join("\n");
}

export function getFontSizeForCode(
  code: string,
  options: WarehouseLabelPdfOptions = {},
): number {
  const { maxFontSize, safeMarginMm } = resolveWarehouseLabelPdfOptions(options);
  const safeWidth = Math.max(1, WAREHOUSE_LABEL_50X30_MM.widthPt - mmToPt(safeMarginMm) * 2);
  const textWidthAtMax = estimateHelveticaBoldWidth(code, maxFontSize);
  return Math.max(
    MIN_WAREHOUSE_LABEL_FONT_SIZE,
    Math.min(maxFontSize, (maxFontSize * safeWidth) / Math.max(textWidthAtMax, 1)),
  );
}

function resolveWarehouseLabelPdfOptions(
  options: WarehouseLabelPdfOptions,
): Required<WarehouseLabelPdfOptions> {
  return {
    maxFontSize: sanitizePositiveNumber(options.maxFontSize, DEFAULT_WAREHOUSE_LABEL_MAX_FONT_SIZE),
    safeMarginMm: sanitizePositiveNumber(options.safeMarginMm, DEFAULT_WAREHOUSE_LABEL_SAFE_MARGIN_MM),
  };
}

function sanitizePositiveNumber(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function estimateHelveticaBoldWidth(text: string, fontSize: number): number {
  let units = 0;
  for (const char of text) {
    if (char === "-") units += 333;
    else if (/[0-9]/.test(char)) units += 556;
    else if (/[A-Z]/.test(char)) units += 722;
    else if (/[a-z]/.test(char)) units += 556;
    else units += 650;
  }
  return (units / 1000) * fontSize;
}

function parseCsvRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell);
  rows.push(row);
  return rows.filter((csvRow) => csvRow.some((value) => value.trim() !== ""));
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
