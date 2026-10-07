import {
  calculateKeywordElonQuality,
  compactKeywordElonKey,
  keywordElonCompetitionOpportunity,
  keywordElonDemandScore,
  type KeywordElonCandidate,
  type KeywordElonSearchAdStat,
} from "./keywordEngineElonLabV2.ts";

// The production keyword engine caps discovery at 500 candidates. Keep the
// research view aligned with that ceiling so rare seeds are not reduced to a
// short preview after the engine has already done the expansion work.
export const KEYWORD_RESEARCH_RESULT_LIMIT = 500;
export const KEYWORD_RESEARCH_SUPPLY_LIMIT = 12;

export type KeywordResearchCompetition = "low" | "medium" | "high" | "unknown";
export type KeywordResearchQuality = "최적" | "추천" | "검토";

export type KeywordResearchRow = {
  keyword: string;
  totalSearch: number | null;
  pcSearch: number | null;
  mobileSearch: number | null;
  productCount: number | null;
  competition: KeywordResearchCompetition;
  competitionLabel: string;
  competitionIndex: string;
  averageExposureDepth: number | null;
  monthlyClicks: number | null;
  clickThroughRate: number | null;
  demandScore: number;
  competitionOpportunity: number;
  opportunityScore: number;
  relevance: number;
  shoppingIntent: number;
  specificity: number;
  quality: KeywordResearchQuality;
  enginePass: boolean;
  sourceTags: string[];
  rationale: string;
};

export type KeywordResearchSummary = {
  keywordCount: number;
  lowCompetitionCount: number;
  enginePassCount: number;
  bestOpportunityScore: number;
  seedSearchVolume: number | null;
};

export function normalizeKeywordResearchInput(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function keywordResearchCompetition(value: unknown): {
  value: KeywordResearchCompetition;
  label: string;
  index: string;
} {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (["LOW", "L", "낮음", "하"].includes(normalized)) {
    return { value: "low", label: "낮음", index: "LOW" };
  }
  if (["MID", "MEDIUM", "M", "중", "중간", "보통"].includes(normalized)) {
    return { value: "medium", label: "보통", index: "MID" };
  }
  if (["HIGH", "H", "높음", "상"].includes(normalized)) {
    return { value: "high", label: "높음", index: "HIGH" };
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value <= 33) return { value: "low", label: "낮음", index: "LOW" };
    if (value <= 66) return { value: "medium", label: "보통", index: "MID" };
    return { value: "high", label: "높음", index: "HIGH" };
  }
  return { value: "unknown", label: "미확인", index: normalized || "미확인" };
}

function fallbackSemantic(seed: string, keyword: string) {
  const seedKey = compactKeywordElonKey(seed);
  const keywordKey = compactKeywordElonKey(keyword);
  const exact = seedKey === keywordKey;
  const containsSeed = keywordKey.includes(seedKey);
  const containedBySeed = seedKey.includes(keywordKey);
  const relevance = exact ? 100 : containsSeed ? 92 : containedBySeed ? 84 : 76;
  const shoppingIntent = exact || containsSeed ? 88 : 78;
  const specificity = Math.min(96, 54 + keywordKey.length * 4);
  return {
    relevance,
    shoppingIntent,
    specificity,
    titleEligible: exact || containsSeed || containedBySeed,
    rationale: "SearchAd 연관어 기반 기본 점수 · AI 의미 판정 미적용",
  };
}

function scoreOpportunity(input: {
  demandScore: number;
  competitionOpportunity: number;
  relevance: number;
  shoppingIntent: number;
  productCount: number | null;
  enginePass: boolean;
}) {
  const supplyOpportunity =
    input.productCount === null
      ? input.competitionOpportunity
      : Math.max(0, Math.min(100, 100 - Math.log10(Math.max(1, input.productCount)) * 18));
  const score = Math.round(
    (input.demandScore * 0.35 +
      input.competitionOpportunity * 0.25 +
      supplyOpportunity * 0.15 +
      input.relevance * 0.15 +
      input.shoppingIntent * 0.1) *
      10,
  ) / 10;
  return input.enginePass ? score : Math.min(score, 59.9);
}

