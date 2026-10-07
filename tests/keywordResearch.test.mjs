import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildKeywordResearchRows,
  enginePassedKeywordResearchRows,
  isKeywordResearchSaveable,
  keywordResearchCompetition,
  keywordResearchSummary,
} from "../src/lib/keywordResearch.ts";
import { moduleRegistry } from "../src/lib/moduleRegistry.ts";
import { getWorkspaceGroup } from "../src/lib/opsWorkspace.ts";
import {
  composeKeywordResearchTitle,
  keywordResearchTitleCoverage,
} from "../src/lib/keywordResearchTitle.ts";

function stat(overrides = {}) {
  return {
    keyword: "샤워기필터",
    relKeyword: "샤워기필터",
    totalSearch: 4200,
    pcSearch: 500,
    mobileSearch: 3700,
    compIdx: "LOW",
    plAvgDepth: 4,
    monthlyAvePcClicks: 12,
    monthlyAveMobileClicks: 48,
    monthlyAvePcCtr: 1.2,
    monthlyAveMobileCtr: 2.4,
    sourceSeeds: ["샤워기필터"],
    ...overrides,
  };
}

test("keyword research classifies SearchAd competition consistently", () => {
  assert.deepEqual(keywordResearchCompetition("LOW"), {
    value: "low",
    label: "낮음",
    index: "LOW",
  });
  assert.equal(keywordResearchCompetition("MID").value, "medium");
  assert.equal(keywordResearchCompetition("HIGH").value, "high");
  assert.equal(keywordResearchCompetition(null).value, "unknown");
});

test("research rows combine demand, competition, supply and engine semantics", () => {
  const rows = buildKeywordResearchRows({
    seed: "샤워기 필터",
    stats: [
      stat(),
      stat({ keyword: "욕실", relKeyword: "욕실", totalSearch: 90000, compIdx: "HIGH" }),
    ],
    semanticCandidates: [
      {
        keyword: "샤워기필터",
        searchKey: "샤워기필터",
        searchKeyword: "샤워기필터",
        relevance: 97,
        shoppingIntent: 94,
        specificity: 90,
        titleEligible: true,
        rationale: "동일 상품군 · 안전 Gate 통과",
        sourceTags: ["SearchAd 연관키워드", "AI 의미 Gate"],
        totalSearch: 4200,
        pcSearch: 500,
        mobileSearch: 3700,
        compIdx: "LOW",
        plAvgDepth: 4,
        demandScore: 78,
        competitionOpportunity: 88,
        qualityScore: 90,
        safetyPass: true,
        safetyReason: "통과",
        dataConfidence: "high",
      },
    ],
    supplyByKeyword: { 샤워기필터: 17000 },
  });

  const candidate = rows.find((row) => row.keyword === "샤워기필터");
  assert.ok(candidate);
  assert.equal(candidate.productCount, 17000);
  assert.equal(candidate.competition, "low");
  assert.equal(candidate.enginePass, true);
  assert.equal(isKeywordResearchSaveable(candidate), true);
  assert.ok(candidate.opportunityScore > 60);

  const broad = rows.find((row) => row.keyword === "욕실");
  assert.ok(broad);
  assert.equal(isKeywordResearchSaveable(broad), false);
  assert.ok(broad.opportunityScore < candidate.opportunityScore);
  assert.ok(broad.opportunityScore <= 59.9);
});

test("summary exposes the core item-scout style metrics", () => {
  const rows = buildKeywordResearchRows({ seed: "샤워기 필터", stats: [stat()] });
  const summary = keywordResearchSummary("샤워기 필터", rows);
  assert.equal(summary.keywordCount, 1);
  assert.equal(summary.lowCompetitionCount, 1);
  assert.equal(summary.seedSearchVolume, 4200);
  assert.ok(summary.bestOpportunityScore > 0);
});

test("engine-generated related keywords remain visible without SearchAd demand rows", () => {
  const rows = buildKeywordResearchRows({
    seed: "계란펀칭기",
    stats: [stat({
      keyword: "계란펀칭기",
      relKeyword: "계란펀칭기",
      totalSearch: 330,
      pcSearch: 40,
      mobileSearch: 290,
    })],
    semanticCandidates: [
      {
        keyword: "계란껍질깨기",
        searchKey: "계란껍질깨기",
        searchKeyword: "계란껍질깨기",
        relevance: 92,
        shoppingIntent: 88,
        specificity: 86,
        titleEligible: true,
        rationale: "동일 상품군 확장 후보",
        sourceTags: ["market_bridge_seed", "ai_recall_support"],
        totalSearch: null,
        pcSearch: null,
        mobileSearch: null,
        compIdx: null,
        plAvgDepth: null,
        demandScore: 40,
        competitionOpportunity: 55,
        qualityScore: 78,
        safetyPass: true,
        safetyReason: "통과",
        dataConfidence: "medium",
      },
    ],
  });

  assert.equal(rows.length, 2);
  const expanded = rows.find((row) => row.keyword === "계란껍질깨기");
  assert.ok(expanded);
  assert.equal(expanded.totalSearch, null);
  assert.equal(expanded.enginePass, true);
  assert.deepEqual(expanded.sourceTags, ["market_bridge_seed", "ai_recall_support"]);
});

