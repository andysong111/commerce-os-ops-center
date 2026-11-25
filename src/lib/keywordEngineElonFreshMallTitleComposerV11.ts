import {
  composeFreshKeywordElonMallTitles as composeFreshKeywordElonMallTitlesBase,
} from "./keywordEngineElonFreshMallTitleComposer.ts";
import type { KeywordElonSeoMarket } from "./keywordEngineElonLabSeoOutput.ts";
import type {
  KeywordElonMallTitleFactContext,
  KeywordElonMallTitleSafeComposerResult,
  KeywordElonSafeMallTitleRow,
} from "./keywordEngineElonMallTitleSafeComposer.ts";
import type { KeywordElonTitleExpansionMaterial } from "./keywordEngineElonTitleExpansion.ts";
import {
  mergeSeoRequiredTitleKeywords,
  missingSeoRequiredTitleKeywords,
  normalizeSeoRequiredKeywords,
} from "./seoRequiredKeywords.ts";

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function canonical(value: unknown) {
  return text(value).replace(/\s+/g, "").toLowerCase();
}

function marketIdentity(market: KeywordElonSeoMarket) {
  return [market.productGroup, market.mallKey, market.accountIdLabel].map(text).join("|");
}

function rowIdentity(row: KeywordElonSafeMallTitleRow) {
  return [row.productGroup, row.mallKey, row.accountIdLabel].map(text).join("|");
}

function mayRecoverBySameMall(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return [
    "고유 쇼핑몰별 상품명",
    "카테고리 정합 상품명 후보가 부족합니다",
    "쇼핑몰별 상품명에 중복이 발생했습니다",
    "V7 상품명 포트폴리오 후보",
  ].some((token) => message.includes(token));
}

function groupsByMallKey(markets: KeywordElonSeoMarket[]) {
  const groups = new Map<string, KeywordElonSeoMarket[]>();
  for (const market of markets) {
    const key = text(market.mallKey) || marketIdentity(market);
    const rows = groups.get(key) ?? [];
    rows.push(market);
    groups.set(key, rows);
  }
  return groups;
}

function assertSameMallUnique(rows: KeywordElonSafeMallTitleRow[]) {
  const seenByMall = new Map<string, Set<string>>();
  for (const row of rows) {
    const mallKey = text(row.mallKey);
    const titleKey = canonical(row.title);
    const seen = seenByMall.get(mallKey) ?? new Set<string>();
    if (titleKey && seen.has(titleKey)) {
      throw new Error(`같은 쇼핑몰 계정 사이 상품명이 중복되었습니다: ${mallKey}`);
    }
    if (titleKey) seen.add(titleKey);
    seenByMall.set(mallKey, seen);
  }
}

function assignPortfolioFinals(
  finals: string[],
  cursor: number,
  rowCount: number,
) {
  if (!finals.length || rowCount <= 0) return [] as string[];
  const count = Math.min(finals.length, rowCount);
  return Array.from(
    { length: count },
    (_, offset) => finals[(cursor + offset) % finals.length],
  );
}

function coveredFinalKeywords(
  rows: KeywordElonSafeMallTitleRow[],
  finals: string[],
) {
  const used = new Set(
    rows
      .flatMap((row) => row.keywordMaterials ?? [])
      .map(canonical)
      .filter(Boolean),
  );
  return finals.filter((keyword) => used.has(canonical(keyword)));
}

