import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  KEYWORD_OPPORTUNITY_HISTORY_BACKFILL_KEY,
  KEYWORD_OPPORTUNITY_STORAGE_KEY,
  captureHistoricalKeywordOpportunities,
  captureKeywordOpportunities,
  isGoodCompetitionIndex,
  keywordOpportunityCsv,
  readKeywordOpportunities,
  updateKeywordOpportunity,
} from "../src/lib/keywordOpportunityLibrary.ts";
import { moduleRegistry } from "../src/lib/moduleRegistry.ts";
import { getWorkspaceGroup } from "../src/lib/opsWorkspace.ts";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

function group(goodsKey, items) {
  return {
    goodsKey,
    optimizedKeywords: [],
    items,
    qualityStatus: "PASS",
    confidenceStatus: "PASS",
    engineStatus: "success",
    warnings: [],
  };
}

function item(overrides = {}) {
  return {
    keyword: "싱크대 정리 선반",
    score: 100,
    quality: "추천",
    source: "검증 추천 후보",
    selectedByEngine: false,
    safeAutoApply: true,
    totalSearch: 2300,
    competitionIndex: "LOW",
    reason: "safe_for_auto_apply",
    ...overrides,
  };
}

test("only low-competition optimized or recommended engine results enter the sourcing library", () => {
  assert.equal(
    KEYWORD_OPPORTUNITY_HISTORY_BACKFILL_KEY,
    "opsCenter.keywordOpportunityHistoryBackfill.v2",
  );
  const storage = memoryStorage();
  const result = captureKeywordOpportunities(storage, {
    requestId: "keyword-run-001",
    capturedAt: "2026-10-07T01:00:00.000Z",
    groups: [
      group("100001", [
        item(),
        item({ keyword: "중간 경쟁", competitionIndex: "MID" }),
        item({ keyword: "검토 필요", quality: "검토", competitionIndex: "낮음" }),
        item({ keyword: "숫자 지수", competitionIndex: "1" }),
      ]),
    ],
  });

  assert.equal(result.added, 1);
  assert.equal(result.skipped, 3);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].keyword, "싱크대 정리 선반");
  assert.equal(result.records[0].competitionEvidence, "verified_low");
  assert.deepEqual(result.records[0].goodsKeys, ["100001"]);
  assert.equal(isGoodCompetitionIndex("낮음"), true);
  assert.equal(isGoodCompetitionIndex("high"), false);
  assert.equal(isGoodCompetitionIndex(1), false);
});

test("historical engine keywords with missing competition data are restored for review without being labeled LOW", () => {
  const storage = memoryStorage();
  const restored = captureHistoricalKeywordOpportunities(storage, [
    {
      requestId: "keyword-rec-history-001",
      capturedAt: "2026-07-28T13:25:09.000Z",
      groups: [
        group("121448", [
          item({
            keyword: "여행용샤워필터",
            competitionIndex: "",
            quality: "검토",
            selectedByEngine: false,
            safeAutoApply: false,
            totalSearch: 0,
          }),
          item({
            keyword: "고경쟁키워드",
            competitionIndex: "HIGH",
            quality: "추천",
          }),
        ]),
      ],
    },
  ]);

  assert.equal(restored.added, 1);
  assert.equal(restored.skipped, 1);
  assert.equal(restored.unverified, 1);
  assert.equal(restored.records[0].keyword, "여행용샤워필터");
  assert.equal(restored.records[0].competitionIndex, "미수집");
  assert.equal(restored.records[0].competitionEvidence, "history_unverified");
  assert.equal(restored.records[0].status, "reviewing");
  assert.match(restored.records[0].note, /재확인/);
});

test("a later LOW observation upgrades restored history evidence without duplicating the keyword", () => {
  const storage = memoryStorage();
  captureHistoricalKeywordOpportunities(storage, [
    {
      requestId: "keyword-rec-history-002",
      groups: [
        group("121449", [
          item({
            keyword: "싱크대정리선반",
            competitionIndex: "",
            quality: "검토",
            selectedByEngine: true,
          }),
        ]),
      ],
    },
  ]);
  captureKeywordOpportunities(storage, {
    requestId: "keyword-rec-current-001",
    groups: [
      group("122000", [
        item({ keyword: "싱크대정리선반", competitionIndex: "LOW" }),
      ]),
    ],
  });

  const [record] = readKeywordOpportunities(storage);
  assert.equal(record.competitionEvidence, "verified_low");
  assert.equal(record.competitionIndex, "LOW");
  assert.equal(record.occurrenceCount, 2);
  assert.deepEqual(record.goodsKeys, ["121449", "122000"]);
});

