import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SHOPLING_PRODUCT_TITLE_MAX_BYTES,
  buildManualMallTitleVariants,
  parseManualMallTitleKeywords,
  permutationCount,
  unrankKeywordPermutation,
} from "../src/lib/manualMallTitleVariants.ts";

function markets(count) {
  return Array.from({ length: count }, (_, index) => ({
    mallKey: `MALL_${String(index + 1).padStart(5, "0")}`,
    marketName: `market-${index + 1}`,
    accountIdLabel: `account-${index + 1}`,
  }));
}

function sortedMultiset(values) {
  return [...values].map((value) => value.toLocaleLowerCase("und")).sort();
}

test("parses commas, semicolons, pipes, and newlines", () => {
  assert.deepEqual(parseManualMallTitleKeywords("세차 드라잉타월, 대형 세차타월;극세사 타월|버핑 타월\n유리 타월"), ["세차 드라잉타월", "대형 세차타월", "극세사 타월", "버핑 타월", "유리 타월"]);
});

test("preserves internal spaces and normalizes surrounding/consecutive spaces", () => {
  assert.deepEqual(parseManualMallTitleKeywords("  세차   드라잉타월  ,  대형   세차타월  "), ["세차 드라잉타월", "대형 세차타월"]);
});

test("removes duplicates case-insensitively while preserving first spelling", () => {
  assert.deepEqual(parseManualMallTitleKeywords("Towel, towel;TOWEL|타월"), ["Towel", "타월"]);
});

test("permutationCount returns factorial as bigint", () => {
  assert.equal(permutationCount(0), 1n);
  assert.equal(permutationCount(5), 120n);
});

test("first 12 permutations for 5 keywords are unique", () => {
  const keywords = ["a", "b", "c", "d", "e"];
  const titles = buildManualMallTitleVariants({ keywords, markets: markets(12) }).map((row) => row.title);
  assert.equal(new Set(titles).size, 12);
});

test("3 keywords repeat only after 6 permutations", () => {
  const keywords = ["a", "b", "c"];
  const titles = buildManualMallTitleVariants({ keywords, markets: markets(8) }).map((row) => row.title);
  assert.equal(new Set(titles.slice(0, 6)).size, 6);
  assert.equal(titles[6], titles[0]);
  assert.equal(titles[7], titles[1]);
});

test("same input produces identical output", () => {
  const input = { keywords: ["세차 드라잉타월", "대형 세차타월", "극세사 타월"], markets: markets(6) };
  assert.deepEqual(buildManualMallTitleVariants(input), buildManualMallTitleVariants(input));
  assert.deepEqual(unrankKeywordPermutation(input.keywords, 100n), unrankKeywordPermutation(input.keywords, 100n));
});

test("orderedKeywords multiset matches the original keywords multiset", () => {
  const keywords = ["세차 드라잉타월", "대형 세차타월", "극세사 타월"];
  for (const row of buildManualMallTitleVariants({ keywords, markets: markets(6) })) {
    assert.deepEqual(sortedMultiset(row.orderedKeywords), sortedMultiset(keywords));
    assert.equal(row.keywordIntegrityOk, true);
  }
});

test("multi-word keywords remain single keywords", () => {
  const keywords = ["세차 드라잉타월", "대형 세차타월", "극세사 타월"];
  const [row] = buildManualMallTitleVariants({ keywords, markets: markets(1) });
  assert.deepEqual(row.orderedKeywords, keywords);
  assert.equal(row.keywordCount, 3);
  assert.equal(row.includedKeywordCount, 3);
});

test("title has no added or deleted words beyond the input keywords", () => {
  const keywords = ["세차 드라잉타월", "대형 세차타월", "극세사 타월"];
  for (const row of buildManualMallTitleVariants({ keywords, markets: markets(6) })) {
    assert.equal(row.title, row.orderedKeywords.join(" "));
    assert.equal(row.orderedKeywords.length, keywords.length);
    for (const keyword of keywords) assert.equal(row.orderedKeywords.includes(keyword), true);
  }
});

test("UTF-8 titles over 100 bytes are blocked without truncation", () => {
  const keywords = ["가".repeat(34)];
  const [row] = buildManualMallTitleVariants({ keywords, markets: markets(1) });
  assert.equal(SHOPLING_PRODUCT_TITLE_MAX_BYTES, 100);
  assert.equal(row.title, keywords[0]);
  assert.ok(row.byteLength > SHOPLING_PRODUCT_TITLE_MAX_BYTES);
  assert.ok(row.validationErrors.includes("manual_mall_title_max_bytes_exceeded"));
});

test("empty keyword input produces validation error", () => {
  const [row] = buildManualMallTitleVariants({ keywords: parseManualMallTitleKeywords(" , ; | \n "), markets: markets(1) });
  assert.deepEqual(row.orderedKeywords, []);
  assert.ok(row.validationErrors.includes("manual_mall_title_keywords_required"));
});

test("module has no fetch, API calls, workflow dispatch, or React/UI code", () => {
  const source = readFileSync("src/lib/manualMallTitleVariants.ts", "utf8");
  for (const forbidden of ["fetch(", "workflow_dispatch", "React", "useState", "useEffect", "jsx", "tsx", "api/shopling", "githubActionsDispatch"]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});
