export const SHOPLING_PRODUCT_TITLE_MAX_BYTES = 100;

export type ManualMallTitleMarket = {
  mallKey: string;
  marketName: string;
  accountIdLabel: string;
};

export type ManualMallTitleVariant = {
  mallKey: string;
  marketName: string;
  accountIdLabel: string;
  orderedKeywords: string[];
  title: string;
  keywordCount: number;
  includedKeywordCount: number;
  keywordIntegrityOk: boolean;
  permutationIndex: bigint;
  byteLength: number;
  validationErrors: string[];
};

function normalizeKeyword(keyword: string) {
  return keyword.replace(/\s+/g, " ").trim();
}

function keywordIdentity(keyword: string) {
  return keyword.toLocaleLowerCase("und");
}

export function parseManualMallTitleKeywords(input: string) {
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const rawKeyword of input.split(/[,;|\n\r]+/)) {
    const keyword = normalizeKeyword(rawKeyword);
    if (!keyword) continue;
    const identity = keywordIdentity(keyword);
    if (seen.has(identity)) continue;
    seen.add(identity);
    keywords.push(keyword);
  }
  return keywords;
}

export function permutationCount(keywordCount: number) {
  let count = BigInt(1);
  for (let i = BigInt(2); i <= BigInt(Math.max(0, Math.trunc(keywordCount))); i += BigInt(1)) count *= i;
  return count;
}

export function unrankKeywordPermutation(keywords: readonly string[], rank: bigint | number) {
  const remaining = [...keywords];
  const ordered: string[] = [];
  const total = permutationCount(remaining.length);
  let normalizedRank = total === BigInt(0) ? BigInt(0) : BigInt(rank) % total;

  for (let slots = remaining.length; slots > 0; slots -= 1) {
    const blockSize = permutationCount(slots - 1);
    const selectedIndex = Number(normalizedRank / blockSize);
    normalizedRank %= blockSize;
    ordered.push(remaining.splice(selectedIndex, 1)[0]);
  }

  return ordered;
}

function utf8ByteLength(value: string) {
  return new TextEncoder().encode(value).length;
}

function multiset(values: readonly string[]) {
  const counts = new Map<string, number>();
  for (const value of values) {
    const identity = keywordIdentity(value);
    counts.set(identity, (counts.get(identity) ?? 0) + 1);
  }
  return counts;
}

function sameKeywordMultiset(left: readonly string[], right: readonly string[]) {
  const leftCounts = multiset(left);
  const rightCounts = multiset(right);
  if (leftCounts.size !== rightCounts.size) return false;
  for (const [key, count] of leftCounts) if (rightCounts.get(key) !== count) return false;
  return true;
}

export function buildManualMallTitleVariants(input: { keywords: readonly string[]; markets: readonly ManualMallTitleMarket[] }) {
  const keywords = input.keywords.map(normalizeKeyword).filter(Boolean);
  return input.markets.map((market, index): ManualMallTitleVariant => {
    const permutationIndex = BigInt(index);
    const orderedKeywords = keywords.length > 0 ? unrankKeywordPermutation(keywords, permutationIndex) : [];
    const title = orderedKeywords.join(" ");
    const byteLength = utf8ByteLength(title);
    const keywordIntegrityOk = keywords.length > 0 && sameKeywordMultiset(keywords, orderedKeywords);
    const validationErrors: string[] = [];

    if (keywords.length === 0) validationErrors.push("manual_mall_title_keywords_required");
    if (!keywordIntegrityOk) validationErrors.push("manual_mall_title_keyword_integrity_failed");
    if (byteLength > SHOPLING_PRODUCT_TITLE_MAX_BYTES) validationErrors.push("manual_mall_title_max_bytes_exceeded");

    return {
      mallKey: market.mallKey,
      marketName: market.marketName,
      accountIdLabel: market.accountIdLabel,
      orderedKeywords,
      title,
      keywordCount: keywords.length,
      includedKeywordCount: orderedKeywords.length,
      keywordIntegrityOk,
      permutationIndex,
      byteLength,
      validationErrors,
    };
  });
}
