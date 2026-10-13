import assert from "node:assert/strict";
import test from "node:test";

import { composeKeywordElonSafeMallTitles } from "../src/lib/keywordEngineElonMallTitleSafeComposer.ts";
import { PRODUCT_GROUP_MARKET_REGISTRY } from "../src/lib/productGroupMarketRegistry.ts";
import {
  keywordElonSeoCanonical,
  keywordElonSeoUtf8Bytes,
} from "../src/lib/keywordEngineElonLabSeoOutput.ts";

const aaa491Keywords = [
  "발바닥지압판",
  "발지압판",
  "발바닥",
  "지압발판",
  "발바닥마사지기",
  "발지압",
  "발마사지기",
  "발바닥안마기",
  "지압",
  "발판",
];

function assertStrictFinalOnly(result, keywords, blockedPattern) {
  assert.equal(result.rows.length, 29);
  assert.equal(result.keywordCoverageCount, keywords.length);
  assert.equal(result.keywordCoverageTotal, keywords.length);
  assert.equal(result.uniqueTitleCount, 29);
  assert.equal(result.facts.length, 0);
  assert.ok(
    result.warnings.includes(
      "SEO_MALL_TITLE_SOURCE:LONG_TITLE_PRIORITY_V6_FINAL_FALLBACK",
    ),
  );
  const allowed = new Set(keywords.map(keywordElonSeoCanonical));
  for (const keyword of keywords) {
    const key = keywordElonSeoCanonical(keyword);
    assert.ok(
      result.rows.some((row) =>
        row.keywordMaterials.some(
          (material) => keywordElonSeoCanonical(material) === key,
        ),
      ),
      `missing keyword coverage: ${keyword}`,
    );
  }

  let recommendedLengthCount = 0;
  let totalBytes = 0;
  for (const row of result.rows) {
    const bytes = keywordElonSeoUtf8Bytes(row.title);
    totalBytes += bytes;
    if (bytes >= 40) recommendedLengthCount += 1;
    assert.ok(bytes >= 30, `${bytes}B ${row.title}`);
    assert.ok(bytes <= 50, `${bytes}B ${row.title}`);
    assert.ok(row.keywordMaterials.length >= 2, row.title);
    assert.equal(
      row.keywordMaterials.every((material) =>
        allowed.has(keywordElonSeoCanonical(material)),
      ),
      true,
    );
    assert.equal(row.strategyLabel, "long-title-priority-v6-final-fallback");
    assert.doesNotMatch(row.title, blockedPattern);
  }
  assert.ok(
    recommendedLengthCount >= 20,
    `recommendedLengthCount=${recommendedLengthCount}`,
  );
  assert.ok(totalBytes / result.rows.length >= 40, `average=${totalBytes / result.rows.length}`);
}

test("AAA491형 FINAL 10개는 그대로 두고 30~50B 중 긴 상품명을 우선한다", () => {
  const result = composeKeywordElonSafeMallTitles({
    markets: PRODUCT_GROUP_MARKET_REGISTRY,
    finalKeywords: aaa491Keywords,
    modelName: "발바닥 지압스텝퍼",
    context: {
      modelNumber: "AAA491",
      productName: "발바닥 지압스텝퍼 색상랜덤",
      category: "생활/건강>안마용품>다리/발안마기",
      optionText: "색상랜덤 발송 / BAF6-2 / 000000000730",
      detailHtml:
        '<img src="https://ai-saurus.com/assets/윤지선작업/통합/발바닥지압스텝퍼.jpg" alt="공지 하단공지" />',
      mainImageUrl: "https://ai-saurus.com/assets/예지/발바닥지압스텝퍼-main.jpg",
    },
  });

  assertStrictFinalOnly(
    result,
    aaa491Keywords,
    /AAA491|BAF6-2|000000000730|윤지선작업|통합|예지|공지|하단공지|색상랜덤|발송|안마용품/i,
  );
});

test("AAA446형 FINAL 10개도 외부 재료 없이 긴 상품명 우선 fallback 29개를 만든다", () => {
  const keywords = [
    "미니노트",
    "a7",
    "미니수첩",
    "포켓수첩",
    "가죽",
    "가죽다이어리",
    "가죽수첩",
    "노트",
    "메모수첩",
    "포켓다이어리",
  ];
  const result = composeKeywordElonSafeMallTitles({
    markets: PRODUCT_GROUP_MARKET_REGISTRY,
    finalKeywords: keywords,
    modelName: "포켓 수첩",
    context: {
      modelNumber: "AAA446",
      productName: "볼펜꽂이 미니 가죽노트",
      category: "문구/사무용품>노트/수첩>미니수첩",
      optionText: "A7 / 펜홀더 / 슬리브 포함 / BCD2-1 / 000000000123",
      detailHtml: '<img src="https://example.com/윤지선작업/통합/공지.jpg" />',
      mainImageUrl: "https://example.com/예지/하단공지.jpg",
    },
  });

  assertStrictFinalOnly(
    result,
    keywords,
    /AAA446|BCD2-1|000000000123|윤지선작업|통합|예지|공지|하단공지|슬리브|볼펜꽂이|사무용품/i,
  );
});

test("코드형 최종키워드는 쇼핑몰별 상품명에 조용히 섞지 않고 차단한다", () => {
  assert.throws(
    () =>
      composeKeywordElonSafeMallTitles({
        markets: PRODUCT_GROUP_MARKET_REGISTRY,
        finalKeywords: ["발지압판", "BAF6-2", "발마사지기"],
        modelName: "발바닥 지압스텝퍼",
        context: {
          modelNumber: "AAA491",
          productName: "발바닥 지압스텝퍼",
        },
      }),
    /부적합 최종키워드/,
  );
});

test("짧은 키워드는 실제 Shopling 카테고리 꼬리말로만 30바이트를 채운다", () => {
  const result = composeKeywordElonSafeMallTitles({
    markets: [PRODUCT_GROUP_MARKET_REGISTRY[0]],
    finalKeywords: ["버드스파이크"],
    modelName: "버드스파이크 A",
    context: {
      modelNumber: "AAA106",
      productName: "버드스파이크 A",
      category: "문구/취미/펫>조류용품>기타 조류용품",
      optionText: "단품",
    },
  });

  assert.equal(result.rows.length, 1);
  assert.ok(keywordElonSeoUtf8Bytes(result.rows[0].title) >= 30);
  assert.ok(keywordElonSeoUtf8Bytes(result.rows[0].title) <= 50);
  assert.match(result.rows[0].title, /버드스파이크/);
  assert.match(result.rows[0].title, /조류용품/);
  assert.deepEqual(result.facts, []);
  assert.ok(
    result.warnings.includes("SEO_MALL_TITLE_STORED_CATEGORY_FALLBACK:1"),
  );
  assert.doesNotMatch(result.rows[0].title, /AAA106|단품|기타/);
});
