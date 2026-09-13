import {
  compactKeywordElonKey,
  uniqueKeywordElonCanonical,
  type KeywordElonCandidate,
  type KeywordElonDiscovery,
  type KeywordElonSearchAdStat,
} from "@/lib/keywordEngineElonLabV2";

function mergeStats(base: KeywordElonSearchAdStat[], added: KeywordElonSearchAdStat[]) {
  const map = new Map<string, KeywordElonSearchAdStat>();
  for (const row of [...base, ...added]) {
    const key = compactKeywordElonKey(row.keyword);
    if (!key) continue;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, row);
      continue;
    }
    const sourceSeeds = [...new Set([...(existing.sourceSeeds ?? []), ...(row.sourceSeeds ?? [])])];
    map.set(key, {
      ...((row.totalSearch ?? -1) > (existing.totalSearch ?? -1) ? row : existing),
      sourceSeeds,
    });
  }
  return [...map.values()].sort((a, b) => (b.totalSearch ?? -1) - (a.totalSearch ?? -1));
}

function mergeTags(base: Record<string, string[]>, added: Record<string, string[]>) {
  const result: Record<string, string[]> = { ...base };
  for (const [key, values] of Object.entries(added)) {
    result[key] = [...new Set([...(result[key] ?? []), ...values])];
  }
  return result;
}

function mergeEvidence(
  base: NonNullable<KeywordElonDiscovery["apiHubEvidenceTerms"]>,
  added: NonNullable<KeywordElonDiscovery["apiHubEvidenceTerms"]>,
) {
  const map = new Map<string, (typeof base)[number]>();
  for (const row of [...base, ...added]) {
    const key = compactKeywordElonKey(row.term);
    if (!key) continue;
    const existing = map.get(key);
    if (!existing || row.score > existing.score) map.set(key, row);
  }
  return [...map.values()].sort((a, b) => b.score - a.score).slice(0, 160);
}

export function mergeKeywordElonDiscovery(
  base: KeywordElonDiscovery | null | undefined,
  added: KeywordElonDiscovery,
): KeywordElonDiscovery {
  if (!base) return added;
  const demandExpansionSeeds = uniqueKeywordElonCanonical([
    ...(base.demandExpansionSeeds ?? []),
    ...(added.demandExpansionSeeds ?? []),
  ], 20);
  return {
    ...base,
    candidates: uniqueKeywordElonCanonical([...base.candidates, ...added.candidates], 900),
    sourceTagsByKeyword: mergeTags(base.sourceTagsByKeyword ?? {}, added.sourceTagsByKeyword ?? {}),
    searchAdStats: mergeStats(base.searchAdStats ?? [], added.searchAdStats ?? []),
    searchAdConfigured: base.searchAdConfigured || added.searchAdConfigured,
    searchAdWarnings: [...new Set([...(base.searchAdWarnings ?? []), ...(added.searchAdWarnings ?? [])])].slice(0, 40),
    aiGeneratedCount: (base.aiGeneratedCount ?? 0) + (added.aiGeneratedCount ?? 0),
    relatedKeywordCount: new Set(
      [...(base.searchAdStats ?? []), ...(added.searchAdStats ?? [])].map((row) => compactKeywordElonKey(row.keyword)),
    ).size,
    demandExpansionSeeds,
    demandExpansionSeedCount: demandExpansionSeeds.length,
    demandExplorationDepth: Math.max(base.demandExplorationDepth ?? 1, added.demandExplorationDepth ?? 1),
    marketBridgeSeeds: uniqueKeywordElonCanonical([
      ...(base.marketBridgeSeeds ?? []),
      ...(added.marketBridgeSeeds ?? []),
    ], 40),
    marketTerms: uniqueKeywordElonCanonical([...(base.marketTerms ?? []), ...(added.marketTerms ?? [])], 160),
    apiHubConfigured: Boolean(base.apiHubConfigured || added.apiHubConfigured),
    apiHubQueries: uniqueKeywordElonCanonical([...(base.apiHubQueries ?? []), ...(added.apiHubQueries ?? [])], 40),
    apiHubDocumentCount: (base.apiHubDocumentCount ?? 0) + (added.apiHubDocumentCount ?? 0),
    apiHubActiveSources: [...new Set([...(base.apiHubActiveSources ?? []), ...(added.apiHubActiveSources ?? [])])],
    apiHubEvidenceTerms: mergeEvidence(base.apiHubEvidenceTerms ?? [], added.apiHubEvidenceTerms ?? []),
    trendConfigured: Boolean(base.trendConfigured || added.trendConfigured),
    trendSignals: [...(base.trendSignals ?? []), ...(added.trendSignals ?? [])],
    trendWarnings: [...new Set([...(base.trendWarnings ?? []), ...(added.trendWarnings ?? [])])].slice(0, 20),
    marketRecallVersion: added.marketRecallVersion || base.marketRecallVersion,
    model: added.model || base.model,
  };
}

export function mergeKeywordElonCandidates(
  base: KeywordElonCandidate[] | null | undefined,
  added: KeywordElonCandidate[],
) {
  const map = new Map<string, KeywordElonCandidate>();
  for (const row of [...(base ?? []), ...added]) {
    const key = compactKeywordElonKey(row.searchKeyword || row.searchKey || row.keyword);
    if (!key) continue;
    const normalized = {
      ...row,
      keyword: key,
      searchKey: key,
      searchKeyword: key,
    } satisfies KeywordElonCandidate;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, normalized);
      continue;
    }
    // A real zero-score rejection is evidence; an API timeout is not. Preserve
    // successful evaluation even when both quality scores are zero so bounded
    // recovery never repeatedly re-scores a rejection seeking a lucky pass.
    const unavailable = (candidate: KeywordElonCandidate) =>
      /^(AI 점수화 실패|AI 점수 응답 누락)/.test(candidate.rationale ?? "");
    const existingUnavailable = unavailable(existing);
    const addedUnavailable = unavailable(normalized);
    const chosen = existingUnavailable !== addedUnavailable
      ? existingUnavailable ? normalized : existing
      : normalized.qualityScore > existing.qualityScore
        ? normalized
        : normalized.qualityScore < existing.qualityScore
          ? existing
          : (normalized.totalSearch ?? -1) > (existing.totalSearch ?? -1)
            ? normalized
            : existing;
    map.set(key, {
      ...chosen,
      sourceTags: [...new Set([...(existing.sourceTags ?? []), ...(normalized.sourceTags ?? [])])],
    });
  }
  return [...map.values()].sort(
    (a, b) =>
      Number(b.safetyPass) - Number(a.safetyPass)
      || b.qualityScore - a.qualityScore
      || (b.totalSearch ?? -1) - (a.totalSearch ?? -1),
  );
}
