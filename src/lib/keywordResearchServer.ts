import { randomBytes } from "node:crypto";
import {
  buildKeywordResearchRows,
  enginePassedKeywordResearchRows,
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
import { discoverKeywordElonCandidatesResilient } from "./keywordEngineElonLabV2Discovery";
import { enrichKeywordElonDemand } from "./keywordEngineElonLabV2DemandEnrichment";
import { scoreKeywordElonCandidatesBatched } from "./keywordEngineElonLabV2Scoring";
import {
  analyzeKeywordElonIdentity,
  collectKeywordElon1688Source,
  generateKeywordElonTitle,
} from "./keywordEngineElonLabV2Server";

const NAVER_SHOPPING_SEARCH_URL = "https://openapi.naver.com/v1/search/shop.json";

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

async function scoreSemantics(input: {
  source: KeywordElonSourceDraft;
  identity: KeywordElonIdentity;
  discovery: KeywordElonDiscovery;
}) {
  if (!process.env.KEYWORD_ENGINE_OPENAI_API_KEY?.trim()) {
    return {
      candidates: [] as KeywordElonCandidate[],
      warnings: ["AI 의미 적합성 키가 없어 SearchAd 기본 점수로 표시했습니다."],
      model: "fallback",
    };
  }
  try {
    const scored = await scoreKeywordElonCandidatesBatched({
      source: input.source,
      identity: input.identity,
      discovery: input.discovery,
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

async function researchFromIdentity(input: {
  keyword: string;
  source: KeywordElonSourceDraft;
  identity: KeywordElonIdentity;
  sourceMode: "keyword" | "source_link";
}) {
  const { keyword, source, identity } = input;
  let discovery = await discoverKeywordElonCandidatesResilient(source, identity);
  if (!discovery.searchAdConfigured) {
    throw new Error("네이버 SearchAd 키워드 도구가 연결되지 않았습니다.");
  }
  if (!discovery.candidates.length) {
    throw new Error("연관 키워드를 확장하지 못했습니다. 더 구체적인 상품 키워드로 다시 조회해 주세요.");
  }

  let semantic = await scoreSemantics({ source, identity, discovery });
  const demandWarnings: string[] = [];
  if (semantic.candidates.length) {
    try {
      const enriched = await enrichKeywordElonDemand({
        candidates: semantic.candidates,
        discovery,
      });
      semantic = { ...semantic, candidates: enriched.candidates };
      discovery = enriched.discovery;
      demandWarnings.push(...enriched.warnings);
    } catch (error) {
      demandWarnings.push(
        error instanceof Error
          ? `확장 후보 검색량 보강을 건너뛰었습니다: ${error.message}`
          : "확장 후보 검색량 보강을 건너뛰었습니다.",
      );
    }
  }
  const firstRows = enginePassedKeywordResearchRows(buildKeywordResearchRows({
    seed: keyword,
    stats: discovery.searchAdStats,
    semanticCandidates: semantic.candidates,
    candidateKeywords: discovery.candidates,
  }));
  const supplyTargets = firstRows
    .slice(0, KEYWORD_RESEARCH_SUPPLY_LIMIT)
    .map((row) => row.keyword);
  const supplyByKeyword = await loadSupplyCounts(supplyTargets);
  const rows = enginePassedKeywordResearchRows(buildKeywordResearchRows({
    seed: keyword,
    stats: discovery.searchAdStats,
    semanticCandidates: semantic.candidates,
    candidateKeywords: discovery.candidates,
    supplyByKeyword,
  })).slice(0, KEYWORD_RESEARCH_RESULT_LIMIT);

  const recommendedTitle = input.sourceMode === "source_link"
    ? await generateKeywordElonTitle({
        source,
        identity,
        candidates: [...semantic.candidates].sort(
          (left, right) => right.qualityScore - left.qualityScore,
        ),
        cutoff: 0,
      })
    : null;

  return {
    ok: true as const,
    requestId: requestId(),
    keyword,
    sourceMode: input.sourceMode,
    recommendedTitle: recommendedTitle?.title ?? "",
    generatedAt: new Date().toISOString(),
    summary: keywordResearchSummary(keyword, rows),
    rows,
    engine: {
      searchAdConfigured: discovery.searchAdConfigured,
      discoveredCandidateCount: discovery.candidates.length,
      aiGeneratedCount: discovery.aiGeneratedCount,
      marketEvidenceCount: discovery.marketTerms?.length ?? 0,
      semanticModel: semantic.model,
      semanticScoringApplied: semantic.candidates.length > 0,
      shoppingSupplyApplied: Object.keys(supplyByKeyword).length > 0,
      explorationDepth: discovery.demandExplorationDepth ?? 1,
      expansionSeeds: discovery.demandExpansionSeeds ?? [],
    },
    warnings: [
      ...new Set([
        ...discovery.searchAdWarnings,
        ...semantic.warnings,
        ...demandWarnings,
      ]),
    ].slice(0, 12),
  };
}

export async function researchKeyword(rawKeyword: unknown) {
  const keyword = normalizeKeywordResearchInput(rawKeyword);
  if (keyword.length < 2) throw new Error("두 글자 이상의 키워드를 입력해 주세요.");
  if (keyword.length > 40) throw new Error("키워드는 40자 이하로 입력해 주세요.");

  return researchFromIdentity({
    keyword,
    source: sourceFor(keyword),
    identity: identityFor(keyword),
    sourceMode: "keyword",
  });
}

export async function research1688Source(rawSourceUrl: unknown) {
  const sourceUrl = normalizeKeywordResearchInput(rawSourceUrl);
  const source = await collectKeywordElon1688Source(sourceUrl);
  const identity = await analyzeKeywordElonIdentity(source);
  const keyword = normalizeKeywordResearchInput(
    identity.identityAnchor || identity.coreProduct || identity.koreanProductIdentity,
  );
  if (keyword.length < 2) {
    throw new Error("1688 상품에서 한국 판매용 상품 정체성을 확인하지 못했습니다.");
  }

  return researchFromIdentity({
    keyword,
    source,
    identity,
    sourceMode: "source_link",
  });
}
