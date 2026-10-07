import {
  compactKeywordElonKey,
  keywordElonUtf8Bytes,
  normalizeKeywordElonText,
} from "./keywordEngineElonLabV2.ts";

export type KeywordResearchTitleMaterial = {
  keyword: string;
  relevance: number;
  shoppingIntent: number;
  specificity: number;
  opportunityScore: number;
  enginePass: boolean;
};

export type KeywordResearchTitleComposition = {
  title: string;
  usedKeywords: string[];
  byteLength: number;
};

function bigrams(value: string) {
  const key = compactKeywordElonKey(value);
  if (key.length < 2) return new Set([key]);
  return new Set(Array.from({ length: key.length - 1 }, (_, index) => key.slice(index, index + 2)));
}

function similarity(left: string, right: string) {
  const leftSet = bigrams(left);
  const rightSet = bigrams(right);
  const intersection = [...leftSet].filter((value) => rightSet.has(value)).length;
  const union = new Set([...leftSet, ...rightSet]).size;
  return union ? intersection / union : 0;
}

function materialScore(row: KeywordResearchTitleMaterial) {
  return (
    row.relevance * 0.4 +
    row.shoppingIntent * 0.3 +
    row.specificity * 0.15 +
    row.opportunityScore * 0.15
  );
}

function appendWithinLimit(target: string[], keyword: string) {
  const next = [...target, keyword].join(" ");
  if (keywordElonUtf8Bytes(next) > 100) return false;
  target.push(keyword);
  return true;
}

export function composeKeywordResearchTitle(input: {
  seed: string;
  materials: KeywordResearchTitleMaterial[];
  mode: "auto" | "selected";
}): KeywordResearchTitleComposition {
  const unique = new Map<string, KeywordResearchTitleMaterial>();
  for (const material of input.materials) {
    if (!material.enginePass) continue;
    const keyword = normalizeKeywordElonText(material.keyword);
    const key = compactKeywordElonKey(keyword);
    if (!key || unique.has(key)) continue;
    unique.set(key, { ...material, keyword });
  }

  const ranked = [...unique.values()].sort(
    (left, right) => materialScore(right) - materialScore(left),
  );
  const normalizedSeed = normalizeKeywordElonText(input.seed);
  const selectedPrimary = input.mode === "selected" ? input.materials.find((row) => row.enginePass)?.keyword : "";
  const primary = normalizeKeywordElonText(selectedPrimary || normalizedSeed || ranked[0]?.keyword);
  const primaryKey = compactKeywordElonKey(primary);
  const usedKeywords = primary ? [primary] : [];

  const strict = ranked.filter(
    (row) => row.relevance >= 88 && row.shoppingIntent >= 85,
  );
  const pools = input.mode === "auto" ? [strict, ranked] : [ranked];
  for (const pool of pools) {
    for (const row of pool) {
      if (usedKeywords.length >= 3) break;
      const key = compactKeywordElonKey(row.keyword);
      if (!key || usedKeywords.some((item) => compactKeywordElonKey(item) === key)) continue;
      if (input.mode === "auto" && primaryKey && (key.includes(primaryKey) || primaryKey.includes(key))) continue;
      if (usedKeywords.some((item) => similarity(item, row.keyword) >= 0.3)) continue;
      appendWithinLimit(usedKeywords, row.keyword);
    }
    if (usedKeywords.length >= Math.min(3, Math.max(1, ranked.length))) break;
  }

  if (!usedKeywords.length && normalizedSeed) usedKeywords.push(normalizedSeed);
  const title = usedKeywords.join(" ");
  return {
    title,
    usedKeywords,
    byteLength: keywordElonUtf8Bytes(title),
  };
}

export function keywordResearchTitleCoverage(title: string, keywords: string[]) {
  const titleKey = compactKeywordElonKey(title);
  return keywords.filter((keyword) => titleKey.includes(compactKeywordElonKey(keyword))).length;
}
