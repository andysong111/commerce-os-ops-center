import {
  composeKeywordElonSafeMallTitles,
  type KeywordElonMallTitleFactContext,
  type KeywordElonMallTitleSafeComposerResult,
} from "./keywordEngineElonMallTitleSafeComposer.ts";
import { rebalanceKeywordElonMallTitleDiversityV8 } from "./keywordEngineElonMallTitleDiversityV8.ts";
import { rebalanceKeywordElonSameMallTitleDiversityV9 } from "./keywordEngineElonSameMallTitleDiversityV9.ts";
import { composeKeywordElonIntentPortfolioV7 } from "./keywordEngineElonMallTitleIntentPortfolioV7.ts";
import {
  KEYWORD_ELON_SEO_SEARCH_TERM_BYTE_LIMIT,
  keywordElonSeoCanonical,
  keywordElonSeoUtf8Bytes,
  type KeywordElonSeoMarket,
} from "./keywordEngineElonLabSeoOutput.ts";
import type { KeywordElonTitleExpansionMaterial } from "./keywordEngineElonTitleExpansion.ts";

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function canonical(value: unknown) {
  return text(value).replace(/\s+/g, "").toLowerCase();
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function rotate<T>(values: T[], offset: number) {
  if (!values.length) return values;
  const normalized = ((offset % values.length) + values.length) % values.length;
  return [...values.slice(normalized), ...values.slice(0, normalized)];
}

function tokenSet(value: string) {
  return new Set(
    text(value)
      .split(/\s+/)
      .map(canonical)
      .filter(Boolean),
  );
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

function freshnessScore(
  result: KeywordElonMallTitleSafeComposerResult,
  excludedTitles: string[],
) {
  if (!excludedTitles.length) return 0;
  const excludedCanonical = new Set(excludedTitles.map(canonical).filter(Boolean));
  let exact = 0;
  let reorderOnly = 0;
  let similarity = 0;
  for (const row of result.rows) {
    const rowCanonical = canonical(row.title);
    if (excludedCanonical.has(rowCanonical)) exact += 1;
    let maxSimilarity = 0;
    for (const previous of excludedTitles) {
      maxSimilarity = Math.max(maxSimilarity, jaccard(row.title, previous));
      if (maxSimilarity >= 1) break;
    }
    if (maxSimilarity >= 0.999 && !excludedCanonical.has(rowCanonical)) reorderOnly += 1;
    similarity += maxSimilarity;
  }
  return exact * 100_000 + reorderOnly * 20_000 + similarity * 100;
}

/** History is a preference, not a blacklist of previously used words. */
export function preservesKeywordElonHistoricalFreshness(
  current: KeywordElonMallTitleSafeComposerResult,
  proposed: KeywordElonMallTitleSafeComposerResult,
  excludedTitles: string[],
) {
  if (!excludedTitles.length) return true;
  const excluded = new Set(excludedTitles.map(canonical).filter(Boolean));
  const exactCount = (result: KeywordElonMallTitleSafeComposerResult) =>
    result.rows.filter(row => excluded.has(canonical(row.title))).length;
  // Never sacrifice already-achieved full-title non-reuse for a later local
  // mall rebalance. Limited material is still usable: equal reuse is allowed.
  return exactCount(proposed) <= exactCount(current) &&
    freshnessScore(proposed, excludedTitles) <= freshnessScore(current, excludedTitles) + 0.001;
}

function safeWarning(value: unknown) {
  return text(value).replace(/[\r\n]+/g, " ").slice(0, 300);
}

function verifiedModelFragments(modelName: string) {
  const normalized = text(modelName);
  const modelKey = keywordElonSeoCanonical(normalized);
  if (!modelKey || modelKey.includes("상품명확인필요")) return [];

  const words = normalized.split(/\s+/).filter(Boolean);
  const phrases: string[] = [];
  const seen = new Set<string>();
  const add = (value: string) => {
    const phrase = text(value);
    const key = keywordElonSeoCanonical(phrase);
    const bytes = keywordElonSeoUtf8Bytes(phrase);
    if (
      !key ||
      key.length < 2 ||
      seen.has(key) ||
      bytes > KEYWORD_ELON_SEO_SEARCH_TERM_BYTE_LIMIT
    ) {
      return;
    }
    seen.add(key);
    phrases.push(phrase);
  };

  add(normalized);
  const maxWindow = Math.min(3, words.length);
  for (let width = maxWindow; width >= 2; width -= 1) {
    for (let start = 0; start + width <= words.length; start += 1) {
      add(words.slice(start, start + width).join(" "));
    }
  }
  for (const word of words) {
    if (keywordElonSeoUtf8Bytes(word) >= 6) add(word);
  }
  return phrases.slice(0, 8);
}

function buildSparseModelSupports(input: {
  finals: string[];
  expansion: KeywordElonTitleExpansionMaterial[];
  modelName: string;
}) {
  if (input.finals.length > 7) return [];
  const used = new Set(
    [
      ...input.finals,
      ...input.expansion.map((row) => row.keyword),
    ]
      .map(keywordElonSeoCanonical)
      .filter(Boolean),
  );

  const supports: KeywordElonTitleExpansionMaterial[] = [];
  for (const keyword of verifiedModelFragments(input.modelName)) {
    const key = keywordElonSeoCanonical(keyword);
    if (!key || used.has(key)) continue;
    used.add(key);
    supports.push({
      keyword,
      intentClass: "core_synonym",
      categoryAligned: true,
      categoryMatch: 100,
      relevance: 100,
      shoppingIntent: 90,
      specificity: 95,
      qualityScore: 90,
      competitionOpportunity: 50,
      totalSearch: null,
      expansionScore: Math.max(88, 96 - supports.length),
    });
  }
  return supports;
}

export function composeFreshKeywordElonMallTitles(input: {
  markets: KeywordElonSeoMarket[];
  finalKeywords: string[];
  titleExpansionPool?: KeywordElonTitleExpansionMaterial[];
  modelName: string;
  context: KeywordElonMallTitleFactContext;
  blockedTerms?: string[];
  excludedTitles?: string[];
  variationSeed?: string;
}): KeywordElonMallTitleSafeComposerResult {
  const finals = [...input.finalKeywords];
  const baseExpansion = [...(input.titleExpansionPool ?? [])];
  const sparseModelSupports = buildSparseModelSupports({
    finals,
    expansion: baseExpansion,
    modelName: input.modelName,
  });
  const expansion = sparseModelSupports.length
    ? [...sparseModelSupports, ...baseExpansion]
    : baseExpansion;
  const excludedTitles = [
    ...new Set((input.excludedTitles ?? []).map(text).filter(Boolean)),
  ].slice(0, 1200);
  const deterministicSeed =
    input.variationSeed ||
    `${input.context.modelNumber ?? ""}:${input.modelName}:${finals.join("|")}`;
  const seed = stableHash(deterministicSeed);
  const attempts = Math.min(
    18,
    Math.max(8, finals.length + Math.min(expansion.length, 8)),
  );
  const attemptResults: KeywordElonMallTitleSafeComposerResult[] = [];
  let best: KeywordElonMallTitleSafeComposerResult | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  let bestAttempt = 0;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const finalOffset = finals.length ? (seed + attempt * 3) % finals.length : 0;
    const expansionOffset = expansion.length
      ? (seed * 7 + attempt * 5) % expansion.length
      : 0;
    const result = composeKeywordElonSafeMallTitles({
      markets: input.markets,
      finalKeywords: rotate(finals, finalOffset),
      titleExpansionPool: rotate(expansion, expansionOffset),
      modelName: input.modelName,
      context: input.context,
      blockedTerms: input.blockedTerms,
    });
    attemptResults.push(result);
    const score = freshnessScore(result, excludedTitles);
    if (score < bestScore) {
      best = result;
      bestScore = score;
      bestAttempt = attempt;
    }
  }

  if (!best) throw new Error("SEO 회차 상품명 후보를 만들지 못했습니다.");

  let selected = best;
  let portfolioWarning = "SEO_RUN_INTENT_PORTFOLIO_V7:enabled";
  try {
    const proposed = composeKeywordElonIntentPortfolioV7({
      attempts: attemptResults,
      finalKeywords: finals,
      expansionPool: expansion,
      excludedTitles,
    });
    if (preservesKeywordElonHistoricalFreshness(selected, proposed, excludedTitles)) {
      selected = proposed;
    } else {
      portfolioWarning = "SEO_RUN_INTENT_PORTFOLIO_V7:kept_history_preference";
    }
  } catch (error) {
    portfolioWarning = `SEO_RUN_INTENT_PORTFOLIO_V7_FALLBACK:${safeWarning(
      error instanceof Error ? error.message : error,
    )}`;
  }

  let diversityWarning = "SEO_RUN_MALL_TITLE_DIVERSITY_V8:enabled";
  try {
    const proposed = rebalanceKeywordElonMallTitleDiversityV8({
      attempts: attemptResults,
      selected,
      finalKeywords: finals,
      excludedTitles,
    });
    if (preservesKeywordElonHistoricalFreshness(selected, proposed, excludedTitles)) {
      selected = proposed;
    } else {
      diversityWarning = "SEO_RUN_MALL_TITLE_DIVERSITY_V8:kept_history_preference";
    }
  } catch (error) {
    diversityWarning = `SEO_RUN_MALL_TITLE_DIVERSITY_V8_FALLBACK:${safeWarning(
      error instanceof Error ? error.message : error,
    )}`;
  }

  let sameMallDiversityWarning = "SEO_RUN_SAME_MALL_DIVERSITY_V9:enabled";
  try {
    const proposed = rebalanceKeywordElonSameMallTitleDiversityV9({
      attempts: attemptResults,
      selected,
      finalKeywords: finals,
    });
    if (preservesKeywordElonHistoricalFreshness(selected, proposed, excludedTitles)) {
      selected = proposed;
    } else {
      sameMallDiversityWarning = "SEO_RUN_SAME_MALL_DIVERSITY_V9:kept_history_preference";
    }
  } catch (error) {
    sameMallDiversityWarning = `SEO_RUN_SAME_MALL_DIVERSITY_V9_FALLBACK:${safeWarning(
      error instanceof Error ? error.message : error,
    )}`;
  }

  const excludedCanonical = new Set(excludedTitles.map(canonical).filter(Boolean));
  const exactReuse = selected.rows.filter((row) =>
    excludedCanonical.has(canonical(row.title)),
  ).length;
  let reorderOnly = 0;
  for (const row of selected.rows) {
    if (excludedCanonical.has(canonical(row.title))) continue;
    if (excludedTitles.some(previous => jaccard(row.title, previous) >= 0.999)) {
      reorderOnly += 1;
    }
  }

  return {
    ...selected,
    warnings: [
      ...selected.warnings,
      ...(sparseModelSupports.length
        ? [
            `SEO_RUN_SPARSE_TITLE_MODEL_SUPPORTS:${sparseModelSupports.length}:${sparseModelSupports
              .map((row) => row.keyword)
              .join("|")}`,
          ]
        : []),
      portfolioWarning,
      diversityWarning,
      sameMallDiversityWarning,
      `SEO_RUN_FRESH_VARIATION_ATTEMPT:${bestAttempt + 1}/${attempts}`,
      `SEO_RUN_FRESH_VARIATION_ATTEMPT_POOL:${attemptResults.length}`,
      `SEO_RUN_EXCLUDED_TITLE_COUNT:${excludedTitles.length}`,
      `SEO_RUN_EXACT_TITLE_REUSE:${exactReuse}`,
      `SEO_RUN_REORDER_ONLY_REUSE:${reorderOnly}`,
    ],
  };
}
