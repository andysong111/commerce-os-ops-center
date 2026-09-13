export const OPS_PROHIBITED_KEYWORD_TERMS = [
  "한샘",
  "한샘시스템행거",
  "동행복권",
  "스피또",
  "로또",
  "동행복권로또",
] as const;

function keywordIdentity(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("ko-KR");
}

const NORMALIZED_PROHIBITED_TERMS = OPS_PROHIBITED_KEYWORD_TERMS.map(keywordIdentity);

export function findOpsProhibitedKeywordTerm(value: unknown) {
  const identity = keywordIdentity(value);
  if (!identity) return "";
  return NORMALIZED_PROHIBITED_TERMS.find((term) => identity.includes(term)) ?? "";
}

export function containsOpsProhibitedKeyword(value: unknown) {
  return Boolean(findOpsProhibitedKeywordTerm(value));
}

// Backward-compatible export for existing imports. Policy is now substring-based.
export const OPS_EXACT_PROHIBITED_KEYWORDS = OPS_PROHIBITED_KEYWORD_TERMS;
export function isOpsExactProhibitedKeyword(value: unknown) {
  return containsOpsProhibitedKeyword(value);
}
