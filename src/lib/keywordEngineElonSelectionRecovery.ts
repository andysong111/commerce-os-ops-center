import type {
  KeywordElonCandidate,
  KeywordElonDiscovery,
  KeywordElonIdentity,
} from "@/lib/keywordEngineElonLabV2";

// Recall is not approval. Restored terms still pass the unchanged semantic,
// category, demand/accuracy and prohibited-keyword gates.
export const KEYWORD_ELON_RECOVERY_VERSION = "identity-first-bounded-v1";
export const KEYWORD_ELON_RECOVERY_LIMIT = 48;
export const KEYWORD_ELON_RECOVERY_MAX_ATTEMPTS = 2;
type RecoveryMarker = { version?: unknown; attempts?: unknown };

function key(value: unknown) {
  return String(value ?? "").normalize("NFKC")
    .replace(/[^0-9A-Za-z가-힣]/g, "").toLocaleLowerCase();
}
function unique(values: unknown[], limit: number) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = key(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}
function identitySeeds(identity: KeywordElonIdentity) {
  return unique([identity.coreProduct, ...(identity.primarySeeds ?? []), identity.identityAnchor], 16);
}
export function prioritizeKeywordElonCandidatePool(identity: KeywordElonIdentity, candidates: string[]) {
  // Same 500-candidate ceiling; identity cannot be displaced by depth-2 demand.
  return unique([...identitySeeds(identity), ...candidates], 500);
}
export function keywordElonScoreUnavailable(candidate: KeywordElonCandidate) {
  return /^(AI 점수화 실패|AI 점수 응답 누락)/.test(candidate.rationale ?? "");
}
export function planKeywordElonSelectionRecovery(input: {
  identity: KeywordElonIdentity;
  discovery: KeywordElonDiscovery;
  candidates: KeywordElonCandidate[];
  previous?: RecoveryMarker | null;
}) {
  const previousAttempts = input.previous?.version === KEYWORD_ELON_RECOVERY_VERSION
    ? Number(input.previous.attempts ?? 0) : 0;
  if (!Number.isSafeInteger(previousAttempts) || previousAttempts < 0
    || previousAttempts >= KEYWORD_ELON_RECOVERY_MAX_ATTEMPTS) return null;
  const existing = new Map(input.candidates.map((row) => [
    key(row.searchKeyword || row.searchKey || row.keyword), row,
  ]));
  const seeds = identitySeeds(input.identity);
  const seedKeys = new Set(seeds);
  const core = key(input.identity.coreProduct);
  const tagged = Object.entries(input.discovery.sourceTagsByKeyword ?? {})
    .filter(([, tags]) => tags.some((tag) => [
      "primary_seed", "market_bridge_seed", "api_hub_evidence_term", "ai_recall_support",
    ].includes(tag)))
    .map(([term]) => term);
  const stats = input.discovery.searchAdStats ?? [];
  const anchoredStats = stats.filter((row) => core.length >= 2 && key(row.keyword).includes(core));
  const directStats = stats.filter((row) => (row.sourceSeeds ?? []).some((seed) => seedKeys.has(key(seed))));
  const pool = unique([
    ...seeds, ...tagged,
    ...(input.discovery.marketTerms ?? []), ...(input.discovery.marketBridgeSeeds ?? []),
    ...anchoredStats.map((row) => row.keyword), ...directStats.map((row) => row.keyword),
    ...input.discovery.candidates,
  ], 10_000);
  // Never re-score a real semantic rejection until it happens to pass.
  // Only omitted terms and failed/missing scoring responses are recoverable.
  const keywords = pool.filter((term) => {
    const row = existing.get(term);
    return !row || keywordElonScoreUnavailable(row);
  }).slice(0, KEYWORD_ELON_RECOVERY_LIMIT);
  if (!keywords.length) return null;
  return {
    version: KEYWORD_ELON_RECOVERY_VERSION,
    attempts: previousAttempts + 1,
    keywords,
    originalCandidateCount: input.candidates.length,
    unavailableScoreCount: input.candidates.filter(keywordElonScoreUnavailable).length,
    missingIdentitySeedCount: seeds.filter((seed) => !existing.has(seed)).length,
  };
}
