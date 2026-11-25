import {
  KEYWORD_ELON_SEO_FORBIDDEN_TERMS,
  KEYWORD_ELON_SEO_NOISE_TERMS,
  KEYWORD_ELON_SEO_SEARCH_LIMIT,
  KEYWORD_ELON_SEO_SEARCH_TERM_BYTE_LIMIT,
  keywordElonSeoCanonical,
  keywordElonSeoUtf8Bytes,
} from "./keywordEngineElonLabSeoOutput.ts";

export const SEO_REQUIRED_TITLE_KEYWORD_LIMIT = 3;
export const SEO_REQUIRED_SEARCH_KEYWORD_LIMIT = KEYWORD_ELON_SEO_SEARCH_LIMIT;
export const SEO_REQUIRED_TITLE_KEYWORD_TOTAL_BYTE_LIMIT = 43;
export const SEO_REQUIRED_EXPANSION_SEED_LIMIT = 8;

export type SeoRequiredKeywords = {
  titleKeywords: string[];
  searchKeywords: string[];
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function inputValues(value: unknown) {
  const source = Array.isArray(value) ? value : [value];
  return source.flatMap((entry) => text(entry).split(/[,，\r\n]+/));
}

export function parseSeoRequiredKeywordList(value: unknown) {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const entry of inputValues(value)) {
    const keyword = text(entry);
    const key = keywordElonSeoCanonical(keyword);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(keyword);
  }
  return result;
}

function assertKeywordShape(keyword: string, label: string) {
  const key = keywordElonSeoCanonical(keyword);
  if (key.length < 2) {
    throw new Error(`${label} '${keyword}'은(는) 두 글자 이상 입력해 주세요.`);
  }
  const bytes = keywordElonSeoUtf8Bytes(keyword);
  if (bytes > KEYWORD_ELON_SEO_SEARCH_TERM_BYTE_LIMIT) {
    throw new Error(
      `${label} '${keyword}'은(는) ${KEYWORD_ELON_SEO_SEARCH_TERM_BYTE_LIMIT}bytes를 초과합니다.`,
    );
  }
  const blocked = [
    ...KEYWORD_ELON_SEO_FORBIDDEN_TERMS,
    ...KEYWORD_ELON_SEO_NOISE_TERMS,
  ]
    .map(keywordElonSeoCanonical)
    .filter(Boolean);
  const matched = blocked.find((term) => key.includes(term));
  if (matched) {
    throw new Error(`${label} '${keyword}'은(는) SEO 금지·잡음 단어와 충돌합니다.`);
  }
}

export function normalizeSeoRequiredKeywords(input: {
  titleKeywords?: unknown;
  searchKeywords?: unknown;
}): SeoRequiredKeywords {
  const titleKeywords = parseSeoRequiredKeywordList(input.titleKeywords);
  const searchKeywords = parseSeoRequiredKeywordList(input.searchKeywords);

  if (titleKeywords.length > SEO_REQUIRED_TITLE_KEYWORD_LIMIT) {
    throw new Error(
      `상품명 필수 키워드는 최대 ${SEO_REQUIRED_TITLE_KEYWORD_LIMIT}개까지 입력할 수 있습니다.`,
    );
  }
  if (searchKeywords.length > SEO_REQUIRED_SEARCH_KEYWORD_LIMIT) {
    throw new Error(
      `검색어 필수 키워드는 최종 검색어 칸 수와 같은 최대 ${SEO_REQUIRED_SEARCH_KEYWORD_LIMIT}개까지 입력할 수 있습니다.`,
    );
  }

  for (const keyword of titleKeywords) assertKeywordShape(keyword, "상품명 필수 키워드");
  for (const keyword of searchKeywords) assertKeywordShape(keyword, "검색어 필수 키워드");

  const titleBytes = keywordElonSeoUtf8Bytes(titleKeywords.join(" "));
  if (titleBytes > SEO_REQUIRED_TITLE_KEYWORD_TOTAL_BYTE_LIMIT) {
    throw new Error(
      `상품명 필수 키워드 합계는 공백 포함 ${SEO_REQUIRED_TITLE_KEYWORD_TOTAL_BYTE_LIMIT}bytes 이하여야 합니다. 현재 ${titleBytes}bytes입니다.`,
    );
  }

  return { titleKeywords, searchKeywords };
}

export function assertSeoRequiredKeywordsAllowed(
  required: SeoRequiredKeywords,
  blockedTerms: unknown[] = [],
) {
  const blocked = parseSeoRequiredKeywordList(blockedTerms)
    .map(keywordElonSeoCanonical)
    .filter(Boolean);
  for (const [label, keywords] of [
    ["상품명 필수 키워드", required.titleKeywords],
    ["검색어 필수 키워드", required.searchKeywords],
  ] as const) {
    for (const keyword of keywords) {
      const key = keywordElonSeoCanonical(keyword);
      const matched = blocked.find((term) => term && key.includes(term));
      if (matched) {
        throw new Error(`${label} '${keyword}'은(는) 현재 금지키워드 정책과 충돌합니다.`);
      }
    }
  }
  return required;
}

function mergeKeywords(primary: unknown, secondary: unknown, limit: number) {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const keyword of [
    ...parseSeoRequiredKeywordList(primary),
    ...parseSeoRequiredKeywordList(secondary),
  ]) {
    const key = keywordElonSeoCanonical(keyword);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(keyword);
    if (result.length >= limit) break;
  }
  return result;
}

export function buildSeoRequiredExpansionSeeds(
  requiredTitleKeywords: unknown,
  discoveredSeeds: unknown,
  limit = SEO_REQUIRED_EXPANSION_SEED_LIMIT,
) {
  const required = normalizeSeoRequiredKeywords({
    titleKeywords: requiredTitleKeywords,
  }).titleKeywords;
  return mergeKeywords(required, discoveredSeeds, Math.max(required.length, limit));
}

export function mergeSeoRequiredTitleKeywords(
  requiredTitleKeywords: unknown,
  discoveredTitleKeywords: unknown,
  limit = 12,
) {
  const required = normalizeSeoRequiredKeywords({
    titleKeywords: requiredTitleKeywords,
  }).titleKeywords;
  if (required.length > limit) {
    throw new Error("상품명 필수 키워드를 상품명 재료에 모두 보존할 수 없습니다.");
  }
  return mergeKeywords(required, discoveredTitleKeywords, limit);
}

export function prioritizeSeoRequiredSearchKeywords(
  requiredSearchKeywords: unknown,
  discoveredSearchKeywords: unknown,
  limit = SEO_REQUIRED_SEARCH_KEYWORD_LIMIT,
) {
  const required = normalizeSeoRequiredKeywords({
    searchKeywords: requiredSearchKeywords,
  }).searchKeywords;
  if (required.length > limit) {
    throw new Error("검색어 필수 키워드를 최종 검색어에 모두 보존할 수 없습니다.");
  }
  return mergeKeywords(required, discoveredSearchKeywords, limit);
}

export function seoTitleIncludesRequiredKeyword(title: unknown, keyword: unknown) {
  const titleKey = keywordElonSeoCanonical(title);
  const keywordKey = keywordElonSeoCanonical(keyword);
  return Boolean(keywordKey && titleKey.includes(keywordKey));
}

export function seoRequiredTitleKeywordBytes(value: unknown) {
  return keywordElonSeoUtf8Bytes(parseSeoRequiredKeywordList(value).join(" "));
}
