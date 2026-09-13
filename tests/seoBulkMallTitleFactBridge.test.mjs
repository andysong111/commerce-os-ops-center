import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("SEO bulk 상품명은 FACT 브리지 없이 검증 상품명 재료를 먼저 조립하고 검색어로 보완한다", async () => {
  const page = await source("src/app/seo-bulk-cloud/page.tsx");
  const bulk = await source("src/lib/keywordEngineElonBulkFinal.ts");
  const composer = await source(
    "src/lib/keywordEngineElonMallTitleSafeComposer.ts",
  );
  const expansion = await source("src/lib/keywordEngineElonTitleExpansion.ts");
  const longTitle = await source(
    "src/lib/keywordEngineElonLongTitlePriority.ts",
  );

  assert.doesNotMatch(page, /SeoBulkMallTitleFactBridge/);
  assert.match(bulk, /const fallbackSearchKeywords = recoveredSearchKeywords/);
  assert.match(bulk, /buildKeywordElonTitleExpansionPool/);
  assert.match(bulk, /finalKeywords: titleKeywords/);
  assert.match(bulk, /titleExpansionPool/);
  assert.match(bulk, /buildKeywordElonTitleKeywordReservoirV8/);
  assert.match(bulk, /selectKeywordElonComplementSearchKeywordsV8/);
  assert.match(bulk, /const searchKeywords = searchSelection.searchKeywords/);
  assert.match(bulk, /SEO_KEYWORD_POLICY:TITLE_FIRST_SEARCH_COMPLEMENT_V8/);
  assert.match(bulk, /titleKeywords.length < 2/);
  assert.match(bulk, /searchKeywords.length !== 10/);
  assert.match(bulk, /mallTitles.length !== 29/);
  assert.match(bulk, /blockedKeys: input.blockedKeys/);
  assert.ok(bulk.indexOf("const mallComposition =") < bulk.indexOf("const searchSelection ="));
  assert.match(bulk, /TITLE_MALL_NAME_POLICY:INTENT_PORTFOLIO_V7/);
  assert.doesNotMatch(bulk, /diversifyKeywordElonMallTitles/);

  assert.match(composer, /long-title-priority-v6/);
  assert.match(composer, /long-title-priority-v6-final-fallback/);
  assert.match(composer, /KEYWORD_ELON_LONG_TITLE_HARD_MIN_BYTES/);
  assert.match(composer, /KEYWORD_ELON_LONG_TITLE_TARGET_BYTES/);
  assert.match(composer, /facts: \[\]/);
  assert.match(composer, /origin === "category_expansion"/);
  assert.doesNotMatch(
    composer,
    /detailHtml.*matchAll|mainImageUrl.*match|additionalImageUrls.*flatMap/,
  );

  assert.match(longTitle, /KEYWORD_ELON_LONG_TITLE_HARD_MIN_BYTES = 30/);
  assert.match(longTitle, /KEYWORD_ELON_LONG_TITLE_RECOMMENDED_MIN_BYTES = 40/);
  assert.match(longTitle, /KEYWORD_ELON_LONG_TITLE_IDEAL_MIN_BYTES = 44/);
  assert.match(longTitle, /KEYWORD_ELON_LONG_TITLE_TARGET_BYTES = 48/);
  assert.match(longTitle, /priorityTier/);
  assert.match(longTitle, /enumerateKeywordElonLongTitleSegments/);

  assert.match(expansion, /KEYWORD_ELON_CATEGORY_MATCH_GATE = 85/);
  assert.match(expansion, /competitionOpportunity/);
  assert.match(expansion, /intentClass/);
});
