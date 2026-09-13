import {
  compactKeywordElonKey,
  type KeywordElonCandidate,
} from "@/lib/keywordEngineElonLabV2";
import { isOpsExactProhibitedKeyword } from "@/lib/keywordExactProhibitedTerms";

// Fixed production standard selected from the 10-product × 64-combination threshold experiment.
export const KEYWORD_ELON_SELECTION_STORAGE_KEY = "keywordEngineElonLab.selectionThresholds.v1";
export const KEYWORD_ELON_DEFAULT_DEMAND_QUALITY = 65;
export const KEYWORD_ELON_DEFAULT_ACCURACY_RELEVANCE = 90;

export type KeywordElonSelectionThresholds = {
  demandQuality: number;
  accuracyRelevance: number;
};

export function clampKeywordElonThreshold(value: unknown, fallback: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

export function normalizeKeywordElonSelectionThresholds(
  _value?: Partial<KeywordElonSelectionThresholds> | null,
): KeywordElonSelectionThresholds {
  return {
    demandQuality: KEYWORD_ELON_DEFAULT_DEMAND_QUALITY,
    accuracyRelevance: KEYWORD_ELON_DEFAULT_ACCURACY_RELEVANCE,
  };
}

export function readKeywordElonSelectionThresholds(): KeywordElonSelectionThresholds {
  return normalizeKeywordElonSelectionThresholds();
}

export function writeKeywordElonSelectionThresholds(_value: KeywordElonSelectionThresholds) {
  if (typeof window === "undefined") return;
  const normalized = normalizeKeywordElonSelectionThresholds();
  window.localStorage.setItem(KEYWORD_ELON_SELECTION_STORAGE_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent("keyword-elon-selection-thresholds-updated"));
}

function candidateText(row: KeywordElonCandidate) {
  return row.searchKeyword || row.searchKey || row.keyword;
}

function candidateKey(row: KeywordElonCandidate) {
  return compactKeywordElonKey(candidateText(row));
}

function allowedByPermanentExactPolicy(row: KeywordElonCandidate) {
  return !isOpsExactProhibitedKeyword(candidateText(row));
}

export function keywordElonDemandQualified(
  row: KeywordElonCandidate,
  thresholds: KeywordElonSelectionThresholds,
) {
  return Boolean(
    allowedByPermanentExactPolicy(row)
    && row.safetyPass
    && row.titleEligible
    && row.totalSearch !== null
    && row.qualityScore >= thresholds.demandQuality,
  );
}

export function keywordElonAccuracyQualified(
  row: KeywordElonCandidate,
  thresholds: KeywordElonSelectionThresholds,
) {
  return Boolean(
    allowedByPermanentExactPolicy(row)
    && row.safetyPass
    && row.titleEligible
    && row.relevance >= thresholds.accuracyRelevance,
  );
}

export function selectKeywordElonDemandCandidates(
  candidates: KeywordElonCandidate[],
  thresholds: KeywordElonSelectionThresholds,
) {
  return [...candidates]
    .filter((row) => keywordElonDemandQualified(row, thresholds))
    .sort((a, b) =>
      (b.totalSearch ?? -1) - (a.totalSearch ?? -1)
      || b.qualityScore - a.qualityScore
      || b.relevance - a.relevance,
    );
}

export function selectKeywordElonAccuracyCandidates(
  candidates: KeywordElonCandidate[],
  thresholds: KeywordElonSelectionThresholds,
) {
  return [...candidates]
    .filter((row) => keywordElonAccuracyQualified(row, thresholds))
    .sort((a, b) =>
      b.relevance - a.relevance
      || b.shoppingIntent - a.shoppingIntent
      || b.specificity - a.specificity
      || b.qualityScore - a.qualityScore,
    );
}

export function selectKeywordElonStep4Union(
  candidates: KeywordElonCandidate[],
  thresholds: KeywordElonSelectionThresholds,
) {
  const demand = selectKeywordElonDemandCandidates(candidates, thresholds);
  const accuracy = selectKeywordElonAccuracyCandidates(candidates, thresholds);
  const map = new Map<string, KeywordElonCandidate>();
  for (const row of [...demand, ...accuracy]) {
    const key = candidateKey(row);
    if (!key || map.has(key)) continue;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) =>
    b.relevance - a.relevance
    || (b.totalSearch ?? -1) - (a.totalSearch ?? -1)
    || b.qualityScore - a.qualityScore,
  );
}
