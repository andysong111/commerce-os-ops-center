import type {
  FreightApplication,
  FreightApplicationItem,
} from "../types/freightBarcodeRequest.ts";

const PRODUCT_BLOCK_PATTERN = /제품\s*정보\s*:?\s*\(\s*(\d+)\s*\)/gi;
const TRACKING_PLACEHOLDER = "입력란에 하나의 트래킹만 입력";
const OPTION_LINE_PATTERN = /(?:颜色|顏色|產品|产品|规格|規格|型号|型號|尺寸)\s*[:：]?/;
const LONG_NUMBER_PATTERN = /^\d{12,}$/;
const SMALL_INTEGER_PATTERN = /^\d{1,3}$/;
const URL_PATTERN = /https?:\/\/\S+/i;

const FIELD_LABELS = [
  "옵션\\s*\\(\\s*색상\\s*,\\s*사이즈\\s*\\)",
  "오픈마켓\\s*주문번호",
  "상품상세\\s*url",
  "트래킹번호",
  "hs[_\\s-]*code",
  "품목",
  "단가",
  "수량",
];

function extractField(block: string, labelPattern: string): string | undefined {
  const nextLabelPattern = FIELD_LABELS.filter(
    (candidate) => candidate !== labelPattern,
  ).join("|");
  const pattern = new RegExp(
    `(?:^|\\n)\\s*${labelPattern}\\s*:\\s*([\\s\\S]*?)(?=\\n\\s*(?:${nextLabelPattern})\\s*:|$)`,
    "i",
  );
  const value = block.match(pattern)?.[1]?.trim();

  return value || undefined;
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/)?.[0];
  if (!normalized) return undefined;
  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseQuantity(value: string | undefined): number {
  return parseOptionalNumber(value) ?? 0;
}

function normalizeLines(rawText: string): string[] {
  return rawText
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function extractApplicationNo(lines: string[]): string {
  const applicationLabelIndex = lines.findIndex((line) => /신청\s*번호/i.test(line));
  if (applicationLabelIndex === -1) return "";

  const nearbyText = lines
    .slice(applicationLabelIndex, applicationLabelIndex + 3)
    .join(" ");
  const afterLabel = nearbyText.replace(/^.*?신청\s*번호\s*:*/i, "");

  return afterLabel.match(/(?:\[[^\]]+\]\s*)?(\d{4,})/)?.[1] ?? "";
}

function splitProductBlocks(rawText: string): Array<{ rowNo: number; block: string }> {
  const normalizedText = rawText.replace(/\r\n?/g, "\n");
  const matches = [...normalizedText.matchAll(PRODUCT_BLOCK_PATTERN)];

  if (matches.length === 0) return [];

  return matches.map((match, index) => ({
    rowNo: Number(match[1]) || index + 1,
    block: normalizedText.slice(
      (match.index ?? 0) + match[0].length,
      matches[index + 1]?.index ?? normalizedText.length,
    ),
  }));
}

function parseLabeledItems(rawText: string): FreightApplicationItem[] {
  return splitProductBlocks(rawText).map(({ rowNo, block }, index) => ({
    id: `freight-item-${rowNo}-${index + 1}`,
    rowNo,
    itemName: extractField(block, "품목") ?? "",
    optionText:
      extractField(block, "옵션\\s*\\(\\s*색상\\s*,\\s*사이즈\\s*\\)") ?? "",
    detailUrl: extractField(block, "상품상세\\s*url"),
    hsCode: extractField(block, "hs[_\\s-]*code"),
    unitPrice: parseOptionalNumber(extractField(block, "단가")),
    quantity: parseQuantity(extractField(block, "수량")),
    trackingNo: extractField(block, "트래킹번호"),
    orderNo: extractField(block, "오픈마켓\\s*주문번호"),
  }));
}

function findNearestBefore(
  lines: string[],
  rowIndex: number,
  predicate: (line: string) => boolean,
): string | undefined {
  for (let index = rowIndex - 1; index >= Math.max(0, rowIndex - 6); index -= 1) {
    if (predicate(lines[index])) return lines[index];
  }

  return undefined;
}

function findTrackingNo(
  lines: string[],
  rowIndex: number,
  orderNo: string | undefined,
): string | undefined {
  for (let index = rowIndex - 1; index >= Math.max(0, rowIndex - 6); index -= 1) {
    const line = lines[index];
    if (line === TRACKING_PLACEHOLDER || line === orderNo) continue;
    if (OPTION_LINE_PATTERN.test(line) || URL_PATTERN.test(line)) continue;
    if (/신청\s*번호/i.test(line) || SMALL_INTEGER_PATTERN.test(line)) continue;
    if (/^(?=.*\d)[A-Za-z0-9-]{8,}$/.test(line)) return line;
  }

  return undefined;
}

function parseLooseTableItems(lines: string[]): FreightApplicationItem[] {
  const items: FreightApplicationItem[] = [];

  lines.forEach((line, rowIndex) => {
    if (!SMALL_INTEGER_PATTERN.test(line)) return;

    const rowNo = Number(line);
    const orderNo = findNearestBefore(lines, rowIndex, (candidate) =>
      LONG_NUMBER_PATTERN.test(candidate),
    );
    const optionText =
      findNearestBefore(lines, rowIndex, (candidate) =>
        OPTION_LINE_PATTERN.test(candidate),
      ) ?? "";
    const followingLines = lines.slice(rowIndex + 1, rowIndex + 7);
    const urlOffset = followingLines.findIndex((candidate) =>
      URL_PATTERN.test(candidate),
    );
    const detailUrl =
      urlOffset >= 0
        ? followingLines[urlOffset].match(URL_PATTERN)?.[0]
        : undefined;

    const previousLine = lines[rowIndex - 1];
    const hasStrongRowContext = Boolean(
      urlOffset === 0 || (orderNo && previousLine === orderNo),
    );
    if (!hasStrongRowContext) return;

    const quantityOffset =
      urlOffset >= 0
        ? followingLines.findIndex(
            (candidate, index) =>
              index > urlOffset && /^\d+(?:\.\d+)?$/.test(candidate),
          )
        : -1;
    const quantity =
      quantityOffset >= 0
        ? parseQuantity(followingLines[quantityOffset])
        : 0;
    const itemName =
      quantityOffset >= 0
        ? followingLines.find((candidate, index) => {
            if (index <= quantityOffset) return false;
            if (candidate === TRACKING_PLACEHOLDER) return false;
            if (URL_PATTERN.test(candidate) || /^\d+(?:\.\d+)?$/.test(candidate)) {
              return false;
            }
            return !OPTION_LINE_PATTERN.test(candidate);
          }) ?? ""
        : "";

    if (!quantity && !itemName && !orderNo) return;

    items.push({
      id: `freight-item-${rowNo}-${items.length + 1}`,
      rowNo,
      itemName,
      optionText,
      detailUrl,
      hsCode: undefined,
      unitPrice: undefined,
      quantity,
      trackingNo: findTrackingNo(lines, rowIndex, orderNo),
      orderNo,
    });
  });

  return items;
}

export function parseFreightApplicationText(
  rawText: string,
): FreightApplication {
  const lines = normalizeLines(rawText);
  const applicationNo = extractApplicationNo(lines);
  const labeledItems = parseLabeledItems(rawText);
  const items = labeledItems.length > 0 ? labeledItems : parseLooseTableItems(lines);

  return { applicationNo, items };
}
