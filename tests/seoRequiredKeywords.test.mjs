import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { composeFreshKeywordElonMallTitles } from "../src/lib/keywordEngineElonFreshMallTitleComposerV11.ts";
import { PRODUCT_GROUP_MARKET_REGISTRY } from "../src/lib/productGroupMarketRegistry.ts";
import { applyProductLaunchTrackerMutation } from "../src/lib/productLaunchTrackerOptimized.ts";
import {
  buildSeoRequiredExpansionSeeds,
  missingSeoRequiredTitleKeywords,
  normalizeSeoRequiredKeywords,
  prioritizeSeoRequiredSearchKeywords,
  seoTitleIncludesRequiredKeyword,
} from "../src/lib/seoRequiredKeywords.ts";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("AAA450 상품상세 저장은 제목 공백과 쉼표 양옆 공백을 제거하고 검색어 내부 공백을 보존한다", () => {
  const result = applyProductLaunchTrackerMutation(
    {
      schemaVersion: 3,
      items: [{
        id: "launch-required-keywords",
        modelNumber: "AAA450",
        productName: "MBTI 키보드키링 일자형",
        orderOptions: [],
      }],
    },
    {
      operation: "patch_item",
      itemId: "launch-required-keywords",
      patch: {
        requiredTitleKeywords: " , 키보드키링 , 클릭커, mbti 키보드 키링 , ",
        requiredSearchKeywords: " , 클릭커 , MBTI 키보드 키링 , 클릭커 , ",
      },
    },
  );
  const item = result.state.items[0];
  assert.equal(Buffer.byteLength(item.requiredTitleKeywords.join(" ")), 45);
  assert.deepEqual(item.requiredTitleKeywords, ["키보드키링", "클릭커", "mbti키보드키링"]);
  assert.deepEqual(item.requiredSearchKeywords, ["클릭커", "MBTI 키보드 키링"]);
});

test("상품명 필수 키워드만 확장 seed 앞자리에 고정하고 자동 seed로 나머지를 채운다", () => {
  const seeds = buildSeoRequiredExpansionSeeds(
    ["무선 게임패드", "블루투스컨트롤러"],
    ["게임패드", "조이스틱", "PC게임패드"],
  );
  assert.deepEqual(seeds.slice(0, 2), ["무선게임패드", "블루투스컨트롤러"]);
  assert.ok(seeds.includes("게임패드"));
  assert.ok(!seeds.includes("검색어전용키워드"));
});

test("전각 쉼표와 줄바꿈으로 붙여 넣어도 키워드를 섞지 않는다", () => {
  assert.deepEqual(normalizeSeoRequiredKeywords({
    titleKeywords: " 키보드 키링 ，\n 클리커 ",
    searchKeywords: " MBTI 키보드 키링 ，\n 게이밍 키링 ",
  }), {
    titleKeywords: ["키보드키링", "클리커"],
    searchKeywords: ["MBTI 키보드 키링", "게이밍 키링"],
  });
});

test("검색어 필수 키워드는 최종 10칸에서 우선 보존되고 중복은 한 칸만 사용한다", () => {
  const keywords = prioritizeSeoRequiredSearchKeywords(
    " PC 게임패드 , 조이스틱 ",
    ["PC게임패드", "조이스틱", "게임패드", "컨트롤러", "패드", "게임용품", "PC게임", "모바일게임", "무선패드", "블루투스패드", "스마트폰패드"],
  );
  assert.equal(keywords.length, 10);
  assert.deepEqual(keywords.slice(0, 2), ["PC 게임패드", "조이스틱"]);
  assert.ok(!keywords.includes("PC게임패드"));
  assert.equal(keywords.filter((keyword) => keyword === "조이스틱").length, 1);
});

test("AAA450의 43바이트를 넘는 필수 키워드 세 개를 29개 상품명에 나눠 쓰고 발굴 키워드를 활용한다", () => {
  const requiredTitleKeywords = ["MBTI키보드키링", "키보드키링", "클리커"];
  const discovered = ["키캡키링", "가방고리", "키보드스위치", "열쇠고리", "미니키링", "일자형"];
  const result = composeFreshKeywordElonMallTitles({
    markets: PRODUCT_GROUP_MARKET_REGISTRY,
    finalKeywords: discovered,
    requiredTitleKeywords,
    modelName: "MBTI 키보드키링 일자형",
    context: {
      modelNumber: "AAA450",
      productName: "MBTI 키보드키링 일자형",
      category: "문구/취미/펫>문구/사무용품>문구용품>열쇠고리/키홀더",
    },
  });

  assert.equal(result.rows.length, 29);
  assert.equal(result.uniqueTitleCount, 29);
  for (const row of result.rows) {
    assert.ok(Buffer.byteLength(row.title, "utf8") >= 30 && Buffer.byteLength(row.title, "utf8") <= 50, row.title);
  }
  for (const keyword of requiredTitleKeywords) {
    const rows = result.rows.filter((row) => row.keywordMaterials.includes(keyword));
    assert.ok(rows.length > 1 && rows.length < 29, `${keyword}: ${rows.length}/29`);
    assert.ok(rows.every((row) => seoTitleIncludesRequiredKeyword(row.title, keyword)));
  }
  assert.ok(result.rows.some((row) =>
    row.keywordMaterials.some((keyword) => requiredTitleKeywords.includes(keyword)) &&
    row.keywordMaterials.some((keyword) => discovered.includes(keyword)),
  ));
});