export function buildKeywordResearchRows(input: {
  seed: string;
  stats: KeywordElonSearchAdStat[];
  semanticCandidates?: KeywordElonCandidate[];
  candidateKeywords?: string[];
  supplyByKeyword?: Record<string, number>;
}) {
  const semanticByKeyword = new Map(
    (input.semanticCandidates ?? []).map((item) => [compactKeywordElonKey(item.keyword), item]),
  );
  const statsByKeyword = new Map(
    input.stats.map((item) => [compactKeywordElonKey(item.keyword || item.relKeyword), item]),
  );
  const candidateKeywords = input.candidateKeywords?.length
    ? input.candidateKeywords.map(compactKeywordElonKey)
    : [
        ...input.stats.map((item) => compactKeywordElonKey(item.keyword || item.relKeyword)),
        ...(input.semanticCandidates ?? []).map((item) => compactKeywordElonKey(item.keyword)),
      ];
  const seen = new Set<string>();
  const rows: KeywordResearchRow[] = [];

  for (const keyword of candidateKeywords) {
    if (!keyword || seen.has(keyword)) continue;
    seen.add(keyword);
    const semantic = semanticByKeyword.get(keyword);
    const stat = statsByKeyword.get(keyword);
    const fallback = fallbackSemantic(input.seed, keyword);
    const relevance = semantic?.relevance ?? fallback.relevance;
    const shoppingIntent = semantic?.shoppingIntent ?? fallback.shoppingIntent;
    const specificity = semantic?.specificity ?? fallback.specificity;
    const calculated = calculateKeywordElonQuality({
      relevance,
      shoppingIntent,
      specificity,
      totalSearch: stat?.totalSearch ?? semantic?.totalSearch ?? null,
      compIdx: stat?.compIdx ?? semantic?.compIdx ?? null,
      plAvgDepth: stat?.plAvgDepth ?? semantic?.plAvgDepth ?? null,
    });
    const competition = keywordResearchCompetition(stat?.compIdx ?? semantic?.compIdx);
    const productCount = input.supplyByKeyword?.[keyword] ?? null;
    const enginePass = semantic
      ? semantic.safetyPass
      : calculated.safetyPass && fallback.titleEligible;
    const opportunityScore = scoreOpportunity({
      demandScore:
        semantic?.demandScore ??
        keywordElonDemandScore(stat?.totalSearch ?? semantic?.totalSearch ?? null),
      competitionOpportunity:
        semantic?.competitionOpportunity ??
        keywordElonCompetitionOpportunity(
          stat?.compIdx ?? semantic?.compIdx ?? null,
          stat?.plAvgDepth ?? semantic?.plAvgDepth ?? null,
        ),
      relevance,
      shoppingIntent,
      productCount,
      enginePass,
    });
    const quality: KeywordResearchQuality =
      enginePass && opportunityScore >= 78
        ? "최적"
        : enginePass && opportunityScore >= 62
          ? "추천"
          : "검토";
    const monthlyClicks =
      !stat || (stat.monthlyAvePcClicks === null && stat.monthlyAveMobileClicks === null)
        ? null
        : (stat.monthlyAvePcClicks ?? 0) + (stat.monthlyAveMobileClicks ?? 0);
    const clickThroughRate =
      !stat || (stat.monthlyAvePcCtr === null && stat.monthlyAveMobileCtr === null)
        ? null
        : Math.round((((stat.monthlyAvePcCtr ?? 0) + (stat.monthlyAveMobileCtr ?? 0)) / 2) * 100) / 100;

    rows.push({
      keyword,
      totalSearch: stat?.totalSearch ?? semantic?.totalSearch ?? null,
      pcSearch: stat?.pcSearch ?? semantic?.pcSearch ?? null,
      mobileSearch: stat?.mobileSearch ?? semantic?.mobileSearch ?? null,
      productCount,
      competition: competition.value,
      competitionLabel: competition.label,
      competitionIndex: competition.index,
      averageExposureDepth: stat?.plAvgDepth ?? semantic?.plAvgDepth ?? null,
      monthlyClicks,
      clickThroughRate,
      demandScore: semantic?.demandScore ?? calculated.demandScore,
      competitionOpportunity:
        semantic?.competitionOpportunity ?? calculated.competitionOpportunity,
      opportunityScore,
      relevance,
      shoppingIntent,
      specificity,
      quality,
      enginePass,
      sourceTags: semantic?.sourceTags?.length
        ? semantic.sourceTags
        : ["SearchAd 연관키워드"],
      rationale: semantic?.rationale ?? fallback.rationale,
    });
  }

  return rows
    .sort(
      (left, right) =>
        right.opportunityScore - left.opportunityScore ||
        (right.totalSearch ?? -1) - (left.totalSearch ?? -1) ||
        left.keyword.localeCompare(right.keyword, "ko"),
    )
    .slice(0, KEYWORD_RESEARCH_RESULT_LIMIT);
}

export function keywordResearchSummary(
  seed: string,
  rows: KeywordResearchRow[],
): KeywordResearchSummary {
  const seedKey = compactKeywordElonKey(seed);
  const seedRow = rows.find((row) => compactKeywordElonKey(row.keyword) === seedKey);
  return {
    keywordCount: rows.length,
    lowCompetitionCount: rows.filter((row) => row.competition === "low").length,
    enginePassCount: rows.filter((row) => row.enginePass).length,
    bestOpportunityScore: rows[0]?.opportunityScore ?? 0,
    seedSearchVolume: seedRow?.totalSearch ?? null,
  };
}

export function isKeywordResearchSaveable(row: KeywordResearchRow) {
  return (
    row.competition === "low" &&
    row.enginePass &&
    (row.quality === "최적" || row.quality === "추천")
  );
}
