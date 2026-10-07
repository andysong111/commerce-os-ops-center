import type {
  KeywordRecommendationGroup,
  KeywordRecommendationItem,
  KeywordRecommendationQuality,
} from "./productLaunchKeywordRecommendations";

export const KEYWORD_OPPORTUNITY_STORAGE_KEY =
  "opsCenter.keywordOpportunityLibrary.v1";
export const KEYWORD_OPPORTUNITY_UPDATED_EVENT =
  "keyword-opportunity-library-updated";
export const KEYWORD_OPPORTUNITY_MAX_ITEMS = 500;

export type KeywordOpportunityStatus =
  | "new"
  | "reviewing"
  | "sourced"
  | "excluded";

export type KeywordOpportunityRecord = {
  id: string;
  keyword: string;
  competitionIndex: string;
  totalSearch: number | null;
  quality: KeywordRecommendationQuality;
  source: string;
  safeAutoApply: boolean;
  favorite: boolean;
  status: KeywordOpportunityStatus;
  note: string;
  goodsKeys: string[];
  requestIds: string[];
  observationKeys: string[];
  occurrenceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;

type CaptureInput = {
  requestId: string;
  groups: KeywordRecommendationGroup[];
  capturedAt?: string;
};

type KeywordOpportunityPatch = Partial<
  Pick<KeywordOpportunityRecord, "favorite" | "status" | "note">
>;

const GOOD_COMPETITION_LABELS = new Set([
  "LOW",
  "낮음",
  "낮은",
  "하",
  "LOWCOMPETITION",
  "경쟁낮음",
]);

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function keywordIdentity(value: unknown) {
  return text(value).toLocaleLowerCase("ko-KR").replace(/\s+/g, "");
}

function stringList(value: unknown, limit = 100) {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(value.map((item) => text(item)).filter(Boolean)),
  ].slice(0, limit);
}

function nullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function safeDate(value: unknown, fallback: string) {
  const normalized = text(value);
  return Number.isFinite(Date.parse(normalized)) ? normalized : fallback;
}

function statusValue(value: unknown): KeywordOpportunityStatus {
  return ["new", "reviewing", "sourced", "excluded"].includes(text(value))
    ? (text(value) as KeywordOpportunityStatus)
    : "new";
}

function qualityValue(value: unknown): KeywordRecommendationQuality {
  return ["최적", "추천", "검토"].includes(text(value))
    ? (text(value) as KeywordRecommendationQuality)
    : "추천";
}

function stableId(keyword: string) {
  let hash = 2166136261;
  for (const character of keywordIdentity(keyword)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `keyword-opportunity-${(hash >>> 0).toString(36)}`;
}

function normalizeRecord(
  value: unknown,
  now = new Date().toISOString(),
): KeywordOpportunityRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Partial<KeywordOpportunityRecord>;
  const keyword = text(source.keyword);
  if (!keyword || !isGoodCompetitionIndex(source.competitionIndex)) return null;
  const observationKeys = stringList(source.observationKeys, 100);
  return {
    id: text(source.id) || stableId(keyword),
    keyword,
    competitionIndex: text(source.competitionIndex),
    totalSearch: nullableNumber(source.totalSearch),
    quality: qualityValue(source.quality),
    source: text(source.source) || "키워드 엔진",
    safeAutoApply: source.safeAutoApply === true,
    favorite: source.favorite === true,
    status: statusValue(source.status),
    note: text(source.note).slice(0, 500),
    goodsKeys: stringList(source.goodsKeys, 100),
    requestIds: stringList(source.requestIds, 50),
    observationKeys,
    occurrenceCount: Math.max(
      observationKeys.length,
      Math.trunc(Number(source.occurrenceCount) || 0),
      1,
    ),
    firstSeenAt: safeDate(source.firstSeenAt, now),
    lastSeenAt: safeDate(source.lastSeenAt, now),
  };
}

export function isGoodCompetitionIndex(value: unknown) {
  const normalized = text(value)
    .toLocaleUpperCase("ko-KR")
    .replace(/[\s_()-]+/g, "");
  return GOOD_COMPETITION_LABELS.has(normalized);
}

export function isKeywordOpportunityCandidate(
  item: KeywordRecommendationItem,
) {
  return (
    Boolean(keywordIdentity(item.keyword)) &&
    isGoodCompetitionIndex(item.competitionIndex) &&
    (item.quality === "최적" || item.quality === "추천")
  );
}

export function readKeywordOpportunities(
  storage: StorageLike,
): KeywordOpportunityRecord[] {
  try {
    const raw = storage.getItem(KEYWORD_OPPORTUNITY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    return parsed
      .map((item) => normalizeRecord(item))
      .filter((item): item is KeywordOpportunityRecord => Boolean(item))
      .filter((item) => {
        const identity = keywordIdentity(item.keyword);
        if (seen.has(identity)) return false;
        seen.add(identity);
        return true;
      })
      .slice(0, KEYWORD_OPPORTUNITY_MAX_ITEMS);
  } catch {
    return [];
  }
}

function persistKeywordOpportunities(
  storage: StorageLike,
  records: KeywordOpportunityRecord[],
) {
  storage.setItem(
    KEYWORD_OPPORTUNITY_STORAGE_KEY,
    JSON.stringify(records.slice(0, KEYWORD_OPPORTUNITY_MAX_ITEMS)),
  );
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(KEYWORD_OPPORTUNITY_UPDATED_EVENT));
  }
}

