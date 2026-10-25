function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

export function extractLegacySeoDetailImageUrls(value: unknown) {
  const html = text(value);
  if (!html) return [] as string[];
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const imageTag of html.matchAll(/<img\b[^>]*>/gi)) {
    for (const match of imageTag[0].matchAll(
      /\b(?:data-src|src)\s*=\s*(["'])(https?:\/\/.*?)\1/gi,
    )) {
      const url = text(match[2]).replaceAll("&amp;", "&");
      const key = url.toLowerCase();
      if (!url || seen.has(key)) continue;
      seen.add(key);
      urls.push(url);
      if (urls.length >= 32) break;
    }
    if (urls.length >= 32) break;
  }
  return [
    ...urls.filter((url) => !/\.gif(?:[?#]|$)/i.test(url)),
    ...urls.filter((url) => /\.gif(?:[?#]|$)/i.test(url)),
  ];
}
