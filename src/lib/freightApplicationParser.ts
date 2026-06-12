import type {
  FreightApplication,
  FreightApplicationItem,
  FreightParseDiagnostics,
  FreightParserMode,
} from "../types/freightBarcodeRequest.ts";
import { findProductsByText } from "./productMaster.ts";

const PRODUCT_BLOCK_PATTERN = /제품\s*정보\s*:?\s*\(\s*(\d+)\s*\)/gi;
const TRACKING_PLACEHOLDER = "입력란에 하나의 트래킹만 입력";
const TRACKING_LABEL_PATTERN = "(?:트레킹번호|트래킹번호|tracking\\s*(?:no\\.?|number))";
const OPTION_LINE_PATTERN = /(?:颜色|顏色|產品|产品|规格|規格|型号|型號|尺寸)\s*[:：]?/;
const LONG_NUMBER_PATTERN = /^\d{12,}$/;
const SMALL_INTEGER_PATTERN = /^\d{1,3}$/;
const URL_PATTERN = /https?:\/\/\S+/i;
const IMAGE_URL_PATTERN = /https?:\/\/(?:[^/]*\.)?(?:alicdn\.com|cbu01\.alicdn\.com)\/\S+/i;

const FIELD_LABELS = [
  "옵션\\s*\\(\\s*색상\\s*,\\s*사이즈\\s*\\)",
  "오픈마켓\\s*주문번호",
  "상품상세\\s*url",
  TRACKING_LABEL_PATTERN,
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
    `(?:^|\\n)\\s*\\*?\\s*${labelPattern}\\s*:\\s*([\\s\\S]*?)(?=\\n\\s*\\*?\\s*(?:${nextLabelPattern})\\s*:|$)`,
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

function normalizeLabel(line: string): string {
  return line.replace(/^\*+\s*/, "").trim();
}

function isExactLabel(line: string, pattern: RegExp): boolean {
  return pattern.test(normalizeLabel(line));
}

function extractApplicationNo(lines: string[]): string {
  const applicationLabelIndex = lines.findIndex((line) => /신청\s*번호/i.test(line));
  if (applicationLabelIndex === -1) return "";

  const nearbyText = lines
    .slice(applicationLabelIndex, applicationLabelIndex + 3)
    .join(" ");
  const afterLabel = nearbyText.replace(/^.*?신청\s*번호\s*:*\s*/i, "");

  return afterLabel.match(/(?:\[[^\]]+\]\s*)?(\d{4,})/)?.[1] ?? "";
}

function isUsefulItem(item: FreightApplicationItem): boolean {
  return Boolean(
    item.itemName ||
      item.optionText ||
      item.detailUrl ||
      item.hsCode ||
      item.quantity > 0 ||
      item.orderNo,
  );
}

const NEXT_LINE_LABELS = {
  itemName: /^품목$/i,
  optionText: /^옵션\s*\(\s*색상\s*,\s*사이즈\s*\)$/i,
  detailUrl: /^상품상세\s*url$/i,
  hsCode: /^hs[_\s-]*code$/i,
  unitPrice: /^단가$/i,
  quantity: /^수량$/i,
  trackingNo: /^(?:트레킹번호|트래킹번호|tracking\s*(?:no\.?|number))$/i,
  orderNo: /^오픈마켓\s*주문번호$/i,
} as const;

const ALL_NEXT_LINE_LABELS = Object.values(NEXT_LINE_LABELS);

function nextLineValue(
  block: string[],
  labelPattern: RegExp,
): string | undefined {
  const labelIndex = block.findIndex((line) => isExactLabel(line, labelPattern));
  if (labelIndex < 0) return undefined;

  const value = block[labelIndex + 1];
  if (!value || ALL_NEXT_LINE_LABELS.some((pattern) => isExactLabel(value, pattern))) {
    return undefined;
  }

  return value;
}

