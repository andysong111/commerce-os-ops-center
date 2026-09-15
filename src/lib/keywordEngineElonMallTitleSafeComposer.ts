import {
  KEYWORD_ELON_SEO_FORBIDDEN_TERMS,
  KEYWORD_ELON_SEO_NOISE_TERMS,
  KEYWORD_ELON_SEO_SEARCH_TERM_BYTE_LIMIT,
  KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT,
  keywordElonSeoCanonical,
  keywordElonSeoUtf8Bytes,
  type KeywordElonSeoMarket,
} from "./keywordEngineElonLabSeoOutput.ts";
import {
  KEYWORD_ELON_LONG_TITLE_HARD_MIN_BYTES,
  KEYWORD_ELON_LONG_TITLE_IDEAL_MIN_BYTES,
  KEYWORD_ELON_LONG_TITLE_RECOMMENDED_MIN_BYTES,
  KEYWORD_ELON_LONG_TITLE_TARGET_BYTES,
  buildKeywordElonLongTitleExpansionMaterial,
  buildKeywordElonLongTitleFinalMaterial,
  enumerateKeywordElonLongTitleSegments,
  keywordElonLongTitleInternalRedundancyPenalty,
  keywordElonLongTitleLengthPenalty,
  keywordElonLongTitleMaterialPenalty,
  keywordElonLongTitleSegmentCountPenalty,
  type KeywordElonLongTitleMaterial,
} from "./keywordEngineElonLongTitlePriority.ts";
import type {
  KeywordElonTitleExpansionMaterial,
  KeywordElonTitleIntentClass,
} from "./keywordEngineElonTitleExpansion.ts";

export type KeywordElonMallTitleFactContext = {
  modelNumber?: string;
  productName: string;
  category?: string;
  optionText?: string;
  detailHtml?: string;
  mainImageUrl?: string;
  additionalImageUrls?: string[];
};

export type KeywordElonSafeMallTitleRow = {
  productGroup: string;
  groupSuffix: string;
  marketName: string;
  mallKey: string;
  accountIdLabel: string;
  title: string;
  byteLength: number;
  modelName: string;
  modelPosition: "first" | "after_lead";
  usedMaterials: string[];
  keywordMaterials: string[];
  titleKeywordSegments: string[];
  strategyLabel: string;
  variantIndex: number;
};

export type KeywordElonMallTitleSafeComposerResult = {
  rows: KeywordElonSafeMallTitleRow[];
  facts: string[];
  keywordCoverageCount: number;
  keywordCoverageTotal: number;
  uniqueTitleCount: number;
  nearDuplicateCount: number;
  warnings: string[];
};

