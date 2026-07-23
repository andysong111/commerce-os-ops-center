import type { ProductGroupMarketAccount } from "./productGroupMarketRegistry.ts";

export const SHOPLING_PRODUCT_TITLE_MAX_BYTES = 100;
const KEYWORD_SPLIT_PATTERN = /[,;|\n\r]+/u;

export type ManualMallTitleVariant = {
  mallKey: string;
  marketName: string;
  accountIdLabel: string;
  title: string;
  keywordCount: number;
  includedKeywordCount: number;
  keywordIntegrityOk: boolean;
  permutationIndex: number;
  validationErrors: string[];
};

export function parseManualMallTitleKeywords(value: string): string[] {
  const seen = new Set<string>();
  return String(value ?? "")
    .split(KEYWORD_SPLIT_PATTERN)
    .map((keyword) => keyword.trim())
    .filter(Boolean)
    .filter((keyword) => {
      const key = keyword.toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function permutationCount(keywordCount: number): bigint {
  if (!Number.isSafeInteger(keywordCount) || keywordCount < 0) return BigInt(0);
  let count = BigInt(1);
  for (let i = 2; i <= keywordCount; i += 1) count *= BigInt(i);
  return count;
}

export function unrankKeywordPermutation(keywords: string[], rankInput: number | bigint): string[] {
  const available = [...keywords];
  const result: string[] = [];
  const total = permutationCount(available.length);
  let rank = total > BigInt(0) ? BigInt(rankInput) % total : BigInt(0);
  for (let i = available.length; i > 0; i -= 1) {
    const blockSize = permutationCount(i - 1);
    const index = Number(rank / blockSize);
    rank %= blockSize;
    result.push(available.splice(index, 1)[0]);
  }
  return result;
}

function utf8ByteLength(value: string) {
  return new TextEncoder().encode(value).length;
}

function sortedTokenMultiset(value: string[]) {
  return value.map((token) => token.toLocaleLowerCase()).sort().join("\u0000");
}

export function validateManualMallTitleIntegrity(title: string, keywords: string[]) {
  const titleTokens = title.split(" ").filter(Boolean);
  const errors: string[] = [];
  const byteLength = utf8ByteLength(title);
  const keywordIntegrityOk = sortedTokenMultiset(titleTokens) === sortedTokenMultiset(keywords);
  if (keywords.length === 0) errors.push("상품명 키워드를 입력하세요.");
  if (!keywordIntegrityOk) errors.push("상품명은 입력 키워드를 각각 정확히 한 번만 포함해야 합니다.");
  if (byteLength > SHOPLING_PRODUCT_TITLE_MAX_BYTES) errors.push(`상품명 UTF-8 길이 ${byteLength} bytes가 제한 ${SHOPLING_PRODUCT_TITLE_MAX_BYTES} bytes를 초과했습니다.`);
  return { keywordIntegrityOk, includedKeywordCount: titleTokens.length, byteLength, errors };
}

export function buildManualMallTitleVariants(input: {
  keywords: string[];
  markets: ProductGroupMarketAccount[];
}) {
  const totalPermutations = permutationCount(input.keywords.length);
  return input.markets.map((market, index): ManualMallTitleVariant => {
    const permutationIndex = totalPermutations > BigInt(0) ? Number(BigInt(index) % totalPermutations) : 0;
    const title = unrankKeywordPermutation(input.keywords, permutationIndex).join(" ");
    const integrity = validateManualMallTitleIntegrity(title, input.keywords);
    return {
      mallKey: market.mallKey,
      marketName: market.marketName,
      accountIdLabel: market.accountIdLabel,
      title,
      keywordCount: input.keywords.length,
      includedKeywordCount: integrity.includedKeywordCount,
      keywordIntegrityOk: integrity.keywordIntegrityOk,
      permutationIndex,
      validationErrors: integrity.errors,
    };
  });
}