function opportunityRank(record: KeywordOpportunityRecord) {
  const quality = record.quality === "최적" ? 2 : 1;
  return (record.favorite ? 1_000_000_000 : 0) +
    (record.totalSearch ?? 0) * 100 +
    quality * 10 +
    record.occurrenceCount;
}

export function sortKeywordOpportunities(records: KeywordOpportunityRecord[]) {
  return [...records].sort(
    (left, right) =>
      opportunityRank(right) - opportunityRank(left) ||
      Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt) ||
      left.keyword.localeCompare(right.keyword, "ko"),
  );
}

export function captureKeywordOpportunities(
  storage: StorageLike,
  input: CaptureInput,
) {
  const requestId = text(input.requestId);
  if (!requestId) {
    return { added: 0, updated: 0, skipped: 0, records: readKeywordOpportunities(storage) };
  }
  const capturedAt = safeDate(input.capturedAt, new Date().toISOString());
  const current = readKeywordOpportunities(storage);
  const byKeyword = new Map(
    current.map((record) => [keywordIdentity(record.keyword), record]),
  );
  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const group of input.groups) {
    const goodsKey = text(group.goodsKey);
    for (const item of group.items) {
      if (!isKeywordOpportunityCandidate(item)) {
        skipped += 1;
        continue;
      }
      const identity = keywordIdentity(item.keyword);
      const observationKey = `${requestId}:${goodsKey}:${identity}`;
      const existing = byKeyword.get(identity);
      if (existing?.observationKeys.includes(observationKey)) continue;

      if (existing) {
        const nextSearch = nullableNumber(item.totalSearch);
        const existingSearch = existing.totalSearch ?? -1;
        byKeyword.set(identity, {
          ...existing,
          competitionIndex: text(item.competitionIndex),
          totalSearch:
            nextSearch !== null && nextSearch > existingSearch
              ? nextSearch
              : existing.totalSearch,
          quality:
            existing.quality === "최적" || item.quality !== "최적"
              ? existing.quality
              : "최적",
          source: text(item.source) || existing.source,
          safeAutoApply: existing.safeAutoApply || item.safeAutoApply,
          goodsKeys: stringList([...existing.goodsKeys, goodsKey], 100),
          requestIds: stringList([...existing.requestIds, requestId], 50),
          observationKeys: stringList(
            [...existing.observationKeys, observationKey],
            100,
          ),
          occurrenceCount: existing.occurrenceCount + 1,
          lastSeenAt: capturedAt,
        });
        updated += 1;
      } else {
        byKeyword.set(identity, {
          id: stableId(item.keyword),
          keyword: text(item.keyword),
          competitionIndex: text(item.competitionIndex),
          totalSearch: nullableNumber(item.totalSearch),
          quality: item.quality,
          source: text(item.source) || "키워드 엔진",
          safeAutoApply: item.safeAutoApply,
          favorite: false,
          status: "new",
          note: "",
          goodsKeys: goodsKey ? [goodsKey] : [],
          requestIds: [requestId],
          observationKeys: [observationKey],
          occurrenceCount: 1,
          firstSeenAt: capturedAt,
          lastSeenAt: capturedAt,
        });
        added += 1;
      }
    }
  }

  const records = sortKeywordOpportunities([...byKeyword.values()]).slice(
    0,
    KEYWORD_OPPORTUNITY_MAX_ITEMS,
  );
  if (added > 0 || updated > 0) persistKeywordOpportunities(storage, records);
  return { added, updated, skipped, records };
}

export function updateKeywordOpportunity(
  storage: StorageLike,
  id: string,
  patch: KeywordOpportunityPatch,
) {
  const records = readKeywordOpportunities(storage).map((record) =>
    record.id === id
      ? {
          ...record,
          ...(typeof patch.favorite === "boolean"
            ? { favorite: patch.favorite }
            : {}),
          ...(patch.status ? { status: statusValue(patch.status) } : {}),
          ...(typeof patch.note === "string"
            ? { note: text(patch.note).slice(0, 500) }
            : {}),
        }
      : record,
  );
  const sorted = sortKeywordOpportunities(records);
  persistKeywordOpportunities(storage, sorted);
  return sorted;
}

export function keywordOpportunityCsv(records: KeywordOpportunityRecord[]) {
  const headers = [
    "keyword",
    "competition_index",
    "monthly_search",
    "quality",
    "status",
    "favorite",
    "occurrence_count",
    "goods_keys",
    "first_seen_at",
    "last_seen_at",
    "note",
  ];
  const rows = records.map((record) => [
    record.keyword,
    record.competitionIndex,
    record.totalSearch ?? "",
    record.quality,
    record.status,
    record.favorite ? "Y" : "N",
    record.occurrenceCount,
    record.goodsKeys.join("|"),
    record.firstSeenAt,
    record.lastSeenAt,
    record.note,
  ]);
  return [headers, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
}

function csvCell(value: unknown) {
  const normalized = String(value ?? "");
  return /[",\r\n]/.test(normalized)
    ? `"${normalized.replace(/"/g, '""')}"`
    : normalized;
}
