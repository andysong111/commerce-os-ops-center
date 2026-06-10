import type {
  FreightApplication,
  FreightApplicationItem,
} from "../types/freightBarcodeRequest.ts";

const PRODUCT_BLOCK_PATTERN = /제품\s*정보\s*:?\s*\(\s*(\d+)\s*\)/gi;

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

export function parseFreightApplicationText(
  rawText: string,
): FreightApplication {
  const normalizedText = rawText.replace(/\r\n?/g, "\n");
  const applicationNo =
    normalizedText.match(/신청\s*번호\s*:?\s*([A-Za-z0-9-]+)/i)?.[1] ?? "";
  const blocks = splitProductBlocks(normalizedText);
  const items: FreightApplicationItem[] = blocks.map(({ rowNo, block }, index) => ({
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

  return { applicationNo, items };
}
