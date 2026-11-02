export const MANUAL_DRAFT_SEARCH_TERM_LIMIT = 50;

export type ManualDraftSearchCandidate = {
  barcode: string;
  modelNo: string;
  productName: string;
  optionName: string;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

export function parseManualDraftSearchTerms(value: unknown) {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const raw of text(value).split(/[,;，；\n\r\t]+/)) {
    const term = text(raw);
    if (term.length < 2) continue;
    const key = term.toLocaleLowerCase("ko-KR");
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
    if (terms.length >= MANUAL_DRAFT_SEARCH_TERM_LIMIT) break;
  }
  return terms;
}

function candidateScore(candidate: ManualDraftSearchCandidate, queryInput: unknown) {
  const query = text(queryInput).toLocaleLowerCase("ko-KR");
  const barcode = text(candidate.barcode).toLocaleLowerCase("ko-KR");
  const modelNo = text(candidate.modelNo).toLocaleLowerCase("ko-KR");
  const productName = text(candidate.productName).toLocaleLowerCase("ko-KR");
  const optionName = text(candidate.optionName).toLocaleLowerCase("ko-KR");
  if (barcode === query) return 0;
  if (modelNo === query) return 1;
  if (barcode.startsWith(query)) return 2;
  if (modelNo.startsWith(query)) return 3;
  if (productName.startsWith(query)) return 4;
  if (optionName.startsWith(query)) return 5;
  if (barcode.includes(query)) return 6;
  if (modelNo.includes(query)) return 7;
  if (productName.includes(query)) return 8;
  if (optionName.includes(query)) return 9;
  return 100;
}

export function bestManualDraftSearchMatch(
  candidate: ManualDraftSearchCandidate,
  terms: string[],
) {
  let termIndex = Number.POSITIVE_INFINITY;
  let score = 100;
  for (let index = 0; index < terms.length; index += 1) {
    const currentScore = candidateScore(candidate, terms[index]);
    if (currentScore >= 100) continue;
    if (index < termIndex || (index === termIndex && currentScore < score)) {
      termIndex = index;
      score = currentScore;
    }
  }
  return { termIndex, score };
}
