import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  KEYWORD_OPPORTUNITY_STORAGE_KEY,
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
  assert.deepEqual(result.records[0].goodsKeys, ["100001"]);
  assert.equal(isGoodCompetitionIndex("낮음"), true);
  assert.equal(isGoodCompetitionIndex("high"), false);
  assert.equal(isGoodCompetitionIndex(1), false);
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
  assert.match(csv, /competition_index,monthly_search/);
  assert.match(csv, /"수납, 정리함"/);
  assert.match(csv, /100003/);
});

test("keyword opportunity library is exposed as a sourcing menu and product launch records results", async () => {
  const opportunityModule = moduleRegistry.find(
    (candidate) => candidate.id === "keyword-opportunity-library",
  );
  assert.equal(opportunityModule?.route, "/keyword-opportunity-library");
  assert.equal(getWorkspaceGroup("keyword-opportunity-library")?.id, "sourcing-order");

  const [page, launchFlow, reviewWorkspace] = await Promise.all([
    readFile(new URL("../src/app/keyword-opportunity-library/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/product-launch-flow/ProductLaunchFlowSimple.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/keyword-review/KeywordReviewWorkspace.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(page, /키워드 소싱 후보/);
  assert.match(page, /시장 확인/);
  assert.match(page, /1688 소싱 준비/);
  assert.match(launchFlow, /captureKeywordOpportunities/);
  assert.match(reviewWorkspace, /captureKeywordOpportunities/);
});
