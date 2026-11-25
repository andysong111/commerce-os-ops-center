import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { composeFreshKeywordElonMallTitles } from "../src/lib/keywordEngineElonFreshMallTitleComposerV11.ts";
import { PRODUCT_GROUP_MARKET_REGISTRY } from "../src/lib/productGroupMarketRegistry.ts";
import { applyProductLaunchTrackerMutation } from "../src/lib/productLaunchTrackerOptimized.ts";
import {
  buildSeoRequiredExpansionSeeds,
  normalizeSeoRequiredKeywords,
  prioritizeSeoRequiredSearchKeywords,
  seoTitleIncludesRequiredKeyword,
} from "../src/lib/seoRequiredKeywords.ts";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("상품상세 patch는 상품명·검색어 필수 키워드를 정규화해 item payload에 보존한다", () => {
  const result = applyProductLaunchTrackerMutation(
    {
      schemaVersion: 3,
      items: [{
        id: "launch-required-keywords",
        modelNumber: "AAA999",
        productName: "무선 게임패드",
        orderOptions: [],
      }],
    },
    {
      operation: "patch_item",
      itemId: "launch-required-keywords",
      patch: {
        requiredTitleKeywords: [" 무선게임패드 ", "블루투스컨트롤러", "무선게임패드"],
        requiredSearchKeywords: "PC게임패드, 조이스틱, PC게임패드",
      },
    },
  );
  const item = result.state.items[0];
  assert.deepEqual(item.requiredTitleKeywords, ["무선게임패드", "블루투스컨트롤러"]);
  assert.deepEqual(item.requiredSearchKeywords, ["PC게임패드", "조이스틱"]);
});

test("상품명 필수 키워드만 확장 seed 앞자리에 고정하고 자동 seed로 나머지를 채운다", () => {
  const seeds = buildSeoRequiredExpansionSeeds(
    ["무선게임패드", "블루투스컨트롤러"],
    ["게임패드", "조이스틱", "PC게임패드"],
  );
  assert.deepEqual(seeds.slice(0, 2), ["무선게임패드", "블루투스컨트롤러"]);
  assert.ok(seeds.includes("게임패드"));
  assert.ok(!seeds.includes("검색어전용키워드"));
});

test("검색어 필수 키워드는 최종 10칸에서 우선 보존되고 중복은 한 칸만 사용한다", () => {
  const keywords = prioritizeSeoRequiredSearchKeywords(
    ["PC게임패드", "조이스틱"],
    ["조이스틱", "게임패드", "컨트롤러", "패드", "게임용품", "PC게임", "모바일게임", "무선패드", "블루투스패드", "스마트폰패드"],
  );
  assert.equal(keywords.length, 10);
  assert.deepEqual(keywords.slice(0, 2), ["PC게임패드", "조이스틱"]);
  assert.equal(keywords.filter((keyword) => keyword === "조이스틱").length, 1);
});

test("29개 쇼핑몰 상품명 모두에 상품명 필수 키워드를 넣고 50bytes 한도를 지킨다", () => {
  const requiredTitleKeywords = ["발지압판", "지압발판"];
  const result = composeFreshKeywordElonMallTitles({
    markets: PRODUCT_GROUP_MARKET_REGISTRY,
    finalKeywords: [
      "발지압판",
      "지압발판",
      "발바닥",
      "지압",
      "발판",
      "마사지",
      "발지압",
      "발마사지",
      "지압기",
      "발관리",
    ],
    requiredTitleKeywords,
    modelName: "발바닥 지압스텝퍼",
    context: {
      modelNumber: "AAA491",
      productName: "발바닥 지압스텝퍼",
      category: "생활/건강>안마용품>다리/발안마기",
    },
  });

  assert.equal(result.rows.length, 29);
  assert.equal(result.uniqueTitleCount, 29);
  for (const row of result.rows) {
    for (const keyword of requiredTitleKeywords) {
      assert.equal(seoTitleIncludesRequiredKeyword(row.title, keyword), true, row.title);
    }
    assert.ok(Buffer.byteLength(row.title, "utf8") <= 50, row.title);
  }
});

test("한도 초과·금지어 입력은 조용히 잘라내지 않고 저장/등록 전에 차단한다", () => {
  assert.throws(
    () => normalizeSeoRequiredKeywords({ titleKeywords: "첫키워드,둘키워드,셋키워드,넷키워드" }),
    /최대 3개/,
  );
  assert.throws(
    () => normalizeSeoRequiredKeywords({ searchKeywords: "도매상품" }),
    /금지·잡음/,
  );
  assert.throws(
    () => normalizeSeoRequiredKeywords({ titleKeywords: "가나다라마바사아,아사바마라다나가" }),
    /합계.*43bytes/,
  );
});

test("상품상세 → SEO RUN → FINAL 공통 경로에 필수 키워드 계약이 연결된다", async () => {
  const editor = await source("src/app/product-launch-editor/ProductLaunchStandaloneEditor.tsx");
  const route = await source("src/app/api/seo-run-jobs/route.ts");
  const worker = await source("src/lib/seoRunWorker.ts");
  const finalComposer = await source("src/lib/keywordEngineElonBulkFinal.ts");

  assert.match(editor, /상품명 필수 포함 키워드/);
  assert.match(editor, /검색어 필수 포함 키워드/);
  assert.match(editor, /requiredTitleKeywords: requiredKeywords\.titleKeywords/);
  assert.match(editor, /requiredSearchKeywords: requiredKeywords\.searchKeywords/);
  assert.match(editor, /상품명 필수 키워드.*저장 확인 실패/s);
  assert.match(editor, /검색어 필수 키워드.*저장 확인 실패/s);

  assert.match(route, /requiredTitleKeywords: requiredKeywords\.titleKeywords/);
  assert.match(route, /requiredSearchKeywords: requiredKeywords\.searchKeywords/);
  assert.match(worker, /buildSeoRequiredExpansionSeeds\(\s*input\.requiredTitleKeywords,\s*seedRows\(candidates\)/s);
  assert.doesNotMatch(worker, /buildSeoRequiredExpansionSeeds\(\s*input\.requiredSearchKeywords/s);
  assert.match(finalComposer, /requiredTitleKeywords: requiredKeywords\.titleKeywords/);
  assert.match(finalComposer, /prioritizeSeoRequiredSearchKeywords/);
  assert.match(finalComposer, /상품명 필수 키워드가 누락되었습니다/);
  assert.match(finalComposer, /검색어 필수 키워드가 누락되었습니다/);
});