export function composeFreshKeywordElonMallTitles(input: {
  markets: KeywordElonSeoMarket[];
  finalKeywords: string[];
  requiredTitleKeywords?: string[];
  titleExpansionPool?: KeywordElonTitleExpansionMaterial[];
  modelName: string;
  context: KeywordElonMallTitleFactContext;
  blockedTerms?: string[];
  excludedTitles?: string[];
  variationSeed?: string;
}): KeywordElonMallTitleSafeComposerResult {
  try {
    // Keep the strongest policy first: all rows globally unique whenever the
    // verified material pool can support it.
    return composeFreshKeywordElonMallTitlesBase(input);
  } catch (error) {
    if (!mayRecoverBySameMall(error)) throw error;
  }

  // Sparse products should not fail merely because unrelated marketplaces reuse
  // a safe title. Same-mall uniqueness stays hard. Keyword coverage, however,
  // belongs to the WHOLE 29-row portfolio; requiring every one-row mall group to
  // cover every final keyword is mathematically impossible and caused the V11 canary
  // failure. Distribute final keywords across mall groups, then assert total coverage.
  const groups = groupsByMallKey(input.markets);
  const requiredTitleKeywords = normalizeSeoRequiredKeywords({
    titleKeywords: input.requiredTitleKeywords,
  }).titleKeywords;
  const portfolioFinals = requiredTitleKeywords.length
    ? mergeSeoRequiredTitleKeywords(requiredTitleKeywords, input.finalKeywords)
    : input.finalKeywords;
  const partials: KeywordElonMallTitleSafeComposerResult[] = [];
  const rowsByIdentity = new Map<string, KeywordElonSafeMallTitleRow>();
  let finalCursor = 0;

  for (const [mallKey, markets] of groups) {
    const groupFinalKeywords = assignPortfolioFinals(
      portfolioFinals,
      finalCursor,
      markets.length,
    );
    finalCursor += markets.length;
    if (!groupFinalKeywords.length) {
      throw new Error(`V11 ${mallKey} 상품명에 배정할 최종키워드가 없습니다.`);
    }
    const groupInput = {
      ...input,
      markets,
      finalKeywords: groupFinalKeywords,
      variationSeed: `${text(input.variationSeed) || "seo-v11"}:mall:${mallKey}`,
    };
    let partial: KeywordElonMallTitleSafeComposerResult;
    try {
      partial = composeFreshKeywordElonMallTitlesBase({
        ...groupInput,
        requiredTitleKeywords: requiredTitleKeywords.length <= 2 ? requiredTitleKeywords : [],
      });
    } catch (error) {
      const coverageError = error instanceof Error && error.message.startsWith("쇼핑몰별 상품명 최종키워드 커버 실패:");
      if (requiredTitleKeywords.length !== 2 || (!coverageError && !mayRecoverBySameMall(error))) throw error;
      partial = composeFreshKeywordElonMallTitlesBase({ ...groupInput, requiredTitleKeywords: [] });
    }
    partials.push(partial);
    for (const row of partial.rows) rowsByIdentity.set(rowIdentity(row), row);
  }

  const rows = input.markets
    .map((market) => rowsByIdentity.get(marketIdentity(market)))
    .filter((row): row is KeywordElonSafeMallTitleRow => Boolean(row));
  if (rows.length !== input.markets.length) {
    throw new Error(`V11 쇼핑몰별 상품명 복구 행 수가 맞지 않습니다. 현재 ${rows.length}개`);
  }
  assertSameMallUnique(rows);

  const coverage = coveredFinalKeywords(rows, portfolioFinals);
  if (coverage.length !== portfolioFinals.length) {
    const covered = new Set(coverage.map(canonical));
    const missing = portfolioFinals.filter(
      (keyword) => !covered.has(canonical(keyword)),
    );
    throw new Error(
      `V11 전체 쇼핑몰 포트폴리오 최종키워드 커버 실패: ${missing.join(", ")}`,
    );
  }
  const missingRequired = missingSeoRequiredTitleKeywords(requiredTitleKeywords, rows);
  if (missingRequired.length) {
    throw new Error(`V11 전체 쇼핑몰 상품명 필수 키워드 누락: ${missingRequired.join(", ")}`);
  }

  const uniqueTitleCount = new Set(
    rows.map((row) => canonical(row.title)).filter(Boolean),
  ).size;
  const globalReuseCount = Math.max(0, rows.length - uniqueTitleCount);
  const facts = [
    ...new Set(
      partials.flatMap((partial) => partial.facts ?? []).map(text).filter(Boolean),
    ),
  ];
  const warnings = [
    ...new Set(
      partials.flatMap((partial) => partial.warnings ?? []).map(text).filter(Boolean),
    ),
    `SEO_RUN_V11_SAME_MALL_UNIQUENESS_FALLBACK:${groups.size}`,
    `SEO_RUN_V11_GLOBAL_TITLE_REUSE:${globalReuseCount}`,
    `SEO_RUN_V11_PORTFOLIO_KEYWORD_COVERAGE:${coverage.length}/${portfolioFinals.length}`,
  ];

  return {
    rows,
    facts,
    keywordCoverageCount: coverage.length,
    keywordCoverageTotal: portfolioFinals.length,
    uniqueTitleCount,
    nearDuplicateCount: partials.reduce(
      (sum, partial) => sum + Math.max(0, Number(partial.nearDuplicateCount) || 0),
      0,
    ),
    warnings,
  };
}