function parseNextLineLabeledItems(lines: string[]): FreightApplicationItem[] {
  const itemStarts = lines.reduce<number[]>((indexes, line, index) => {
    if (isExactLabel(line, NEXT_LINE_LABELS.itemName)) indexes.push(index);
    return indexes;
  }, []);

  return itemStarts
    .map((startIndex, index): FreightApplicationItem => {
      const block = lines.slice(startIndex, itemStarts[index + 1] ?? lines.length);
      const rowNo = index + 1;

      return {
        id: `freight-item-${rowNo}-${index + 1}`,
        rowNo,
        itemName: nextLineValue(block, NEXT_LINE_LABELS.itemName) ?? "",
        optionText: nextLineValue(block, NEXT_LINE_LABELS.optionText) ?? "",
        detailUrl: nextLineValue(block, NEXT_LINE_LABELS.detailUrl),
        hsCode: nextLineValue(block, NEXT_LINE_LABELS.hsCode),
        unitPrice: parseOptionalNumber(
          nextLineValue(block, NEXT_LINE_LABELS.unitPrice),
        ),
        quantity: parseQuantity(
          nextLineValue(block, NEXT_LINE_LABELS.quantity),
        ),
        trackingNo: nextLineValue(block, NEXT_LINE_LABELS.trackingNo),
        orderNo: nextLineValue(block, NEXT_LINE_LABELS.orderNo),
      };
    })
    .filter(isUsefulItem);
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

function parseInlineLabeledItems(rawText: string): FreightApplicationItem[] {
  return splitProductBlocks(rawText)
    .map(({ rowNo, block }, index): FreightApplicationItem => ({
      id: `freight-item-${rowNo}-${index + 1}`,
      rowNo,
      itemName: extractField(block, "품목") ?? "",
      optionText:
        extractField(block, "옵션\\s*\\(\\s*색상\\s*,\\s*사이즈\\s*\\)") ?? "",
      detailUrl: extractField(block, "상품상세\\s*url"),
      hsCode: extractField(block, "hs[_\\s-]*code"),
      unitPrice: parseOptionalNumber(extractField(block, "단가")),
      quantity: parseQuantity(extractField(block, "수량")),
      trackingNo: extractField(block, TRACKING_LABEL_PATTERN),
      orderNo: extractField(block, "오픈마켓\\s*주문번호"),
    }))
    .filter(isUsefulItem);
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
    const copiedUrl =
      urlOffset >= 0
        ? followingLines[urlOffset].match(URL_PATTERN)?.[0]
        : undefined;
    const imageUrl = copiedUrl && IMAGE_URL_PATTERN.test(copiedUrl)
      ? copiedUrl
      : undefined;
    const detailUrl = imageUrl ? undefined : copiedUrl;

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

    const item: FreightApplicationItem = {
      id: `freight-item-${rowNo}-${items.length + 1}`,
      rowNo,
      itemName,
      optionText,
      detailUrl,
      imageUrl,
      hsCode: undefined,
      unitPrice: undefined,
      quantity,
      trackingNo: findTrackingNo(lines, rowIndex, orderNo),
      orderNo,
    };

    if (isUsefulItem(item)) items.push(item);
  });

  return items;
}

function enrichItemFromProductMaster(
  item: FreightApplicationItem,
): FreightApplicationItem {
  const lookupText = [item.itemName, item.optionText].filter(Boolean).join(" ");
  const product = findProductsByText(lookupText)[0];
  if (!product) return item;

  return {
    ...item,
    modelNo: product.modelNo,
    modelName: product.modelName,
    optionName: product.optionName,
    barcode: product.barcode,
    origin: product.origin,
    displayName: product.displayName,
    matchedModelNo: product.modelNo,
    matchedModelName: product.modelName,
    matchedProductNameKo: product.productNameKo,
    matchedBarcode: product.barcode,
    matchedOriginLabel: product.origin,
    matchedLabelText: product.labelText,
    matchedImageUrl: product.imageUrl,
    hsCode: item.hsCode || product.hsCode,
  };
}

function enrichItemsFromProductMaster(
  items: FreightApplicationItem[],
): FreightApplicationItem[] {
  return items.map(enrichItemFromProductMaster);
}

function createDiagnostics(
  lines: string[],
  parserMode: FreightParserMode,
  parsedItemCount: number,
): FreightParseDiagnostics {
  const detectedCounts = {
    lines: lines.length,
    itemLabels: lines.filter((line) =>
      /^\*?\s*품목(?:\s*:|$)/i.test(line),
    ).length,
    urls: lines.filter((line) => URL_PATTERN.test(line)).length,
    quantityLabels: lines.filter((line) =>
      /^\*?\s*수량(?:\s*:|$)/i.test(line),
    ).length,
    orderNumbers: lines.filter((line) => /(?:^|\D)\d{12,}(?:\D|$)/.test(line))
      .length,
  };
  const warnings: string[] = [];

  if (parserMode === "failed") {
    warnings.push("복사한 텍스트에서 분석 가능한 품목을 찾지 못했습니다.");
  } else if (detectedCounts.itemLabels > parsedItemCount) {
    warnings.push(
      `품목 라벨 ${detectedCounts.itemLabels}개 중 ${parsedItemCount}개만 유효한 품목으로 분석했습니다.`,
    );
  }

  return { parserMode, warnings, detectedCounts };
}

export function parseFreightApplicationText(
  rawText: string,
): FreightApplication {
  const lines = normalizeLines(rawText);
  const applicationNo = extractApplicationNo(lines);

  const nextLineItems = parseNextLineLabeledItems(lines);
  if (nextLineItems.length > 0) {
    return {
      applicationNo,
      items: enrichItemsFromProductMaster(nextLineItems),
      diagnostics: createDiagnostics(lines, "labeled-next-line", nextLineItems.length),
    };
  }

  const inlineItems = parseInlineLabeledItems(rawText);
  if (inlineItems.length > 0) {
    return {
      applicationNo,
      items: enrichItemsFromProductMaster(inlineItems),
      diagnostics: createDiagnostics(lines, "labeled-inline", inlineItems.length),
    };
  }

  const looseItems = parseLooseTableItems(lines);
  const parserMode: FreightParserMode =
    looseItems.length > 0 ? "loose-table" : "failed";

  return {
    applicationNo,
    items: enrichItemsFromProductMaster(looseItems),
    diagnostics: createDiagnostics(lines, parserMode, looseItems.length),
  };
}
