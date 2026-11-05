import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { PRODUCT_GROUP_MARKET_REGISTRY } from "../src/lib/productGroupMarketRegistry.ts";
import {
  KEYWORD_ELON_SEO_FORBIDDEN_TERMS,
  KEYWORD_ELON_SEO_NOISE_TERMS,
  KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT,
  keywordElonSeoCanonical,
} from "../src/lib/keywordEngineElonLabSeoOutput.ts";
import {
  buildKeywordElonSeoModelPackage,
  KEYWORD_ELON_SEO_MODEL_GROUP_STRATEGIES,
  KEYWORD_ELON_SEO_MODEL_NAME_BYTE_LIMIT,
} from "../src/lib/keywordEngineElonLabSeoModelOutput.ts";

function candidate(keyword, relevance, qualityScore, totalSearch, overrides = {}) {
  return {
    keyword,
    searchKey: keywordElonSeoCanonical(keyword),
    searchKeyword: keywordElonSeoCanonical(keyword),
    relevance,
    shoppingIntent: 90,
    specificity: 80,
    qualityScore,
    totalSearch,
    ...overrides,
  };
}

function identity() {
  return {
    koreanProductIdentity: "코 보정용 일회용 테이프",
    coreProduct: "코 보정 테이프",
    identityAnchor: "콧볼 콧구멍 보정용 붙이는 테이프",
    primarySeeds: ["코보정테이프", "콧볼축소테이프", "코모양보정패치"],
    conditionalSeeds: ["일회용코패치", "재단가능코테이프", "붙이는코스티커"],
    functionModifiers: ["콧볼 축소", "콧구멍 보정", "모양 유지"],
    designShapeModifiers: ["슬림 스트립형", "스티커형"],
    specAttributes: ["일회용", "재단 가능", "61x11mm", "제조지 중국 광동성", "포장 단위 10개"],
  };
}

const candidates = [
  candidate("콧볼축소", 95, 81.1, 6760, { specificity: 88 }),
  candidate("코보정테이프", 95, 80.5, 6180, { specificity: 92 }),
  candidate("코테이프", 94, 79.4, 5600, { specificity: 85 }),
  candidate("콧구멍보정", 93, 78.2, 4200, { specificity: 90 }),
  candidate("코모양보정", 92, 77.5, 3100, { specificity: 88 }),
  candidate("붙이는테이프", 91, 76.8, 2500, { specificity: 82 }),
  candidate("일회용코패치", 91, 75.9, 1900, { specificity: 86 }),
  candidate("콧대보정", 90, 74.4, 1500, { specificity: 83 }),
  candidate("코스티커", 90, 73.8, 1200, { specificity: 80 }),
  candidate("코교정패치", 90, 72.9, 900, { specificity: 85 }),
  candidate("슬림코테이프", 90, 71.8, 700, { specificity: 86 }),
  candidate("재단코테이프", 90, 70.4, 500, { specificity: 84 }),
  candidate("도매코테이프", 99, 99, 100000),
  candidate("대량납품테이프", 99, 99, 100000),
];

function build(input = {}) {
  return buildKeywordElonSeoModelPackage(
    {
      identity: identity(),
      candidates,
      allowedKeys: candidates.map((row) => row.searchKey),
      blockedKeys: [],
      customBlockedTerms: [],
      ...input,
    },
    PRODUCT_GROUP_MARKET_REGISTRY,
  );
}

function occurrenceCount(value, needle) {
  return needle ? value.split(needle).length - 1 : 0;
}

test("link-derived model name is included exactly once in all 29 mall titles", () => {
  const output = build();
  assert.equal(output.status, "ready");
  assert.equal(output.modelName, "코 보정 테이프");
  assert.equal(output.modelNameSource, "core_product");
  assert.ok(output.modelNameByteLength <= KEYWORD_ELON_SEO_MODEL_NAME_BYTE_LIMIT);
  assert.equal(output.modelNameCoverageCount, 29);
  assert.equal(output.mallTitles.length, 29);
  assert.equal(output.mallTitles.every((row) => row.byteLength <= KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT), true);
  assert.equal(output.commonSearchKeywords.length, 10);
  assert.equal(/\s/.test(output.commonSearchLine), false);

  const searchSet = new Set(output.commonSearchKeywords);
  for (const row of output.mallTitles) {
    assert.equal(occurrenceCount(row.title, output.modelName), 1, row.title);
    assert.equal(row.modelName, output.modelName);
    assert.equal(row.keywordMaterials.every((keyword) => searchSet.has(keyword)), true);
    assert.equal(row.usedMaterials[0], output.modelName);
  }

  for (const forbidden of [...KEYWORD_ELON_SEO_FORBIDDEN_TERMS, ...KEYWORD_ELON_SEO_NOISE_TERMS]) {
    assert.equal(output.mallTitles.some((row) => row.title.includes(forbidden)), false);
  }
});

test("바이칸 상표 키워드는 검색어와 쇼핑몰 상품명에서 공통 차단한다", () => {
  assert.ok(KEYWORD_ELON_SEO_FORBIDDEN_TERMS.includes("바이칸"));

  const trademarkCandidate = candidate("바이칸틈새브러쉬", 100, 100, 100000);
  const rows = [trademarkCandidate, ...candidates];
  const output = build({
    candidates: rows,
    allowedKeys: rows.map((row) => row.searchKey),
  });

  assert.equal(
    output.commonSearchKeywords.some((keyword) => keyword.includes("바이칸")),
    false,
  );
  assert.equal(
    output.mallTitles.some((row) => row.title.includes("바이칸")),
    false,
  );
});

