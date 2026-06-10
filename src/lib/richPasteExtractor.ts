import type { FreightApplicationItem } from "../types/freightBarcodeRequest.ts";

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

export function extractImageUrlsFromHtml(html: string): string[] {
  const imageTags = html.match(/<img\b[^>]*>/gi) ?? [];

  return imageTags.flatMap((tag) => {
    const candidates = [
      readAttribute(tag, "data-src"),
      readAttribute(tag, "src"),
      firstSrcsetUrl(readAttribute(tag, "srcset")),
    ];
    const imageUrl = candidates
      .map((candidate) => candidate && normalizePastedImageUrl(candidate))
      .find(Boolean);

    return imageUrl ? [imageUrl] : [];
  });
}

export function assignPastedImagesToItems(
  items: FreightApplicationItem[],
  imageUrls: string[],
): FreightApplicationItem[] {
  return items.map((item, index) => {
    const pastedImageUrl = imageUrls[index];

    return pastedImageUrl ? { ...item, pastedImageUrl } : { ...item };
  });
}

export function getPreferredFreightItemImage(
  item: FreightApplicationItem,
): string | undefined {
  return item.pastedImageUrl || item.imageUrl || item.matchedImageUrl;
}
