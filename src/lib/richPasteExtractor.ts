import type { FreightApplicationItem } from "../types/freightBarcodeRequest.ts";

const NON_PRODUCT_KEYWORDS = [
  "flag",
  "icon",
  "logo",
  "btn",
  "button",
  "sprite",
  "spacer",
  "blank",
  "loading",
  "avatar",
  "kakao",
  "ch",
  "country",
  "lcl",
];
const PRODUCT_IMAGE_DOMAINS = [
  "alicdn.com",
  "cbu01.alicdn.com",
  "img.alicdn.com",
  "1688.com",
];
const PRODUCT_SECTION_PATTERN = /제품정보\s*[:：]?\s*\(?\d+\)?/gi;
const ITEM_SECTION_PATTERN = /(?:^|[>\s])\*?품목\s*[:：]/gi;

export interface RichPasteImageCandidate {
  url: string;
  blockIndex?: number;
  score: number;
  alt?: string;
  title?: string;
  width?: number;
  height?: number;
}

export interface RichPasteImageExtraction {
  totalImages: number;
  candidates: RichPasteImageCandidate[];
  ignoredImages: number;
  productBlockCount: number;
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

export function normalizePastedImageUrl(value: string): string | undefined {
  const trimmed = decodeHtmlAttribute(value).trim();

  if (!trimmed || /^data:image\//i.test(trimmed)) return undefined;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  return undefined;
}

function readAttribute(tag: string, attribute: string): string | undefined {
  const pattern = new RegExp(
    `(?:^|\\s)${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i",
  );
  const match = tag.match(pattern);

  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function firstSrcsetUrl(srcset: string | undefined): string | undefined {
  return srcset?.split(",")[0]?.trim().split(/\s+/)[0];
}

function readDimension(tag: string, attribute: "width" | "height"): number | undefined {
  const value = readAttribute(tag, attribute);
  if (!value) return undefined;

  const match = value.match(/^\s*(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : undefined;
}

function containsNonProductKeyword(value: string): boolean {
  const normalized = decodeURIComponentSafely(value).toLowerCase();

  return NON_PRODUCT_KEYWORDS.some((keyword) => {
    const pattern = new RegExp(`(?:^|[\\W_])${keyword}(?:$|[\\W_])`, "i");
    return pattern.test(normalized);
  });
}

function decodeURIComponentSafely(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isPreferredProductDomain(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return PRODUCT_IMAGE_DOMAINS.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
    );
  } catch {
    return false;
  }
}

function findSectionOffsets(html: string): number[] {
  const productOffsets = [...html.matchAll(PRODUCT_SECTION_PATTERN)].map(
    (match) => match.index,
  );
  if (productOffsets.length > 0) return productOffsets;

  return [...html.matchAll(ITEM_SECTION_PATTERN)].map((match) => match.index);
}

function findBlockIndex(offset: number, sectionOffsets: number[]): number | undefined {
  let blockIndex: number | undefined;

  for (let index = 0; index < sectionOffsets.length; index += 1) {
    if (sectionOffsets[index] > offset) break;
    blockIndex = index;
  }

  return blockIndex;
}

function scoreCandidate({
  url,
  alt,
  title,
  width,
  height,
  blockIndex,
}: Omit<RichPasteImageCandidate, "score">): number {
  let score = 0;
  if (isPreferredProductDomain(url)) score += 100;
  if (blockIndex !== undefined) score += 30;
  if ((width ?? 0) >= 60 && (height ?? 0) >= 60) score += 20;
  if (alt?.trim() || title?.trim()) score += 5;
  return score;
}

export function extractRichPasteImagesFromHtml(
  html: string,
): RichPasteImageExtraction {
  const imageMatches = [...html.matchAll(/<img\b[^>]*>/gi)];
  const sectionOffsets = findSectionOffsets(html);
  const candidates: RichPasteImageCandidate[] = [];

  for (const match of imageMatches) {
    const tag = match[0];
    const rawCandidates = [
      readAttribute(tag, "data-src"),
      readAttribute(tag, "src"),
      firstSrcsetUrl(readAttribute(tag, "srcset")),
    ];
    const url = rawCandidates
      .map((candidate) => candidate && normalizePastedImageUrl(candidate))
      .find((candidate): candidate is string => Boolean(candidate));
    const alt = readAttribute(tag, "alt");
    const title = readAttribute(tag, "title");
    const width = readDimension(tag, "width");
    const height = readDimension(tag, "height");
    const identifyingText = [
      url,
      alt,
      title,
      readAttribute(tag, "class"),
      readAttribute(tag, "id"),
      readAttribute(tag, "role"),
    ]
      .filter(Boolean)
      .join(" ");
    const isTooSmall =
      (width !== undefined && width < 40) ||
      (height !== undefined && height < 40);

    if (!url || isTooSmall || containsNonProductKeyword(identifyingText)) continue;

    const blockIndex = findBlockIndex(match.index, sectionOffsets);
    const candidateWithoutScore = { url, alt, title, width, height, blockIndex };
    candidates.push({
      ...candidateWithoutScore,
      score: scoreCandidate(candidateWithoutScore),
    });
  }

  return {
    totalImages: imageMatches.length,
    candidates,
    ignoredImages: imageMatches.length - candidates.length,
    productBlockCount: sectionOffsets.length,
  };
}

export function extractImageUrlsFromHtml(html: string): string[] {
  return extractRichPasteImagesFromHtml(html).candidates.map(
    (candidate) => candidate.url,
  );
}

function contextMatchScore(
  item: FreightApplicationItem,
  candidate: RichPasteImageCandidate,
): number {
  const itemContext = `${item.itemName} ${item.optionText}`.toLowerCase();
  const imageContext = `${candidate.alt ?? ""} ${candidate.title ?? ""}`.toLowerCase();
  if (!imageContext.trim()) return 0;

  const itemTokens = itemContext
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 2);
  return itemTokens.some((token) => imageContext.includes(token)) ? 40 : 0;
}

export function assignPastedImagesToItems(
  items: FreightApplicationItem[],
  images: string[] | RichPasteImageExtraction,
): FreightApplicationItem[] {
  const candidates: RichPasteImageCandidate[] = Array.isArray(images)
    ? images.map((url, index) => ({ url, score: 0, blockIndex: index }))
    : images.candidates;
  const usedCandidates = new Set<number>();
  const assignments = new Map<number, string>();

  items.forEach((_, itemIndex) => {
    let bestCandidateIndex = -1;
    let bestScore = -Infinity;

    candidates.forEach((candidate, candidateIndex) => {
      const candidateScore = candidate.score + contextMatchScore(items[itemIndex], candidate);
      if (
        usedCandidates.has(candidateIndex) ||
        candidate.blockIndex !== itemIndex ||
        candidateScore <= bestScore
      ) {
        return;
      }
      bestCandidateIndex = candidateIndex;
      bestScore = candidateScore;
    });

    if (bestCandidateIndex >= 0) {
      usedCandidates.add(bestCandidateIndex);
      assignments.set(itemIndex, candidates[bestCandidateIndex].url);
    }
  });

  items.forEach((_, itemIndex) => {
    if (assignments.has(itemIndex)) return;

    const fallbackIndex = candidates.findIndex(
      (candidate, candidateIndex) =>
        !usedCandidates.has(candidateIndex) && candidate.blockIndex !== undefined,
    );
    const anyFallbackIndex =
      fallbackIndex >= 0
        ? fallbackIndex
        : candidates.findIndex((_, candidateIndex) => !usedCandidates.has(candidateIndex));

    if (anyFallbackIndex >= 0) {
      usedCandidates.add(anyFallbackIndex);
      assignments.set(itemIndex, candidates[anyFallbackIndex].url);
    }
  });

  return items.map((item, index) => {
    const pastedImageUrl = assignments.get(index);
    return pastedImageUrl ? { ...item, pastedImageUrl } : { ...item };
  });
}

export function getPreferredFreightItemImage(
  item: FreightApplicationItem,
): string | undefined {
  return item.pastedImageUrl || item.imageUrl || item.matchedImageUrl;
}
