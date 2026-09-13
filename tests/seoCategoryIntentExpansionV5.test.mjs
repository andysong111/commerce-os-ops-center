import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildKeywordElonTitleExpansionPool } from "../src/lib/keywordEngineElonTitleExpansion.ts";
import { composeKeywordElonSafeMallTitles } from "../src/lib/keywordEngineElonMallTitleSafeComposer.ts";
import { composeFreshKeywordElonMallTitles, preservesKeywordElonHistoricalFreshness } from "../src/lib/keywordEngineElonFreshMallTitleComposer.ts";
import {
  classifyKeywordElonLongTitleExpansion,
  keywordElonLongTitleLengthPenalty,
} from "../src/lib/keywordEngineElonLongTitlePriority.ts";
import { generateFinalKeywordOnlySeoTitleInventory } from "../src/lib/seoTitleFinalKeywordInventoryGenerator.ts";
import { PRODUCT_GROUP_MARKET_REGISTRY } from "../src/lib/productGroupMarketRegistry.ts";
import {
  keywordElonSeoCanonical,
  keywordElonSeoUtf8Bytes,
} from "../src/lib/keywordEngineElonLabSeoOutput.ts";

const FINAL = [
  "발바닥지압판",
  "발지압판",
  "발바닥마사지기",
  "지압발판",
  "발지압",
  "발마사지기",
  "발바닥안마기",
  "발마사지판",
  "발지압기",
  "지압마사지판",
];

function candidate(keyword, intentClass, overrides = {}) {
  return {
    keyword,
    searchKey: keyword,
    searchKeyword: keyword,
    relevance: 94,
    shoppingIntent: 90,
    specificity: 86,
    titleEligible: true,
    rationale: "test",
    sourceTags: ["searchad", "related"],
    totalSearch: 1200,
    pcSearch: 100,
    mobileSearch: 1100,
    compIdx: "LOW",
    plAvgDepth: 3,
    demandScore: 70,
    competitionOpportunity: 88,
    qualityScore: 86,
    safetyPass: true,
    safetyReason: "pass",
    dataConfidence: "high",
    categoryMatch: 95,
    categoryAligned: true,
    intentClass,
    ...overrides,
  };
}

const EXPANSION_CANDIDATES = [
  candidate("풋마사지판", "core_synonym", { totalSearch: 1800 }),
  candidate("발마사지보드", "form", { totalSearch: 1600 }),
  candidate("발지압매트", "form", { totalSearch: 1500 }),
  candidate("실내발지압", "context", { totalSearch: 900 }),
  candidate("사무실발지압", "context", { totalSearch: 800 }),
  candidate("홈트발마사지", "context", { totalSearch: 700 }),
  candidate("발스트레칭판", "use", { totalSearch: 650 }),
  candidate("발관리용품", "use", { totalSearch: 620 }),
  candidate("발지압운동", "use", { totalSearch: 600 }),
  candidate("발바닥자극판", "function", { totalSearch: 580 }),
  candidate("발바닥롤링판", "function", { totalSearch: 560 }),
  candidate("풋케어지압판", "category_tail", { totalSearch: 540 }),
  candidate("다리발안마용품", "category_tail", { totalSearch: 520 }),
  candidate("족저근막염치료", "function", {
    categoryMatch: 20,
    categoryAligned: false,
    relevance: 40,
    safetyPass: false,
    qualityScore: 0,
  }),
];

const ALLOWED = [...FINAL, ...EXPANSION_CANDIDATES.map((row) => row.searchKey)];

function buildPool() {
  return buildKeywordElonTitleExpansionPool({
    candidates: [
      ...FINAL.map((keyword) => candidate(keyword, "core_synonym")),
      ...EXPANSION_CANDIDATES,
    ],
    searchKeywords: FINAL,
    allowedKeys: ALLOWED,
    category: "생활/건강>안마용품>다리/발안마기",
    limit: 30,
  });
}

const CONTEXT = {
  modelNumber: "AAA491",
  productName: "발바닥 지압 스텝퍼",
  category: "생활/건강>안마용품>다리/발안마기",
  detailHtml: '<img src="https://example.com/윤지선작업/예지/공지.jpg" />',
};

test("FINAL 10개 외 카테고리 일치 후보만 TITLE EXPANSION POOL에 보존한다", () => {
  const pool = buildPool();
  assert.ok(pool.length >= 10, `pool=${pool.length}`);
  assert.equal(pool.some((row) => FINAL.includes(row.keyword)), false);
  assert.equal(pool.some((row) => row.keyword.includes("족저근막염")), false);
  assert.equal(pool.every((row) => row.categoryAligned === true), true);
  assert.equal(pool.every((row) => row.categoryMatch >= 85), true);
  assert.ok(new Set(pool.map((row) => row.intentClass)).size >= 5);
});