test("제목 필수 키워드 두 개를 각각 대부분의 마켓에 쓰면서 발굴 키워드도 반영한다", () => {
  const requiredTitleKeywords = ["키보드키링", "클리커"];
  const discovered = ["키캡키링", "가방고리", "키보드스위치", "열쇠고리", "미니키링", "일자형"];
  const result = composeFreshKeywordElonMallTitles({
    markets: PRODUCT_GROUP_MARKET_REGISTRY,
    finalKeywords: ["키보드 키링", ...discovered],
    requiredTitleKeywords,
    modelName: "MBTI 키보드키링 일자형",
    context: { modelNumber: "AAA450", productName: "MBTI 키보드키링 일자형" },
  });
  assert.equal(result.uniqueTitleCount, 29);
  for (const keyword of requiredTitleKeywords) {
    const count = result.rows.filter((row) => row.keywordMaterials.includes(keyword)).length;
    assert.ok(count >= 22, `${keyword}: ${count}/29`);
  }
  assert.ok(result.rows.some((row) => row.keywordMaterials.some((keyword) => discovered.includes(keyword))));
  assert.ok(result.rows.every((row) => row.byteLength >= 30 && row.byteLength <= 50));
});

test("V11 희소 후보 복구는 몰마다 필수 키워드 일부를 배정하고 전체에서 모두 보존한다", () => {
  const requiredTitleKeywords = ["스트라이프버킷햇", "벙거지모자용품"];
  const markets = PRODUCT_GROUP_MARKET_REGISTRY.map((market, index) => ({
    ...market,
    mallKey: `fixture-${index}`,
  }));
  const result = composeFreshKeywordElonMallTitles({
    markets,
    finalKeywords: ["여름패션"],
    requiredTitleKeywords,
    modelName: "여름휴가코디",
    context: { productName: "스트라이프버킷햇" },
  });
  assert.equal(result.rows.length, markets.length);
  assert.ok(result.warnings.some((warning) => warning.startsWith("SEO_RUN_V11_SAME_MALL_UNIQUENESS_FALLBACK:")));
  assert.deepEqual(missingSeoRequiredTitleKeywords(requiredTitleKeywords, result.rows), []);
  for (const keyword of requiredTitleKeywords) {
    assert.ok(result.rows.filter((row) => row.keywordMaterials.includes(keyword)).length >= 15);
  }
  assert.ok(result.rows.some((row) => row.keywordMaterials.includes("여름패션")));
});

test("상품명 필수 키워드가 한 개면 29개 상품명 모두에 포함한다", () => {
  const requiredTitleKeywords = ["클리커"];
  const result = composeFreshKeywordElonMallTitles({
    markets: PRODUCT_GROUP_MARKET_REGISTRY,
    finalKeywords: ["키캡키링", "가방고리", "키보드스위치", "열쇠고리", "미니키링", "일자형"],
    requiredTitleKeywords,
    modelName: "MBTI 키보드키링 일자형",
    context: { modelNumber: "AAA450", productName: "MBTI 키보드키링 일자형" },
  });
  assert.equal(result.rows.length, 29);
  for (const row of result.rows) {
    assert.ok(row.keywordMaterials.includes("클리커"), row.title);
  }
  assert.deepEqual(
    missingSeoRequiredTitleKeywords(requiredTitleKeywords, [...result.rows, { title: "가방고리", keywordMaterials: ["가방고리"] }]),
    requiredTitleKeywords,
  );
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
    () => normalizeSeoRequiredKeywords({ titleKeywords: "가나다라마바사아자차카" }),
    /30bytes를 초과/,
  );
});

test("전체 상품명 검증은 긴 문구에 묻어 있는 키워드나 재료에만 적힌 키워드를 사용으로 세지 않는다", () => {
  assert.deepEqual(
    missingSeoRequiredTitleKeywords(
      ["MBTI 키보드 키링", "키보드키링", "클리커"],
      [
        { title: "MBTI 키보드 키링 미니 열쇠고리", keywordMaterials: ["MBTI 키보드 키링", "미니", "열쇠고리"] },
        { title: "가방고리 미니 키링", keywordMaterials: ["가방고리", "미니 키링", "클리커"] },
      ],
    ),
    ["키보드키링", "클리커"],
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
  assert.match(finalComposer, /missingSeoRequiredTitleKeywords\(requiredKeywords\.titleKeywords, mallTitles\)/);
  assert.match(finalComposer, /검색어 필수 키워드가 누락되었습니다/);
});
