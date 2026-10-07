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
  KEYWORD_ELON_V2_RELEVANCE_GATE,
  KEYWORD_ELON_V2_SHOPPING_INTENT_GATE,
  type KeywordElonCandidate,
  type KeywordElonDiscovery,
  type KeywordElonIdentity,
  type KeywordElonSourceDraft,
} from "./keywordEngineElonLabV2";
import { discoverKeywordElonCandidatesResilient } from "./keywordEngineElonLabV2Discovery";
import { enrichKeywordElonDemand } from "./keywordEngineElonLabV2DemandEnrichment";
import { scoreKeywordElonCandidatesBatched } from "./keywordEngineElonLabV2Scoring";
import { generateKeywordElonTitle } from "./keywordEngineElonLabV2Server";
import {
  composeKeywordResearchTitle,
  keywordResearchTitleCoverage,
} from "./keywordResearchTitle";

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

  const source = sourceFor(keyword);
  const identity = identityFor(keyword);
  let discovery = await discoverKeywordElonCandidatesResilient(source, identity);
  if (!discovery.searchAdConfigured) {
    throw new Error("네이버 SearchAd 키워드 도구가 연결되지 않았습니다.");
  }
  if (!discovery.candidates.length) {
    throw new Error("연관 키워드를 확장하지 못했습니다. 더 구체적인 상품 키워드로 다시 조회해 주세요.");
  }

  let semantic = await scoreSemantics(keyword, discovery);
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

  return {
    ok: true as const,
    requestId: requestId(),
    keyword,
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

function finiteNumber(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export async function generateKeywordResearchTitle(
  rawKeyword: unknown,
  rawRows: unknown,
  rawMode: unknown = "auto",
) {
  const keyword = normalizeKeywordResearchInput(rawKeyword);
  if (keyword.length < 2) throw new Error("상품명 생성 기준 키워드가 올바르지 않습니다.");
  if (!Array.isArray(rawRows)) throw new Error("상품명에 사용할 키워드를 선택해 주세요.");

  const candidates: KeywordElonCandidate[] = rawRows
    .filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object")
    .filter((row) => row.enginePass === true)
    .map((row) => {
      const candidateKeyword = normalizeKeywordResearchInput(row.keyword);
      const relevance = Math.max(0, Math.min(100, finiteNumber(row.relevance, 80)));
      const shoppingIntent = Math.max(0, Math.min(100, finiteNumber(row.shoppingIntent, 70)));
      const specificity = Math.max(0, Math.min(100, finiteNumber(row.specificity, 70)));
      const totalSearch = nullableNumber(row.totalSearch);
      return {
        keyword: candidateKeyword,
        searchKey: compactKeywordElonKey(candidateKeyword),
        searchKeyword: compactKeywordElonKey(candidateKeyword),
        relevance,
        shoppingIntent,
        specificity,
        titleEligible: true,
        rationale: normalizeKeywordResearchInput(row.rationale) || "키워드 조회 엔진 통과 후보",
        sourceTags: Array.isArray(row.sourceTags)
          ? row.sourceTags.map(normalizeKeywordResearchInput).filter(Boolean).slice(0, 12)
          : ["키워드 조회 엔진 통과"],
        totalSearch,
        pcSearch: nullableNumber(row.pcSearch),
        mobileSearch: nullableNumber(row.mobileSearch),
        compIdx: normalizeKeywordResearchInput(row.competitionIndex) || null,
        plAvgDepth: nullableNumber(row.averageExposureDepth),
        demandScore: finiteNumber(row.demandScore, 0),
        competitionOpportunity: finiteNumber(row.competitionOpportunity, 0),
        qualityScore: finiteNumber(row.opportunityScore, 0),
        safetyPass: true,
        safetyReason: "키워드 조회 의미·쇼핑의도 Gate 통과",
        dataConfidence: totalSearch === null ? "medium" : "high",
      } satisfies KeywordElonCandidate;
    })
    .filter(
      (row) =>
        row.searchKey &&
        row.relevance >= KEYWORD_ELON_V2_RELEVANCE_GATE &&
        row.shoppingIntent >= KEYWORD_ELON_V2_SHOPPING_INTENT_GATE,
    )
    .filter((row, index, rows) => rows.findIndex((item) => item.searchKey === row.searchKey) === index)
    .slice(0, 12);

  if (!candidates.length) {
    throw new Error("엔진 통과 키워드를 한 개 이상 선택해 주세요.");
  }

  const mode = rawMode === "selected" ? "selected" : "auto";
  const fallback = composeKeywordResearchTitle({
    seed: keyword,
    mode,
    materials: candidates.map((row) => ({
      keyword: row.keyword,
      relevance: row.relevance,
      shoppingIntent: row.shoppingIntent,
      specificity: row.specificity,
      opportunityScore: row.qualityScore,
      enginePass: row.safetyPass,
    })),
  });

  const titleResult = await generateKeywordElonTitle({
    source: sourceFor(keyword),
    identity: identityFor(keyword),
    candidates,
    cutoff: 0,
  });
  const requiredCoverage = fallback.usedKeywords.length;
  const actualCoverage = keywordResearchTitleCoverage(
    titleResult.title,
    fallback.usedKeywords,
  );
  const repairedTitleResult = actualCoverage >= requiredCoverage
    ? titleResult
    : {
        ...fallback,
        model: `${titleResult.model}+keyword_coverage_repair`,
        warning: [titleResult.warning, "상품명 재료 반영 부족을 엔진이 자동 보정했습니다."]
          .filter(Boolean)
          .join(" · "),
      };

  return {
    ok: true as const,
    action: "generate_title" as const,
    titleResult: repairedTitleResult,
  };
}
