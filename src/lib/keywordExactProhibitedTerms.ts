export const OPS_EXACT_PROHIBITED_KEYWORDS = [
  "한샘",
  "한샘시스템행거",
  "동행복권",
  "스피또",
  "로또",
  "동행복권로또",
] as const;

function exactKeywordIdentity(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("ko-KR");
}

const OPS_EXACT_PROHIBITED_KEYWORD_SET = new Set(
  OPS_EXACT_PROHIBITED_KEYWORDS.map(exactKeywordIdentity),
);

export function isOpsExactProhibitedKeyword(value: unknown) {
  const identity = exactKeywordIdentity(value);
  return Boolean(identity) && OPS_EXACT_PROHIBITED_KEYWORD_SET.has(identity);
}