test("좋은 동의어·형태 재료를 우선하고 상황형 카테고리 인접어는 후순위로 둔다", () => {
  const pool = buildPool();
  const preferred = pool.find((row) => row.keyword === "풋마사지판");
  const adjacent = pool.find((row) => row.keyword === "실내발지압");
  assert.ok(preferred);
  assert.ok(adjacent);
  assert.equal(classifyKeywordElonLongTitleExpansion(preferred), "preferred");
  assert.equal(classifyKeywordElonLongTitleExpansion(adjacent), "adjacent");
  assert.ok(keywordElonLongTitleLengthPenalty(48) < keywordElonLongTitleLengthPenalty(42));
  assert.ok(keywordElonLongTitleLengthPenalty(42) < keywordElonLongTitleLengthPenalty(34));
});

test("29개 쇼핑몰 상품명은 FINAL anchor를 유지하며 44~50B 긴 제목과 우수 확장재료를 우선한다", () => {
  const pool = buildPool();
  const result = composeKeywordElonSafeMallTitles({
    markets: PRODUCT_GROUP_MARKET_REGISTRY,
    finalKeywords: FINAL,
    titleExpansionPool: pool,
    modelName: "발바닥 지압판",
    context: CONTEXT,
  });

  assert.equal(result.rows.length, 29);
  assert.equal(result.uniqueTitleCount, 29);
  assert.ok(result.warnings.includes("SEO_MALL_TITLE_SOURCE:LONG_TITLE_PRIORITY_V6"));
  const expansionByKey = new Map(
    pool.map((row) => [keywordElonSeoCanonical(row.keyword), row]),
  );
  const finalKeys = new Set(FINAL.map(keywordElonSeoCanonical));
  let expansionRows = 0;
  let preferredRows = 0;
  let adjacentRows = 0;
  let recommendedLengthRows = 0;
  let totalBytes = 0;
  for (const row of result.rows) {
    const bytes = keywordElonSeoUtf8Bytes(row.title);
    totalBytes += bytes;
    if (bytes >= 40) recommendedLengthRows += 1;
    assert.ok(bytes >= 30 && bytes <= 50, `${bytes}B ${row.title}`);
    assert.equal(
      row.keywordMaterials.some((material) =>
        finalKeys.has(keywordElonSeoCanonical(material)),
      ),
      true,
      row.title,
    );
    const expansions = row.keywordMaterials
      .map((material) => expansionByKey.get(keywordElonSeoCanonical(material)))
      .filter(Boolean);
    if (expansions.length) expansionRows += 1;
    if (
      expansions.some(
        (material) => classifyKeywordElonLongTitleExpansion(material) === "preferred",
      )
    ) {
      preferredRows += 1;
    }
    if (
      expansions.some(
        (material) => classifyKeywordElonLongTitleExpansion(material) === "adjacent",
      )
    ) {
      adjacentRows += 1;
    }
    assert.doesNotMatch(row.title, /윤지선작업|예지|공지|족저근막염|치료/);
  }
  assert.ok(expansionRows >= 10, `expansionRows=${expansionRows}`);
  assert.ok(preferredRows >= adjacentRows, `preferred=${preferredRows} adjacent=${adjacentRows}`);
  assert.ok(recommendedLengthRows >= 20, `recommended=${recommendedLengthRows}`);
  assert.ok(totalBytes / result.rows.length >= 41, `average=${totalBytes / result.rows.length}`);
});

test("새 SEO run은 과거 29개를 제외하고 단순 어순변경이 아닌 새 상품명을 우선한다", () => {
  const pool = buildPool();
  const first = composeFreshKeywordElonMallTitles({
    markets: PRODUCT_GROUP_MARKET_REGISTRY,
    finalKeywords: FINAL,
    titleExpansionPool: pool,
    modelName: "발바닥 지압판",
    context: CONTEXT,
    variationSeed: "seo-run-first",
  });
  const previousTitles = first.rows.map((row) => row.title);
  const second = composeFreshKeywordElonMallTitles({
    markets: PRODUCT_GROUP_MARKET_REGISTRY,
    finalKeywords: FINAL,
    titleExpansionPool: pool,
    modelName: "발바닥 지압판",
    context: CONTEXT,
    variationSeed: "seo-run-second",
    excludedTitles: previousTitles,
  });
  const firstCanonical = new Set(previousTitles.map(keywordElonSeoCanonical));
  const exactReuse = second.rows.filter((row) =>
    firstCanonical.has(keywordElonSeoCanonical(row.title)),
  ).length;
  assert.equal(second.rows.length, 29);
  assert.equal(exactReuse, 0, `exactReuse=${exactReuse}`);
  assert.ok(
    second.warnings.some(
      (warning) => warning === "SEO_RUN_EXACT_TITLE_REUSE:0",
    ),
  );
});