test("repeat polling is idempotent while a later run accumulates evidence and preserves operator fields", () => {
  const storage = memoryStorage();
  const first = {
    requestId: "keyword-run-001",
    capturedAt: "2026-10-07T01:00:00.000Z",
    groups: [group("100001", [item()])],
  };
  captureKeywordOpportunities(storage, first);
  captureKeywordOpportunities(storage, first);
  let [record] = readKeywordOpportunities(storage);
  assert.equal(record.occurrenceCount, 1);

  updateKeywordOpportunity(storage, record.id, {
    favorite: true,
    status: "reviewing",
    note: "주방 정리 카테고리 확인",
  });
  captureKeywordOpportunities(storage, {
    requestId: "keyword-run-002",
    capturedAt: "2026-10-07T02:00:00.000Z",
    groups: [
      group("100002", [
        item({ totalSearch: 4100, quality: "최적", competitionIndex: "낮음" }),
      ]),
    ],
  });
  [record] = readKeywordOpportunities(storage);
  assert.equal(record.occurrenceCount, 2);
  assert.equal(record.totalSearch, 4100);
  assert.equal(record.quality, "최적");
  assert.equal(record.favorite, true);
  assert.equal(record.status, "reviewing");
  assert.equal(record.note, "주방 정리 카테고리 확인");
  assert.deepEqual(record.goodsKeys, ["100001", "100002"]);
});

test("malformed storage fails closed and CSV export contains the sourcing evidence", () => {
  const malformed = memoryStorage({
    [KEYWORD_OPPORTUNITY_STORAGE_KEY]: "{broken-json",
  });
  assert.deepEqual(readKeywordOpportunities(malformed), []);

  const storage = memoryStorage();
  captureKeywordOpportunities(storage, {
    requestId: "keyword-run-003",
    groups: [group("100003", [item({ keyword: "수납, 정리함" })])],
  });
  const csv = keywordOpportunityCsv(readKeywordOpportunities(storage));
  assert.match(csv, /competition_index,competition_evidence,monthly_search/);
  assert.match(csv, /"수납, 정리함"/);
  assert.match(csv, /100003/);
});

test("keyword opportunity library is exposed as a sourcing menu and product launch records results", async () => {
  const opportunityModule = moduleRegistry.find(
    (candidate) => candidate.id === "keyword-opportunity-library",
  );
  assert.equal(opportunityModule?.route, "/keyword-opportunity-library");
  assert.equal(getWorkspaceGroup("keyword-opportunity-library")?.id, "sourcing-order");

  const [page, launchFlow, reviewWorkspace, backfillHelper, backfillRoute] = await Promise.all([
    readFile(new URL("../src/app/keyword-opportunity-library/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/product-launch-flow/ProductLaunchFlowSimple.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/keyword-review/KeywordReviewWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/keywordOpportunityHistoryBackfill.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/keyword-opportunity-library/backfill/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /키워드 소싱 후보/);
  assert.match(page, /시장 확인/);
  assert.match(page, /1688 소싱 준비/);
  assert.match(page, /이전 이력 가져오기/);
  assert.match(page, /\/api\/keyword-opportunity-library\/backfill/);
  assert.match(launchFlow, /captureKeywordOpportunities/);
  assert.match(reviewWorkspace, /captureKeywordOpportunities/);
  assert.match(backfillHelper, /listWorkflowRuns/);
  assert.match(backfillHelper, /expectedArtifactName/);
  assert.match(backfillHelper, /parseKeywordRecommendationArtifact/);
  assert.match(backfillHelper, /items: group\.items\.slice\(0, 10\)/);
  assert.match(backfillRoute, /GITHUB_ENGINE_DISPATCH_TOKEN/);
});
