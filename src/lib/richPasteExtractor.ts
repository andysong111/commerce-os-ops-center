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
  "country",
  "china",
  "chinese",
  "national",
  "lcl",
  "국기",
  "중국",
  "国旗",
  "中国",
];
const PRODUCT_IMAGE_DOMAINS = [
  "alicdn.com",
  "cbu01.alicdn.com",
  "img.alicdn.com",
  "1688.com",
];
const PRODUCT_SECTION_PATTERN = /제품정보\s*[:：]?\s*\(?\d+\)?/gi;
const ITEM_SECTION_PATTERN = /(?:^|[>\s])\*?품목\s*[:：]/gi;

export type RichPasteImageSource = "html" | "clipboard-file";
export type RichPasteImageLoadStatus = "pending" | "loaded" | "failed";

export interface RichPasteImageCandidate {
  url: string;
  blockIndex?: number;
  score: number;
  alt?: string;
  title?: string;
  width?: number;
  height?: number;
  sourceType: RichPasteImageSource;
  loadStatus: RichPasteImageLoadStatus;
}

export interface RichPasteExcludedImage {
  url?: string;
  alt?: string;
  title?: string;
  reason: string;
  sourceType: "html";
}

export interface RichPasteImageExtraction {
  totalImages: number;
  candidates: RichPasteImageCandidate[];
  excludedCandidates: RichPasteExcludedImage[];
  ignoredImages: number;
  productBlockCount: number;
}

export interface ClipboardImageCandidateInput {
  url: string;
  type: string;
  name?: string;
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
  if (trimmed.startsWith("blob:")) return trimmed;
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

function decodeURIComponentSafely(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function containsNonProductKeyword(value: string): boolean {
  const normalized = decodeURIComponentSafely(value).toLowerCase();

  return NON_PRODUCT_KEYWORDS.some((keyword) => {
    if (/[^\x00-\x7F]/.test(keyword)) return normalized.includes(keyword);
    const pattern = new RegExp(`(?:^|[\\W_])${keyword}(?:$|[\\W_])`, "i");
    return pattern.test(normalized);
  });
}

function hasFlagLikeDimensions(width?: number, height?: number): boolean {
  if (!width || !height || width > 160 || height > 120) return false;
  const ratio = width / height;
  return ratio >= 1.35 && ratio <= 2.1;
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
}: Omit<RichPasteImageCandidate, "score" | "sourceType" | "loadStatus">): number {
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
  const excludedCandidates: RichPasteExcludedImage[] = [];

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
    const isFlag = containsNonProductKeyword(identifyingText);
    const rawUrl = rawCandidates.find(Boolean);

    if (!url || isTooSmall || isFlag || (hasFlagLikeDimensions(width, height) && /(?:flag|country|china|cn|国旗|中国|국기|중국)/i.test(identifyingText))) {
      excludedCandidates.push({
        url: url ?? (rawUrl && !/^data:image\//i.test(rawUrl) ? rawUrl : undefined),
        alt,
        title,
        reason: !url
          ? "직접 로드할 수 없는 URL"
          : isTooSmall
            ? "너무 작은 이미지"
            : "국기/아이콘/로고 이미지",
        sourceType: "html",
      });
      continue;
    }

    const blockIndex = findBlockIndex(match.index, sectionOffsets);
    const candidateWithoutScore = { url, alt, title, width, height, blockIndex };
    candidates.push({
      ...candidateWithoutScore,
      score: scoreCandidate(candidateWithoutScore),
      sourceType: "html",
      loadStatus: "pending",
    });
  }

  return {
    totalImages: imageMatches.length,
    candidates,
    excludedCandidates,
    ignoredImages: excludedCandidates.length,
    productBlockCount: sectionOffsets.length,
  };
}

export function createClipboardImageCandidates(
  images: ClipboardImageCandidateInput[],
): RichPasteImageCandidate[] {
  return images
    .filter((image) => image.type.startsWith("image/") && image.url.startsWith("blob:"))
    .map((image) => ({
      url: image.url,
      alt: image.name || "클립보드 이미지",
      score: 80,
      sourceType: "clipboard-file" as const,
      loadStatus: "pending" as const,
    }));
}

export function mergeRichPasteImages(
  extraction: RichPasteImageExtraction,
  clipboardCandidates: RichPasteImageCandidate[],
): RichPasteImageExtraction {
  return {
    ...extraction,
    totalImages: extraction.totalImages + clipboardCandidates.length,
    candidates: [...extraction.candidates, ...clipboardCandidates],
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
  const candidates: RichPasteImageCandidate[] = (Array.isArray(images)
    ? images.map((url, index) => ({
        url,
        score: 0,
        blockIndex: index,
        sourceType: "html" as const,
        loadStatus: "loaded" as const,
      }))
    : images.candidates
  ).filter((candidate) => candidate.loadStatus !== "failed");
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
    return pastedImageUrl ? { ...item, pastedImageUrl } : { ...item, pastedImageUrl: undefined };
  });
}

export function getFreightItemImageSources(
  item: FreightApplicationItem,
): string[] {
  return [
    item.selectedImageCandidateUrl || item.pastedImageUrl,
    item.imageUrl,
    item.matchedImageUrl,
  ].filter(
    (source, index, sources): source is string =>
      Boolean(source) && sources.indexOf(source) === index,
  );
}

export function getPreferredFreightItemImage(
  item: FreightApplicationItem,
): string | undefined {
  return getFreightItemImageSources(item)[0];
}