test("research can restrict output to the engine-scored candidate pool", () => {
  const rows = buildKeywordResearchRows({
    seed: "계란펀칭기",
    stats: [
      stat({ keyword: "계란펀칭기", relKeyword: "계란펀칭기" }),
      stat({ keyword: "군사", relKeyword: "군사", totalSearch: 1520 }),
    ],
    semanticCandidates: [],
    candidateKeywords: ["계란펀칭기"],
  });

  assert.deepEqual(rows.map((row) => row.keyword), ["계란펀칭기"]);
});

test("published keyword research output is fixed to engine-pass rows", () => {
  const rows = buildKeywordResearchRows({
    seed: "계란펀칭기",
    stats: [
      stat({ keyword: "계란펀칭기", relKeyword: "계란펀칭기" }),
      stat({ keyword: "군사", relKeyword: "군사", totalSearch: 1520 }),
    ],
  });

  const published = enginePassedKeywordResearchRows(rows);
  assert.ok(published.length > 0);
  assert.ok(published.every((row) => row.enginePass));
  assert.deepEqual(published.map((row) => row.keyword), ["계란펀칭기"]);
});

test("automatic product naming applies three diverse top materials instead of returning only the seed", () => {
  const common = {
    specificity: 90,
    enginePass: true,
  };
  const composed = composeKeywordResearchTitle({
    seed: "계란펀칭기",
    mode: "auto",
    materials: [
      { ...common, keyword: "구멍계란펀칭기", relevance: 95, shoppingIntent: 90, opportunityScore: 69.9 },
      { ...common, keyword: "계란펀칭기", relevance: 98, shoppingIntent: 92, opportunityScore: 69.8 },
      { ...common, keyword: "달걀구멍내기", relevance: 90, shoppingIntent: 90, opportunityScore: 69.2 },
      { ...common, keyword: "구멍내는기계달걀", relevance: 90, shoppingIntent: 85, opportunityScore: 68.7 },
      { ...common, keyword: "에그피어서", relevance: 88, shoppingIntent: 85, opportunityScore: 68.4 },
      { ...common, keyword: "타공기", relevance: 85, shoppingIntent: 80, opportunityScore: 71.9 },
    ],
  });

  assert.deepEqual(composed.usedKeywords, ["계란펀칭기", "달걀구멍내기", "에그피어서"]);
  assert.equal(composed.title, "계란펀칭기 달걀구멍내기 에그피어서");
  assert.equal(keywordResearchTitleCoverage("계란펀칭기", composed.usedKeywords), 1);
  assert.equal(keywordResearchTitleCoverage(composed.title, composed.usedKeywords), 3);
  assert.ok(composed.byteLength <= 100);
});

test("selected product naming respects the operator-selected material set", () => {
  const composed = composeKeywordResearchTitle({
    seed: "계란펀칭기",
    mode: "selected",
    materials: [
      { keyword: "계란펀칭기", relevance: 98, shoppingIntent: 92, specificity: 90, opportunityScore: 69.8, enginePass: true },
      { keyword: "에그피어서", relevance: 88, shoppingIntent: 85, specificity: 90, opportunityScore: 68.4, enginePass: true },
    ],
  });

  assert.deepEqual(composed.usedKeywords, ["계란펀칭기", "에그피어서"]);
  assert.equal(composed.title, "계란펀칭기 에그피어서");
});

test("keyword research is exposed in the content-keyword menu and wired end-to-end", async () => {
  const researchModule = moduleRegistry.find((candidate) => candidate.id === "keyword-research");
  assert.equal(researchModule?.route, "/keyword-research");
  assert.equal(getWorkspaceGroup("keyword-research")?.id, "content-keyword");

  const [page, client, route, server, contentMenu] = await Promise.all([
    readFile(new URL("../src/app/keyword-research/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/keyword-research/KeywordResearchClient.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/keyword-research/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/keywordResearchServer.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/dashboard/OpsDashboardWithSaasTestClone.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(page, /키워드 조회/);
  assert.match(client, /\/api\/keyword-research/);
  assert.match(client, /captureKeywordOpportunities/);
  assert.match(client, /기회점수/);
  assert.match(client, /추천 상품명 만들기/);
  assert.doesNotMatch(client, /label="엔진 품질"/);
  assert.match(route, /researchKeyword/);
  assert.match(route, /generateKeywordResearchTitle/);
  assert.match(server, /discoverKeywordElonCandidatesResilient/);
  assert.match(server, /enrichKeywordElonDemand/);
  assert.match(server, /scoreKeywordElonCandidatesBatched/);
  assert.match(server, /generateKeywordElonTitle/);
  assert.match(server, /enginePassedKeywordResearchRows/);
  assert.match(server, /keywordResearchTitleCoverage/);
  assert.match(server, /keyword_coverage_repair/);
  assert.match(server, /NAVER_SHOPPING_SEARCH_URL/);
  assert.match(contentMenu, /"keyword-research"/);
});
