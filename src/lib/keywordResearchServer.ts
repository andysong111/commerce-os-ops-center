import { randomBytes } from "node:crypto";
import {
  buildKeywordResearchRows,
  keywordResearchSummary,
  KEYWORD_RESEARCH_RESULT_LIMIT,
  KEYWORD_RESEARCH_SUPPLY_LIMIT,
  normalizeKeywordResearchInput,
} from "./keywordResearch";
import {
  compactKeywordElonKey,
  type KeywordElonCandidate,
  type KeywordElonDiscovery,
  type KeywordElonIdentity,
  type KeywordElonSourceDraft,
} from "./keywordEngineElonLabV2";
import { discoverKeywordElonSearchAd } from "./keywordEngineElonLabV2SearchAd";
import { scoreKeywordElonCandidatesBatched } from "./keywordEngineElonLabV2Scoring";

const NAVER_SHOPPING_SEARCH_URL = "https://openapi.naver.com/v1/search/shop.json";
const AI_CANDIDATE_LIMIT = 36;

function requestId() {
  return `keyword-research-${new Date().toISOString().replace(/[-:.]/g, "")}-${randomBytes(3).toString("hex")}`;
}

function sourceFor(seed: string): KeywordElonSourceDraft {
  return {
    url: "",
    offerId: "",
    autoStatus: "success",
    chineseTitle: seed,
    optionText: "",
    supportingText: "키워드 직접 조회",
    warnings: ["DIRECT_KEYWORD_RESEARCH"],
    collectedAt: new Date().toISOString(),
  };
}

function identityFor(seed: string): KeywordElonIdentity {
  return {
    koreanProductIdentity: seed,
    coreProduct: seed,
    identityAnchor: seed,
    primarySeeds: [seed],
    conditionalSeeds: [],
    functionModifiers: [],
    designShapeModifiers: [],
    specAttributes: [],
    variantNoise: [],
    confidence: 1,
    reasoning: "운영자가 직접 입력한 키워드를 상품 정체성 기준으로 사용",
    model: "direct-keyword-research",
  };
}

function discoveryFor(
  seed: string,
  searchAd: Awaited<ReturnType<typeof discoverKeywordElonSearchAd>>,
): KeywordElonDiscovery {
  const rankedRows = [...searchAd.rows]
    .sort((left, right) => (right.totalSearch ?? -1) - (left.totalSearch ?? -1))
  const seedKey = compactKeywordElonKey(seed);
  const exactSeedRow = rankedRows.find(
    (row) => compactKeywordElonKey(row.keyword) === seedKey,
  );
  const rows = [
    ...(exactSeedRow ? [exactSeedRow] : []),
    ...rankedRows.filter((row) => compactKeywordElonKey(row.keyword) !== seedKey),
  ].slice(0, AI_CANDIDATE_LIMIT);
  const candidates = rows.map((row) => compactKeywordElonKey(row.keyword));
  const sourceTagsByKeyword = Object.fromEntries(
    rows.map((row) => [
      compactKeywordElonKey(row.keyword),
      [
        ...(compactKeywordElonKey(row.keyword) === seedKey ? ["입력 키워드"] : []),
        "SearchAd 연관키워드",
        ...(row.sourceSeeds.length > 1 ? ["다중 Seed 발견"] : []),
      ],
    ]),
  );
  return {
    candidates,
    sourceTagsByKeyword,
    searchAdStats: rows,
    searchAdConfigured: searchAd.configured,
    searchAdWarnings: searchAd.warnings,
    aiGeneratedCount: 0,
    relatedKeywordCount: rows.length,
    demandExpansionSeeds: searchAd.expansionSeeds,
    demandExpansionSeedCount: searchAd.expansionSeeds.length,
    demandExplorationDepth: searchAd.explorationDepth,
    model: "naver-searchad-keyword-tool",
  };
}