type TitleCandidate = {
  title: string;
  segments: KeywordElonLongTitleMaterial[];
  canonical: string;
  byteLength: number;
  expansionCount: number;
  preferredExpansionCount: number;
  supportingExpansionCount: number;
  adjacentExpansionCount: number;
  intentClasses: KeywordElonTitleIntentClass[];
  materialPenalty: number;
  redundancyPenalty: number;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function clean(value: unknown) {
  return text(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/[\u3400-\u9fff]+/g, " ")
    .replace(/[·•:;,|/\\]+/g, " ")
    .replace(/[_~`^=*#@!?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function unique(values: unknown[], limit = 120) {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = clean(value);
    const key = keywordElonSeoCanonical(normalized);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function modelCodeLike(value: string, modelNumber = "") {
  const compact = value.replace(/\s+/g, "").toUpperCase();
  const model = modelNumber.replace(/\s+/g, "").toUpperCase();
  if (!compact) return false;
  if (model && compact === model) return true;
  if (/^\d{10,}$/.test(compact)) return true;
  if (/^[A-Z]{2,}\d{3,}$/.test(compact)) return true;
  if (/^[A-Z]{2,}\d+(?:-\d+)+$/.test(compact)) return true;
  if (/^(?:B|SKU|CODE)[:_-]?[A-Z0-9-]{4,}$/i.test(compact)) return true;
  return false;
}

function blockedKeys(blockedTerms: string[]) {
  return unique(
    [
      ...KEYWORD_ELON_SEO_FORBIDDEN_TERMS,
      ...KEYWORD_ELON_SEO_NOISE_TERMS,
      ...blockedTerms,
    ],
    160,
  ).map(keywordElonSeoCanonical);
}

function validateKeyword(
  keyword: string,
  context: KeywordElonMallTitleFactContext,
  blocked: string[],
) {
  if (modelCodeLike(keyword, context.modelNumber ?? "")) return false;
  if (keywordElonSeoUtf8Bytes(keyword) > KEYWORD_ELON_SEO_SEARCH_TERM_BYTE_LIMIT) {
    return false;
  }
  const key = keywordElonSeoCanonical(keyword);
  return !blocked.some((term) => term && key.includes(term));
}

function buildMaterials(input: {
  finalKeywords: string[];
  titleExpansionPool: KeywordElonTitleExpansionMaterial[];
  context: KeywordElonMallTitleFactContext;
  blockedTerms: string[];
}) {
  const blocked = blockedKeys(input.blockedTerms);
  const finals = unique(input.finalKeywords, 40);
  if (!finals.length) throw new Error("쇼핑몰별 상품명에 사용할 최종키워드가 없습니다.");

  for (const keyword of finals) {
    if (!validateKeyword(keyword, input.context, blocked)) {
      throw new Error(`쇼핑몰별 상품명 차단 · 부적합 최종키워드: ${keyword}`);
    }
  }

  const materials: KeywordElonLongTitleMaterial[] = finals.map(
    (keyword, index) =>
      buildKeywordElonLongTitleFinalMaterial({
        keyword,
        key: keywordElonSeoCanonical(keyword),
        sourceOrder: index,
      }),
  );
  const seen = new Set(materials.map((row) => row.key));
  for (let index = 0; index < input.titleExpansionPool.length; index += 1) {
    const row = input.titleExpansionPool[index];
    if (row.categoryAligned !== true) continue;
    const keyword = clean(row.keyword);
    const key = keywordElonSeoCanonical(keyword);
    if (!key || seen.has(key) || !validateKeyword(keyword, input.context, blocked)) continue;
    seen.add(key);
    materials.push(
      buildKeywordElonLongTitleExpansionMaterial({
        row,
        keyword,
        key,
        sourceOrder: finals.length + index,
      }),
    );
  }
  return { finals, materials };
}

function buildCandidatePool(
  materials: KeywordElonLongTitleMaterial[],
  finalKeys: Set<string>,
) {
  const result: TitleCandidate[] = [];
  const seen = new Set<string>();

  enumerateKeywordElonLongTitleSegments({
    materials,
    finalKeys,
    append: (segments) => {
      if (segments.length < 2) return false;
      if (!segments.some((segment) => finalKeys.has(segment.key))) return false;
      const title = segments
        .map((segment) => segment.keyword)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      const canonical = keywordElonSeoCanonical(title);
      const byteLength = keywordElonSeoUtf8Bytes(title);
      if (
        !canonical ||
        seen.has(canonical) ||
        byteLength < KEYWORD_ELON_LONG_TITLE_HARD_MIN_BYTES ||
        byteLength > KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT
      ) {
        return false;
      }
      seen.add(canonical);
      const intentClasses = [
        ...new Set(segments.map((segment) => segment.intentClass)),
      ];
      result.push({
        title,
        segments: [...segments],
        canonical,
        byteLength,
        expansionCount: segments.filter(
          (segment) => segment.origin === "category_expansion",
        ).length,
        preferredExpansionCount: segments.filter(
          (segment) => segment.priorityTier === "preferred",
        ).length,
        supportingExpansionCount: segments.filter(
          (segment) => segment.priorityTier === "supporting",
        ).length,
        adjacentExpansionCount: segments.filter(
          (segment) => segment.priorityTier === "adjacent",
        ).length,
        intentClasses,
        materialPenalty: segments.reduce(
          (sum, segment) =>
            sum + keywordElonLongTitleMaterialPenalty(segment),
          0,
        ),
        redundancyPenalty: keywordElonLongTitleInternalRedundancyPenalty(
          segments.map((segment) => segment.key),
        ),
      });
      return true;
    },
  });

  return result;
}

function tokenSet(value: string) {
  return new Set(value.split(/\s+/).map(keywordElonSeoCanonical).filter(Boolean));
}

function jaccard(left: string, right: string) {
  const a = tokenSet(left);
  const b = tokenSet(right);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 0;
}

function nearDuplicateCount(titles: string[]) {
  let count = 0;
  for (let index = 0; index < titles.length; index += 1) {
    for (let previous = 0; previous < index; previous += 1) {
      if (jaccard(titles[index], titles[previous]) >= 0.8) {
        count += 1;
        break;
      }
    }
  }
  return count;
}

function candidateScore(input: {
  candidate: TitleCandidate;
  primary: string;
  rowIndex: number;
  keywordUsage: Map<string, number>;
  intentUsage: Map<KeywordElonTitleIntentClass, number>;
  preferredExpansionAvailable: boolean;
  supportingExpansionAvailable: boolean;
}) {
  const {
    candidate,
    primary,
    rowIndex,
    keywordUsage,
    intentUsage,
    preferredExpansionAvailable,
    supportingExpansionAvailable,
  } = input;
  const primaryKey = keywordElonSeoCanonical(primary);
  const containsPrimary = candidate.segments.some(
    (segment) => segment.key === primaryKey,
  );
  const preferredFirst = rowIndex % 2 === 0;
  const primaryFirst = candidate.segments[0]?.key === primaryKey;
  const primaryPlacementPenalty = preferredFirst === primaryFirst ? 0 : 2;
  const usagePenalty = candidate.segments.reduce(
    (sum, segment) => sum + (keywordUsage.get(segment.key) ?? 0),
    0,
  );
  const intentPenalty = candidate.intentClasses.reduce(
    (sum, intent) => sum + (intentUsage.get(intent) ?? 0),
    0,
  );
  const expansionPriorityNudge = preferredExpansionAvailable
    ? candidate.preferredExpansionCount > 0
      ? 0
      : 3
    : supportingExpansionAvailable && candidate.supportingExpansionCount === 0
      ? 1.5
      : 0;
  const intentDiversityBonus = Math.max(
    0,
    candidate.intentClasses.length - 1,
  ) * -2;

  return (
    (containsPrimary ? 0 : 10_000) +
    primaryPlacementPenalty +
    keywordElonLongTitleLengthPenalty(candidate.byteLength) +
    keywordElonLongTitleSegmentCountPenalty(candidate.segments.length) +
    candidate.materialPenalty +
    candidate.redundancyPenalty +
    expansionPriorityNudge +
    usagePenalty * 2.2 +
    intentPenalty * 0.7 +
    intentDiversityBonus
  );
}

function selectCandidate(input: {
  candidates: TitleCandidate[];
  usedCanonical: Set<string>;
  primary: string;
  rowIndex: number;
  keywordUsage: Map<string, number>;
  intentUsage: Map<KeywordElonTitleIntentClass, number>;
  preferredExpansionAvailable: boolean;
  supportingExpansionAvailable: boolean;
}) {
  let best: TitleCandidate | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of input.candidates) {
    if (input.usedCanonical.has(candidate.canonical)) continue;
    const score = candidateScore({
      candidate,
      primary: input.primary,
      rowIndex: input.rowIndex,
      keywordUsage: input.keywordUsage,
      intentUsage: input.intentUsage,
      preferredExpansionAvailable: input.preferredExpansionAvailable,
      supportingExpansionAvailable: input.supportingExpansionAvailable,
    });
    if (
      score < bestScore ||
      (score === bestScore &&
        (!best || candidate.canonical.localeCompare(best.canonical, "ko") < 0))
    ) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

export function composeKeywordElonSafeMallTitles(input: {
  markets: KeywordElonSeoMarket[];
  finalKeywords: string[];
  titleExpansionPool?: KeywordElonTitleExpansionMaterial[];
  modelName: string;
  context: KeywordElonMallTitleFactContext;
  blockedTerms?: string[];
  allowValidatedTitleReuse?: boolean;
}): KeywordElonMallTitleSafeComposerResult {
  const { finals, materials } = buildMaterials({
    finalKeywords: input.finalKeywords,
    titleExpansionPool: input.titleExpansionPool ?? [],
    context: input.context,
    blockedTerms: input.blockedTerms ?? [],
  });
  const finalKeys = new Set(finals.map(keywordElonSeoCanonical));
  const expansionAvailable = materials.some(
    (row) => row.origin === "category_expansion",
  );
  const preferredExpansionAvailable = materials.some(
    (row) => row.priorityTier === "preferred",
  );
  const supportingExpansionAvailable = materials.some(
    (row) => row.priorityTier === "supporting",
  );
  const candidates = buildCandidatePool(materials, finalKeys);
  const allowValidatedTitleReuse = input.allowValidatedTitleReuse === true;
  if (!candidates.length || (!allowValidatedTitleReuse && candidates.length < input.markets.length)) {
    throw new Error(
      `검증 키워드만으로 ${KEYWORD_ELON_LONG_TITLE_HARD_MIN_BYTES}~${KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT}bytes 고유 쇼핑몰별 상품명 ${input.markets.length}개를 만들 수 없습니다. 현재 ${candidates.length}개 · SEO_TITLE_POOL_V10:markets=${input.markets.length},materials=${materials.length},reuse=${allowValidatedTitleReuse}`,
    );
  }

  const rows: KeywordElonSafeMallTitleRow[] = [];
  const selectedCandidates: TitleCandidate[] = [];
  const usedCanonical = new Set<string>();
  const keywordUsage = new Map<string, number>();
  const intentUsage = new Map<KeywordElonTitleIntentClass, number>();

  for (let index = 0; index < input.markets.length; index += 1) {
    const market = input.markets[index];
    const primary = finals[index % finals.length];
    const selected = selectCandidate({
      candidates,
      // Exhaust every distinct valid candidate before reusing any full title.
      usedCanonical: allowValidatedTitleReuse && usedCanonical.size === candidates.length
        ? new Set<string>()
        : usedCanonical,
      primary,
      rowIndex: index,
      keywordUsage,
      intentUsage,
      preferredExpansionAvailable,
      supportingExpansionAvailable,
    });
    if (!selected) throw new Error("카테고리 정합 상품명 후보가 부족합니다.");

    usedCanonical.add(selected.canonical);
    selectedCandidates.push(selected);
    for (const segment of selected.segments) {
      keywordUsage.set(segment.key, (keywordUsage.get(segment.key) ?? 0) + 1);
    }
    for (const intent of selected.intentClasses) {
      intentUsage.set(intent, (intentUsage.get(intent) ?? 0) + 1);
    }
    const segmentKeywords = selected.segments.map((segment) => segment.keyword);
    rows.push({
      productGroup: market.productGroup,
      groupSuffix: market.groupSuffix,
      marketName: market.marketName,
      mallKey: market.mallKey,
      accountIdLabel: market.accountIdLabel,
      title: selected.title,
      byteLength: selected.byteLength,
      modelName: input.modelName,
      modelPosition: index % 2 === 0 ? "first" : "after_lead",
      usedMaterials: segmentKeywords,
      keywordMaterials: segmentKeywords,
      titleKeywordSegments: segmentKeywords,
      strategyLabel: expansionAvailable
        ? "long-title-priority-v6"
        : "long-title-priority-v6-final-fallback",
      variantIndex: index,
    });
  }

  const coverage = finals.filter((keyword) => {
    const key = keywordElonSeoCanonical(keyword);
    return rows.some((row) =>
      row.keywordMaterials.some(
        (material) => keywordElonSeoCanonical(material) === key,
      ),
    );
  });
  if (coverage.length !== finals.length) {
    const missing = finals.filter((keyword) => !coverage.includes(keyword));
    throw new Error(`쇼핑몰별 상품명 최종키워드 커버 실패: ${missing.join(", ")}`);
  }

  const allowedKeys = new Set(materials.map((row) => row.key));
  for (const row of rows) {
    const bytes = keywordElonSeoUtf8Bytes(row.title);
    if (
      bytes < KEYWORD_ELON_LONG_TITLE_HARD_MIN_BYTES ||
      bytes > KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT
    ) {
      throw new Error(
        `쇼핑몰별 상품명이 ${KEYWORD_ELON_LONG_TITLE_HARD_MIN_BYTES}~${KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT}bytes 범위를 벗어났습니다.`,
      );
    }
    if (
      row.keywordMaterials.some(
        (material) => !allowedKeys.has(keywordElonSeoCanonical(material)),
      )
    ) {
      throw new Error(`검증되지 않은 상품명 재료가 포함되었습니다: ${row.title}`);
    }
  }

  const uniqueTitleCount = new Set(
    rows.map((row) => keywordElonSeoCanonical(row.title)),
  ).size;
  if (!allowValidatedTitleReuse && uniqueTitleCount !== rows.length) {
    throw new Error("쇼핑몰별 상품명에 중복이 발생했습니다.");
  }
  const nearDuplicates = nearDuplicateCount(rows.map((row) => row.title));
  const expansionUseCount = selectedCandidates.filter(
    (candidate) => candidate.expansionCount > 0,
  ).length;
  const preferredExpansionRows = selectedCandidates.filter(
    (candidate) => candidate.preferredExpansionCount > 0,
  ).length;
  const supportingExpansionRows = selectedCandidates.filter(
    (candidate) => candidate.supportingExpansionCount > 0,
  ).length;
  const adjacentExpansionRows = selectedCandidates.filter(
    (candidate) => candidate.adjacentExpansionCount > 0,
  ).length;
  const idealLengthRows = rows.filter(
    (row) => row.byteLength >= KEYWORD_ELON_LONG_TITLE_IDEAL_MIN_BYTES,
  ).length;
  const recommendedLengthRows = rows.filter(
    (row) => row.byteLength >= KEYWORD_ELON_LONG_TITLE_RECOMMENDED_MIN_BYTES,
  ).length;
  const fallbackLengthRows = rows.length - recommendedLengthRows;
  const averageLengthBytes =
    Math.round(
      (rows.reduce((sum, row) => sum + row.byteLength, 0) / rows.length) *
        1000,
    ) / 1000;

  return {
    rows,
    facts: [],
    keywordCoverageCount: coverage.length,
    keywordCoverageTotal: finals.length,
    uniqueTitleCount,
    nearDuplicateCount: nearDuplicates,
    warnings: [
      `SEO_MALL_TITLE_VALID_CANDIDATE_COUNT:${candidates.length}`,
      ...(rows.length > uniqueTitleCount
        ? [`SEO_MALL_TITLE_VALIDATED_REUSE:${rows.length - uniqueTitleCount}`]
        : []),
      expansionAvailable
        ? "SEO_MALL_TITLE_SOURCE:LONG_TITLE_PRIORITY_V6"
        : "SEO_MALL_TITLE_SOURCE:LONG_TITLE_PRIORITY_V6_FINAL_FALLBACK",
      `SEO_MALL_TITLE_EXPANSION_POOL:${materials.length - finals.length}`,
      `SEO_MALL_TITLE_EXPANSION_USED_ROWS:${expansionUseCount}/${rows.length}`,
      `SEO_MALL_TITLE_PREFERRED_EXPANSION_ROWS:${preferredExpansionRows}/${rows.length}`,
      `SEO_MALL_TITLE_SUPPORTING_EXPANSION_ROWS:${supportingExpansionRows}/${rows.length}`,
      `SEO_MALL_TITLE_ADJACENT_EXPANSION_ROWS:${adjacentExpansionRows}/${rows.length}`,
      `SEO_MALL_TITLE_LENGTH_HARD_RANGE:${KEYWORD_ELON_LONG_TITLE_HARD_MIN_BYTES}-${KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT}`,
      `SEO_MALL_TITLE_LENGTH_RECOMMENDED_ROWS:${recommendedLengthRows}/${rows.length}`,
      `SEO_MALL_TITLE_LENGTH_IDEAL_ROWS:${idealLengthRows}/${rows.length}`,
      `SEO_MALL_TITLE_LENGTH_FALLBACK_ROWS:${fallbackLengthRows}/${rows.length}`,
      `SEO_MALL_TITLE_LENGTH_TARGET:${KEYWORD_ELON_LONG_TITLE_TARGET_BYTES}`,
      `SEO_MALL_TITLE_LENGTH_AVERAGE:${averageLengthBytes}`,
      `SEO_MALL_TITLE_KEYWORD_COVERAGE:${coverage.length}/${finals.length}`,
      ...(nearDuplicates
        ? [`SEO_MALL_TITLE_NEAR_DUPLICATES_REMAIN:${nearDuplicates}`]
        : []),
    ],
  };
}