test("generic core product is upgraded with a specific STEP 4 keyword", () => {
  const rows = [
    candidate("콧볼축소", 98, 84, 6800, { specificity: 96 }),
    candidate("콧구멍축소", 95, 80, 3600, { specificity: 92 }),
    candidate("테이프", 93, 77, 5200, { specificity: 62 }),
    candidate("스티커", 91, 75, 2400, { specificity: 58 }),
    candidate("콧대높이기", 93, 79, 3200, { specificity: 90 }),
    candidate("붙이는", 90, 76, 2800, { specificity: 55 }),
    candidate("콧대", 90, 73, 1800, { specificity: 70 }),
    candidate("콧등", 90, 71, 700, { specificity: 68 }),
    candidate("흰색테이프", 90, 72, 900, { specificity: 78 }),
  ];
  const output = build({
    identity: { coreProduct: "테이프", koreanProductIdentity: "", identityAnchor: "" },
    candidates: rows,
    allowedKeys: rows.map((row) => row.searchKey),
  });
  assert.equal(output.modelNameSource, "step4_plus_core");
  assert.notEqual(output.modelName, "테이프");
  assert.ok(output.modelName.includes("콧볼축소"));
  assert.ok(output.modelName.includes("테이프"));
  assert.equal(output.modelNameCoverageCount, 29);
});

test("model noun is not repeated when a final keyword already contains it", () => {
  const rows = [
    candidate("휴대용신발주걱", 97, 84, 8000, { specificity: 96 }),
    candidate("미니신발주걱", 96, 82, 6500, { specificity: 94 }),
    candidate("플라스틱신발주걱", 95, 81, 4200, { specificity: 95 }),
    candidate("신발주걱", 98, 85, 9000, { specificity: 98 }),
    candidate("구두주걱", 94, 79, 5000, { specificity: 90 }),
    candidate("슈혼", 92, 77, 1200, { specificity: 85 }),
    candidate("신발헤라", 92, 76, 900, { specificity: 84 }),
    candidate("구두헤라", 91, 75, 700, { specificity: 82 }),
    candidate("미니구두주걱", 94, 80, 3500, { specificity: 92 }),
    candidate("휴대용구두주걱", 94, 80, 3000, { specificity: 92 }),
  ];
  const output = build({
    identity: { coreProduct: "신발주걱", koreanProductIdentity: "플라스틱 휴대용 신발주걱", identityAnchor: "휴대용 신발주걱" },
    candidates: rows,
    allowedKeys: rows.map((row) => row.searchKey),
  });
  assert.equal(output.modelName, "신발주걱");
  assert.equal(output.modelNameCoverageCount, 29);
  assert.equal(output.mallTitles.some((row) => /신발주걱.*신발주걱/.test(row.title)), false);
  assert.equal(output.mallTitles.some((row) => row.title.includes("휴대용 신발주걱")), true);
});

test("wholesale leads with model name while retail1 leads with demand keyword", () => {
  const ranked = [
    candidate("정확형테이프", 100, 82, 50, { specificity: 100 }),
    candidate("수요형테이프", 90, 82, 100000, { specificity: 75 }),
    candidate("기능형테이프", 96, 80, 1000, { specificity: 95 }),
    candidate("세부형테이프", 95, 79, 700, { specificity: 96 }),
    candidate("사용형테이프", 92, 78, 6000, { specificity: 86 }),
    candidate("형태형스티커", 91, 77, 5000, { specificity: 84 }),
    candidate("정확패치", 95, 76, 400, { specificity: 94 }),
    candidate("수요스티커", 90, 75, 50000, { specificity: 72 }),
    candidate("기능패치", 94, 74, 300, { specificity: 93 }),
    candidate("세부패치", 93, 73, 200, { specificity: 92 }),
  ];
  const output = build({
    identity: { coreProduct: "테이프", koreanProductIdentity: "", identityAnchor: "" },
    candidates: ranked,
    allowedKeys: ranked.map((row) => row.searchKey),
  });
  const wholesale1 = output.mallTitles.find((row) => row.productGroup === "도매1");
  const retail1 = output.mallTitles.find((row) => row.productGroup === "소매1");
  assert.ok(wholesale1?.title.startsWith(output.modelName), wholesale1?.title);
  assert.ok(retail1?.title.startsWith("수요형"), retail1?.title);
  assert.equal(occurrenceCount(retail1?.title ?? "", output.modelName), 1);
});

test("group variant limits and preview-only UI remain enforced", () => {
  const output = build();
  const limits = Object.fromEntries(
    KEYWORD_ELON_SEO_MODEL_GROUP_STRATEGIES.map((strategy) => [strategy.productGroup, strategy.variantLimit]),
  );
  for (const group of Object.keys(limits)) {
    const count = new Set(output.mallTitles.filter((row) => row.productGroup === group).map((row) => row.title)).size;
    assert.ok(count <= limits[group], `${group}: ${count}/${limits[group]}`);
  }

  const component = readFileSync(
    "src/app/keyword-engine-elon-lab/KeywordElonShoplingSeoOutput.tsx",
    "utf8",
  );
  assert.match(component, /링크 기반 모델명/);
  assert.match(component, /29개 제목 필수 포함/);
  assert.match(component, /모델명 필수/);
  assert.match(component, /최대 50bytes/);
  assert.match(component, /콤마 구분/);
  assert.match(component, /아무것도 쓰지 않습니다/);
  assert.doesNotMatch(component, /fetch\s*\(/);
  assert.doesNotMatch(component, /dispatchKeyword|keyword-shopling-direct-apply|shopling-upload/);
});
