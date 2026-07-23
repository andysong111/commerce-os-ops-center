import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildKeywordExecutionPreflight, buildCompactKeywordApplyExecutionPlan, DEFAULT_KEYWORD_EXECUTION_PREFLIGHT_CONFIG } from "../src/lib/keywordReviewExecutionPreflight.ts";
import { buildKeywordShoplingPayloadPreview } from "../src/lib/keywordReviewPayloadPreview.ts";
import { parseManualMallTitleKeywords, buildManualMallTitleVariants } from "../src/lib/manualMallTitleVariants.ts";
import { getMarketsForProductGroup } from "../src/lib/productGroupMarketRegistry.ts";

const titleKeywords = "농구패드,축구패드,야구패드,배구패드,골프패드";
const searchKeywords = "s1,s2,s3,s4,s5,s6,s7,s8,s9,s10";

function row(goodsKey, productGroup) {
  return { goodsKey, mallKey: "", originalTitle: "원래상품명 미니 보조기기", recommendedTitle: "엔진상품명", originalSiteSrch: "게임용,보조기기", recommendedSiteSrch: searchKeywords, siteSrchKeywordCount: 10, verifiedKeywordCount: 10, qualityStatus: "manual", confidenceStatus: "manual", blockReason: "", warningFlags: "", reviewReason: "", payloadStatus: "", approvalStatus: "approved", manualCandidateKeywords: searchKeywords, sourceRowIndex: Number(goodsKey), raw: {}, classification: "auto_apply_candidate", editedTitle: "", editedSiteSrch: "", reviewStatus: "approved", productGroup, productGroupType: productGroup.startsWith("소매") ? "소매" : "도매", productGroupStatus: "ok", groupSuffix: "" };
}

function preview(groups) {
  const rows = groups.map((group, index) => row(String(9000 + index), group));
  const manualTitleOverridesByGoodsKey = Object.fromEntries(rows.map((r) => [r.goodsKey, titleKeywords]));
  const manualKeywordOverridesByGoodsKey = Object.fromEntries(rows.map((r) => [r.goodsKey, searchKeywords]));
  return buildKeywordShoplingPayloadPreview(rows, { expandProductGroupMarkets: true, manualTitleOverridesByGoodsKey, manualKeywordOverridesByGoodsKey });
}

function preflight(result) {
  return buildKeywordExecutionPreflight({ previewResult: result, finalConfirmationText: "" }, { ...DEFAULT_KEYWORD_EXECUTION_PREFLIGHT_CONFIG, maxRows: 100 });
}

test("manual title keyword parser keeps spaces and removes case-insensitive duplicates", () => {
  assert.deepEqual(parseManualMallTitleKeywords(" Alpha Pad ;alpha pad\nBeta| Gamma "), ["Alpha Pad", "Beta", "Gamma"]);
});

test("도매1 상품 하나가 정확히 10개 쇼핑몰 행으로 확장된다", () => assert.equal(preview(["도매1"]).items.length, 10));
test("소매1 상품 하나가 정확히 12개 쇼핑몰 행으로 확장된다", () => assert.equal(preview(["소매1"]).items.length, 12));
test("도매4 상품 하나가 정확히 1개 행으로 확장된다", () => assert.equal(preview(["도매4"]).items.length, 1));
test("6개 그룹 상품 하나씩 입력하면 총 36개 행이 생성된다", () => assert.equal(preview(["도매1", "도매2", "도매3", "도매4", "소매1", "소매2"]).items.length, 36));

test("키워드 5개와 쇼핑몰 12개이면 12개 제목이 모두 다르다", () => {
  const titles = preview(["소매1"]).items.map((item) => item.final_title);
  assert.equal(new Set(titles).size, 12);
});

test("키워드 3개와 쇼핑몰 12개이면 가능한 6개 순열을 모두 사용한 뒤에만 반복된다", () => {
  const markets = getMarketsForProductGroup("소매1");
  const variants = buildManualMallTitleVariants({ keywords: ["A", "B", "C"], markets });
  assert.equal(new Set(variants.slice(0, 6).map((v) => v.title)).size, 6);
  assert.deepEqual(variants.slice(0, 6).map((v) => v.title), variants.slice(6, 12).map((v) => v.title));
});

test("같은 입력으로 두 번 실행하면 mall_key별 제목이 완전히 동일하다", () => {
  const a = preview(["소매1"]).items.map((item) => [item.mall_key, item.final_title]);
  const b = preview(["소매1"]).items.map((item) => [item.mall_key, item.final_title]);
  assert.deepEqual(a, b);
});

test("모든 제목의 토큰 multiset이 입력 토큰 multiset과 정확히 같다", () => {
  const expected = parseManualMallTitleKeywords(titleKeywords).sort().join("|");
  for (const item of preview(["소매1"]).items) assert.equal(item.final_title.split(" ").sort().join("|"), expected);
});

test("상품그룹명, 원래 상품명, 검색어, SAFE_MODIFIERS가 제목에 추가되지 않는다", () => {
  const text = preview(["도매1"]).items.map((item) => item.final_title).join(" ");
  for (const forbidden of ["도매1", "원래상품명", "게임용", "보조기기", "미니"]) assert.doesNotMatch(text, new RegExp(forbidden));
});

test("제목이 너무 길면 토큰을 삭제하지 않고 preflight 차단된다", () => {
  const r = row("9999", "도매4");
  const p = buildKeywordShoplingPayloadPreview([r], { expandProductGroupMarkets: true, manualTitleOverridesByGoodsKey: { 9999: "가".repeat(101) }, manualKeywordOverridesByGoodsKey: { 9999: searchKeywords } });
  assert.equal(p.items[0].final_title, "가".repeat(101));
  assert.equal(preflight(p).summary.blockedCount, 1);
});

test("동일 goods_key의 모든 final_site_srch가 같다", () => assert.equal(new Set(preview(["소매1"]).items.map((item) => item.final_site_srch)).size, 1));

test("compact execution plan에는 네 필드만 존재한다", () => {
  const plan = JSON.parse(buildCompactKeywordApplyExecutionPlan(preflight(preview(["도매4"]))));
  assert.deepEqual(Object.keys(plan[0]), ["goods_key", "mall_key", "final_title", "final_site_srch"]);
});

test("compact plan 행 수가 예상 쇼핑몰 수와 다르면 실제 반영이 차단된다", () => {
  const p = preview(["도매1"]);
  p.items.pop();
  assert.equal(preflight(p).summary.eligibleCount, 0);
});

test("중복 goods_key+mall_key가 존재하면 차단된다", () => {
  const p = preview(["도매4"]);
  p.items.push({ ...p.items[0] });
  assert.equal(preflight(p).summary.duplicateGoodsKeyCount, 2);
});

test("키워드 엔진 workflow나 artifact 없이도 수동 플로우가 실행 준비 상태에 도달한다", () => assert.equal(preflight(preview(["도매4"])).summary.eligibleCount, 1));

test("상품출시플로우가 가격설정 후 자동으로 키워드 엔진 dispatch를 실행하지 않는다", async () => {
  const source = await readFile(new URL("../src/components/product-launch-flow/ProductLaunchFlow.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /dispatchKeywordEngine\(\)/);
});

test("테스트 중 실제 GitHub Actions dispatch나 Shopling API 호출이 발생하지 않는다", async () => {
  const source = await readFile(new URL("../src/lib/manualMallTitleVariants.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /fetch\s*\(|workflow_dispatch/);
});