test("145개 추가등록 재고도 긴 제목 정책·FINAL anchor·확장 우선순위를 공유한다", () => {
  const pool = buildPool();
  const result = generateFinalKeywordOnlySeoTitleInventory({
    finalKeywords: FINAL,
    titleExpansionPool: pool,
    rounds: 5,
  });
  assert.equal(result.generatedCount, 145);
  assert.equal(
    new Set(result.candidates.map((row) => row.titleFingerprint)).size,
    145,
  );
  assert.ok(result.expansionMaterialCount >= 10);
  assert.ok(
    result.warnings.includes("SEO_TITLE_INVENTORY_SOURCE:LONG_TITLE_PRIORITY_V6"),
  );
  const finalKeys = new Set(FINAL.map(keywordElonSeoCanonical));
  let expanded = 0;
  let recommended = 0;
  let totalBytes = 0;
  for (const row of result.candidates) {
    const bytes = keywordElonSeoUtf8Bytes(row.title);
    totalBytes += bytes;
    if (bytes >= 40) recommended += 1;
    assert.ok(bytes >= 30 && bytes <= 50, `${bytes}B ${row.title}`);
    assert.equal(
      row.sourceMaterials.some((material) =>
        finalKeys.has(keywordElonSeoCanonical(material)),
      ),
      true,
      row.title,
    );
    if (row.metadata.materialOrigins.includes("category_expansion")) expanded += 1;
    assert.equal(row.metadata.strategy, "long-title-priority-v6");
  }
  assert.ok(expanded >= 60, `expanded=${expanded}`);
  assert.ok(recommended >= 100, `recommended=${recommended}`);
  assert.ok(totalBytes / result.candidates.length >= 40, `average=${totalBytes / result.candidates.length}`);
});

test("segmented SEO API는 Product Launch 카테고리와 run freshness 입력을 점수화/조립에 전달한다", async () => {
  const route = await readFile(
    new URL("../src/app/api/keyword-engine-elon-lab/route.ts", import.meta.url),
    "utf8",
  );
  const scoring = await readFile(
    new URL("../src/lib/keywordEngineElonLabV2Scoring.ts", import.meta.url),
    "utf8",
  );
  const bulk = await readFile(
    new URL("../src/lib/keywordEngineElonBulkFinal.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /SHOPLING_CATEGORY=/);
  assert.match(route, /categoryFromSource/);
  assert.match(route, /variationSeed/);
  assert.match(route, /excludedMallTitles/);
  assert.match(scoring, /categoryMatch/);
  assert.match(scoring, /intentClass/);
  assert.match(scoring, /shoplingCategory/);
  assert.match(bulk, /buildKeywordElonTitleExpansionPool/);
  assert.match(bulk, /composeFreshKeywordElonMallTitles/);
  assert.match(bulk, /TITLE_EXPANSION_POOL_COUNT/);
  assert.match(bulk, /TITLE_MALL_NAME_POLICY:INTENT_PORTFOLIO_V7/);
});

function historyResult(...titles) {
  return { rows: titles.map(title => ({ title })) };
}
test("마지막 정리는 이미 피한 과거 완성 상품명을 다시 도입하지 않는다", () => {
  const history = ["냉장고 자석 선반"];
  assert.equal(preservesKeywordElonHistoricalFreshness(
    historyResult("냉장고 선반 수납"), historyResult("냉장고 자석 선반"), history), false);
});
test("과거 사용 핵심 단어 재사용은 허용하고 완성 문구만 비교한다", () => {
  const history = ["냉장고 자석 선반"];
  assert.equal(preservesKeywordElonHistoricalFreshness(
    historyResult("냉장고 자석 수납"), historyResult("냉장고 자석 정리"), history), true);
});
test("유효 재료가 부족하면 동일한 재사용 수준을 허용해 생성을 막지 않는다", () => {
  const current = historyResult("냉장고 자석 선반");
  const before = JSON.stringify(current);
  assert.equal(preservesKeywordElonHistoricalFreshness(current, current, ["냉장고 자석 선반"]), true);
  assert.equal(JSON.stringify(current), before);
});
test("새로운 조합을 과거 문구의 단순 어순 변경으로 악화시키지 않는다", () => {
  assert.equal(preservesKeywordElonHistoricalFreshness(
    historyResult("냉장고 선반 수납"), historyResult("선반 냉장고 자석"), ["냉장고 자석 선반"]), false);
});
test("과거 이력이 없을 때 기존 쇼핑몰 다양화 경로는 그대로 허용된다", () => {
  assert.equal(preservesKeywordElonHistoricalFreshness(
    historyResult("냉장고 자석 선반"), historyResult("선반 자석 냉장고"), []), true);
});
test("공백과 NFKC 표기 차이를 이용한 과거 완성 문구 재도입도 감지한다", () => {
  assert.equal(preservesKeywordElonHistoricalFreshness(
    historyResult("수납 선반"), historyResult("ABC 자석 선반"), ["ＡＢＣ   자석 선반"]), false);
});
