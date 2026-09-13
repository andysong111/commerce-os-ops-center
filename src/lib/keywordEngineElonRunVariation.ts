function seedText(value: string) { return value.normalize("NFKC").trim(); }
function hash(value: string) {
  let result = 2166136261;
  for (const char of value) result = Math.imul(result ^ char.charCodeAt(0), 16777619);
  return result >>> 0;
}

/** Reorders approved material only. It never adds, deletes or rewrites a keyword. */
export function orderKeywordElonRunTerms(terms: string[], variationSeed = "") {
  const seed = seedText(variationSeed);
  if (!seed) return [...terms];
  return terms.map((term, index) => ({ term, index, order: hash(`${seed}\u0000${term}`) }))
    .sort((a, b) => a.order - b.order || a.index - b.index).map(row => row.term);
}

type Ranked = {
  key: string;
  score: number;
  relevance: number;
  totalSearch: number | null;
  competitionOpportunity: number;
};

/** Only exact ranking ties may choose different terms on a deliberate new RUN. */
export function varyKeywordElonEqualRank<T extends Ranked>(rows: T[], variationSeed = ""): T[] {
  const seed = seedText(variationSeed);
  if (!seed) return [...rows];
  const result = [...rows];
  const sameRank = (a: T, b: T) => Number.isFinite(a.score) &&
    a.score === b.score && a.relevance === b.relevance &&
    a.totalSearch === b.totalSearch && a.competitionOpportunity === b.competitionOpportunity;
  for (let start = 0; start < result.length;) {
    let end = start + 1;
    while (end < result.length && sameRank(result[start], result[end])) end += 1;
    const group = result.slice(start, end).map((row, index) => ({ row, index, order: hash(`${seed}\u0000${row.key}`) }))
      .sort((a, b) => a.order - b.order || a.index - b.index).map(value => value.row);
    result.splice(start, group.length, ...group);
    start = end;
  }
  return result;
}
