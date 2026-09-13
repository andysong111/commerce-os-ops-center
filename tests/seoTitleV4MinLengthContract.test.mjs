import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("V8 title-first generation preserves V6 ledger compatibility and 30~50B title limits", async () => {
  const sync = await source("src/lib/seoTitleBulkInventorySync.ts");
  const generator = await source(
    "src/lib/seoTitleFinalKeywordInventoryGenerator.ts",
  );
  const bulk = await source("src/lib/keywordEngineElonBulkFinal.ts");
  const policy = await source("src/lib/keywordEngineElonLongTitlePriority.ts");

  assert.match(sync, /seo-bulk-cloud-inventory-v6-long-title-priority/);
  assert.match(sync, /final10-plus-priority-expansion-long-title-v6/);
  assert.match(sync, /final10-long-title-v6-fallback/);
  assert.match(sync, /KEYWORD_ELON_LONG_TITLE_HARD_MIN_BYTES/);
  assert.match(sync, /KEYWORD_ELON_LONG_TITLE_RECOMMENDED_MIN_BYTES/);
  assert.match(sync, /KEYWORD_ELON_LONG_TITLE_IDEAL_MIN_BYTES/);
  assert.match(sync, /KEYWORD_ELON_LONG_TITLE_TARGET_BYTES/);
  assert.match(sync, /adjacentExpansionFallback: true/);
  assert.match(sync, /purgeLegacyUnissuedInventory/);
  assert.match(sync, /expansionPoolFromCurrentSeoFinal/);
  assert.match(sync, /expansionPoolFromExistingLedger/);
  assert.match(sync, /__seoTitleExpansionV6/);
  assert.match(sync, /__seoTitleExpansionV5/);
  assert.match(sync, /seo-bulk-cloud-long-title-priority-v6/);
  assert.match(sync, /seo-bulk-cloud-category-intent-v5/);

  assert.match(
    bulk,
    /SEO_FINAL_SOURCE_V8 = "seo-bulk-cloud-title-first-search-complement-v8"/,
  );
  assert.match(
    bulk,
    /SEO_TITLE_EXPANSION_META_GROUP_KEY = "__seoTitleExpansionV6"/,
  );
  assert.match(
    bulk,
    /groupProductNames\[SEO_TITLE_EXPANSION_META_GROUP_KEY\] = JSON\.stringify/,
  );
  assert.match(bulk, /source: SEO_FINAL_SOURCE_V8/);
  assert.match(bulk, /const searchKeywords = searchSelection.searchKeywords/);
  assert.match(bulk, /titleMaterialPolicy: titleExpansionPool\.length/);

  assert.match(policy, /KEYWORD_ELON_LONG_TITLE_HARD_MIN_BYTES = 30/);
  assert.match(policy, /KEYWORD_ELON_LONG_TITLE_RECOMMENDED_MIN_BYTES = 40/);
  assert.match(policy, /KEYWORD_ELON_LONG_TITLE_IDEAL_MIN_BYTES = 44/);
  assert.match(policy, /KEYWORD_ELON_LONG_TITLE_TARGET_BYTES = 48/);
  assert.match(policy, /priorityTier/);
  assert.match(policy, /"preferred"/);
  assert.match(policy, /"supporting"/);
  assert.match(policy, /"adjacent"/);
  assert.match(policy, /enumerateKeywordElonLongTitleSegments/);

  assert.match(generator, /long-title-priority-v6/);
  assert.match(generator, /long-title-priority-v6-final-fallback/);
  assert.match(generator, /keywordElonLongTitleLengthPenalty/);
  assert.doesNotMatch(generator, /윤지선작업|예지|하단공지/);
});