async function scoreSemantics(seed: string, discovery: KeywordElonDiscovery) {
  if (!process.env.KEYWORD_ENGINE_OPENAI_API_KEY?.trim()) {
    return {
      candidates: [] as KeywordElonCandidate[],
      warnings: ["AI 의미 적합성 키가 없어 SearchAd 기본 점수로 표시했습니다."],
      model: "fallback",
    };
  }
  try {
    const scored = await scoreKeywordElonCandidatesBatched({
      source: sourceFor(seed),
      identity: identityFor(seed),
      discovery,
    });
    return {
      candidates: scored.candidates,
      warnings: scored.scoringWarnings,
      model: scored.model,
    };
  } catch (error) {
    return {
      candidates: [] as KeywordElonCandidate[],
      warnings: [
        error instanceof Error
          ? `AI 의미 적합성 판정을 건너뛰었습니다: ${error.message}`
          : "AI 의미 적합성 판정을 건너뛰었습니다.",
      ],
      model: "fallback",
    };
  }
}

async function fetchShoppingProductCount(keyword: string) {
  const clientId = process.env.NAVER_SEARCH_CLIENT_ID?.trim();
  const clientSecret = process.env.NAVER_SEARCH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  const url = new URL(NAVER_SHOPPING_SEARCH_URL);
  url.searchParams.set("query", keyword);
  url.searchParams.set("display", "1");
  url.searchParams.set("start", "1");
  url.searchParams.set("sort", "sim");
  url.searchParams.set("exclude", "cbshop");
  try {
    const response = await fetch(url, {
      headers: {
        "X-Naver-Client-Id": clientId,
        "X-Naver-Client-Secret": clientSecret,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { total?: unknown };
    const total = Number(payload.total);
    return Number.isFinite(total) && total >= 0 ? total : null;
  } catch {
    return null;
  }
}

async function loadSupplyCounts(keywords: string[]) {
  const supply: Record<string, number> = {};
  for (let index = 0; index < keywords.length; index += 4) {
    const batch = keywords.slice(index, index + 4);
    const results = await Promise.all(
      batch.map(async (keyword) => ({
        keyword,
        total: await fetchShoppingProductCount(keyword),
      })),
    );
    for (const result of results) {
      if (result.total !== null) supply[compactKeywordElonKey(result.keyword)] = result.total;
    }
  }
  return supply;
}

export async function researchKeyword(rawKeyword: unknown) {
  const keyword = normalizeKeywordResearchInput(rawKeyword);
  if (keyword.length < 2) throw new Error("두 글자 이상의 키워드를 입력해 주세요.");
  if (keyword.length > 40) throw new Error("키워드는 40자 이하로 입력해 주세요.");

  const searchAd = await discoverKeywordElonSearchAd([keyword]);
  if (!searchAd.configured) {
    throw new Error("네이버 SearchAd 키워드 도구가 연결되지 않았습니다.");
  }
  if (!searchAd.rows.length) {
    throw new Error("연관 키워드를 찾지 못했습니다. 더 구체적인 상품 키워드로 다시 조회해 주세요.");
  }

  const discovery = discoveryFor(keyword, searchAd);
  const semantic = await scoreSemantics(keyword, discovery);
  const firstRows = buildKeywordResearchRows({
    seed: keyword,
    stats: discovery.searchAdStats,
    semanticCandidates: semantic.candidates,
  });
  const supplyTargets = firstRows
    .slice(0, KEYWORD_RESEARCH_SUPPLY_LIMIT)
    .map((row) => row.keyword);
  const supplyByKeyword = await loadSupplyCounts(supplyTargets);
  const rows = buildKeywordResearchRows({
    seed: keyword,
    stats: discovery.searchAdStats,
    semanticCandidates: semantic.candidates,
    supplyByKeyword,
  }).slice(0, KEYWORD_RESEARCH_RESULT_LIMIT);

  return {
    ok: true as const,
    requestId: requestId(),
    keyword,
    generatedAt: new Date().toISOString(),
    summary: keywordResearchSummary(keyword, rows),
    rows,
    engine: {
      searchAdConfigured: searchAd.configured,
      semanticModel: semantic.model,
      semanticScoringApplied: semantic.candidates.length > 0,
      shoppingSupplyApplied: Object.keys(supplyByKeyword).length > 0,
      explorationDepth: searchAd.explorationDepth,
      expansionSeeds: searchAd.expansionSeeds,
    },
    warnings: [...new Set([...searchAd.warnings, ...semantic.warnings])].slice(0, 8),
  };
}
