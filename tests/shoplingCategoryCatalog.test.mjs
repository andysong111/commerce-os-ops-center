import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  calibrateShoplingCategoryConfidence,
  canAutoApplyShoplingCategory,
  inferShoplingCategoryIntent,
  inferShoplingCoreProductTerms,
  normalizeShoplingCategorySearchProfiles,
  parseProductCategoryInputs,
  scoreShoplingCategoryCandidate,
  shortlistShoplingCategories,
} from "../src/lib/shoplingCategoryScoring.ts";
import {
  mergeGroundedShoplingCategoryProfiles,
  runFallbackFirstCategoryGrounding,
} from "../src/lib/shoplingCategoryGrounding.ts";

test("웹 검색이 시간초과돼도 먼저 확보한 기본 의미분석을 반환한다", async () => {
  const fallbackProfiles = [
    {
      itemId: "AAA412",
      coreProductTerms: ["테스트도구"],
      contextTerms: ["생활"],
      ignoredAttributes: [],
      groundingStatus: "model_fallback",
    },
  ];
  const calls = [];
  const profiles = await runFallbackFirstCategoryGrounding({
    totalTimeoutMs: 35_000,
    webSearchEnabled: true,
    requestFallback: async (timeoutMs) => {
      calls.push(["fallback", timeoutMs]);
      return fallbackProfiles;
    },
    requestWeb: async (timeoutMs) => {
      calls.push(["web", timeoutMs]);
      throw new DOMException("This operation was aborted", "AbortError");
    },
    merge: mergeGroundedShoplingCategoryProfiles,
    isFatalWebError: () => false,
    now: () => 1_000,
  });

  assert.deepEqual(calls, [
    ["fallback", 15_000],
    ["web", 18_000],
  ]);
  assert.deepEqual(profiles, fallbackProfiles);
});

test("웹 근거가 성공하면 기본 분석을 버리지 않고 시장 근거와 결합한다", () => {
  const fallbackProfiles = [
    {
      itemId: "AAA490",
      coreProductTerms: ["기본제품명"],
      contextTerms: ["기본용도"],
      catalogCategoryTerms: ["기본분류"],
      blockedCategoryTerms: [],
      marketCategoryPaths: [],
      marketEvidenceSummary: "기본 분석",
      marketEvidenceConfidence: 40,
      sourceDomains: [],
      groundingStatus: "model_fallback",
      ignoredAttributes: ["속성"],
    },
  ];
  const webProfiles = [
    {
      itemId: "AAA490",
      coreProductTerms: ["시장제품명"],
      contextTerms: ["시장용도"],
      catalogCategoryTerms: ["시장분류"],
      blockedCategoryTerms: ["오분류"],
      marketCategoryPaths: ["대분류 > 중분류 > 시장분류"],
      marketEvidenceSummary: "네이버 검색 근거",
      marketEvidenceConfidence: 91,
      sourceDomains: ["search.naver.com"],
      groundingStatus: "web",
      ignoredAttributes: [],
    },
  ];
  const profiles = mergeGroundedShoplingCategoryProfiles(
    fallbackProfiles,
    webProfiles,
  );

  assert.equal(profiles[0].groundingStatus, "web");
  assert.deepEqual(profiles[0].coreProductTerms, ["시장제품명", "기본제품명"]);
  assert.deepEqual(profiles[0].contextTerms, ["시장용도", "기본용도"]);
  assert.deepEqual(profiles[0].sourceDomains, ["search.naver.com"]);
  assert.equal(profiles[0].marketEvidenceConfidence, 91);
});

test("미니짐볼 상품은 핵심명사 짐볼을 찾아 가구·도서보다 헬스 카테고리를 우선한다", () => {
  const categories = [
    {
      depth: 4,
      path: "스포츠/레저>헬스기구>스트레칭용품>짐볼",
      names: ["스포츠/레저", "헬스기구", "스트레칭용품", "짐볼"],
      codes: ["1", "11", "111", "1111"],
    },
    {
      depth: 4,
      path: "가구/인테리어>거실가구>소파>1인용소파",
      names: ["가구/인테리어", "거실가구", "소파", "1인용소파"],
      codes: ["2", "22", "222", "2222"],
    },
    {
      depth: 4,
      path: "도서>건강/취미>운동>요가",
      names: ["도서", "건강/취미", "운동", "요가"],
      codes: ["3", "33", "333", "3333"],
    },
  ];
  const input = {
    itemId: "item-1",
    modelNumber: "AAA492",
    productName: "미니짐볼 300g 색상랜덤",
    optionLabels: ["단품"],
    currentCategory: "",
    chinaProductLinks: [],
  };
  assert.deepEqual(inferShoplingCoreProductTerms(input, categories), ["짐볼"]);
  const shortlist = shortlistShoplingCategories(input, categories, 10);
  assert.equal(shortlist[0].path, categories[0].path);
  assert.ok(
    scoreShoplingCategoryCandidate("미니짐볼", categories[0].path) >
      scoreShoplingCategoryCandidate("미니짐볼", categories[1].path),
  );
});

test("투구골무는 마지막 핵심명사 골무를 우선하고 의류·타이즈 후보를 차단한다", () => {
  const categories = [
    {
      depth: 4,
      path: "의류>언더웨어/잠옷>여성 내의>여성 타이즈",
      names: ["의류", "언더웨어/잠옷", "여성 내의", "여성 타이즈"],
      codes: ["1", "11", "111", "1111"],
    },
    {
      depth: 4,
      path: "생활/건강>수예>재봉용품>골무",
      names: ["생활/건강", "수예", "재봉용품", "골무"],
      codes: ["2", "22", "222", "2222"],
    },
    {
      depth: 4,
      path: "생활/건강>수예>바느질용품>기타수예용품",
      names: ["생활/건강", "수예", "바느질용품", "기타수예용품"],
      codes: ["3", "33", "333", "3333"],
    },
    {
      depth: 4,
      path: "스포츠/레저>축구>보호용품>축구 골키퍼장갑",
      names: ["스포츠/레저", "축구", "보호용품", "축구 골키퍼장갑"],
      codes: ["4", "44", "444", "4444"],
    },
  ];
  const input = {
    itemId: "item-15",
    modelNumber: "AAA015",
    productName: "투구골무",
    optionLabels: ["투구 골무 S사이즈", "투구 골무 M사이즈"],
    currentCategory: "",
    chinaProductLinks: [],
  };
  const intent = inferShoplingCategoryIntent(input);
  assert.equal(intent?.coreTerm, "골무");
  assert.deepEqual(inferShoplingCoreProductTerms(input, categories), ["골무"]);
  const shortlist = shortlistShoplingCategories(input, categories, 10);
  assert.equal(shortlist[0].path, "생활/건강>수예>재봉용품>골무");
  assert.ok(shortlist.every((candidate) => !/타이즈|의류|축구/.test(candidate.path)));
  assert.ok(shortlist.every((candidate) => candidate.intentMatched === true));
});

test("골무 관련 카테고리가 없으면 의류 후보로 되돌아가지 않는다", () => {
  const categories = [
    {
      depth: 4,
      path: "의류>언더웨어/잠옷>여성 내의>여성 타이즈",
      names: ["의류", "언더웨어/잠옷", "여성 내의", "여성 타이즈"],
      codes: ["1", "11", "111", "1111"],
    },
    {
      depth: 4,
      path: "스포츠/레저>축구>보호용품>축구장갑",
      names: ["스포츠/레저", "축구", "보호용품", "축구장갑"],
      codes: ["2", "22", "222", "2222"],
    },
  ];
  const input = {
    itemId: "item-15",
    modelNumber: "AAA015",
    productName: "투구골무",
    optionLabels: [],
    currentCategory: "",
    chinaProductLinks: [],
  };
  assert.deepEqual(shortlistShoplingCategories(input, categories, 10), []);
});

test("모공브러쉬는 색상 블랙이 아니라 브러쉬 제품명사로 후보를 검색한다", () => {
  const categories = [
    {
      depth: 4,
      path: "문구/취미>문구용품>보드/칠판>블랙보드",
      names: ["문구/취미", "문구용품", "보드/칠판", "블랙보드"],
      codes: ["1", "11", "111", "1111"],
    },
    {
      depth: 4,
      path: "자동차>자동차기기>블랙박스>블랙박스액세서리",
      names: ["자동차", "자동차기기", "블랙박스", "블랙박스액세서리"],
      codes: ["2", "22", "222", "2222"],
    },
    {
      depth: 4,
      path: "생활/건강>화장품/미용>클렌징용품>세안브러시",
      names: ["생활/건강", "화장품/미용", "클렌징용품", "세안브러시"],
      codes: ["3", "33", "333", "3333"],
    },
    {
      depth: 4,
      path: "생활/건강>화장품/미용>미용소품>화장용브러시",
      names: ["생활/건강", "화장품/미용", "미용소품", "화장용브러시"],
      codes: ["4", "44", "444", "4444"],
    },
    {
      depth: 4,
      path: "자동차>세차용품>세차도구>세차브러쉬",
      names: ["자동차", "세차용품", "세차도구", "세차브러쉬"],
      codes: ["5", "55", "555", "5555"],
    },
  ];
  const input = {
    itemId: "AAA489",
    modelNumber: "AAA489",
    productName: "걸이형 모공브러쉬 블랙",
    optionLabels: [],
    currentCategory: "",
    chinaProductLinks: [],
  };

  assert.deepEqual(inferShoplingCoreProductTerms(input, categories), ["브러쉬"]);
  const profile = {
    itemId: "AAA489",
    coreProductTerms: [
      "모공브러쉬",
      "모공브러시",
      "세안브러시",
      "클렌징브러시",
      "페이스브러시",
      "화장용브러시",
    ],
    contextTerms: ["세안", "뷰티", "퍼스널케어"],
    ignoredAttributes: ["걸이형", "블랙"],
  };
  const shortlist = shortlistShoplingCategories(input, categories, 18, profile);
  assert.equal(shortlist[0].path, categories[2].path);
  assert.equal(shortlist[1].path, categories[3].path);
  assert.ok(shortlist.some((candidate) => candidate.path === categories[4].path));
  assert.ok(shortlist.every((candidate) => !/블랙보드|블랙박스/.test(candidate.path)));
  assert.ok(shortlist.every((candidate) => candidate.matchKind === "core"));
});

test("의미분석 문구의 앞쪽 taxonomy anchor도 보존해 꿩안경을 조류용품 후보로 복구한다", () => {
  const categories = [
    {
      depth: 3,
      path: "문구/취미/펫>조류용품>기타 조류용품",
      names: ["문구/취미/펫", "조류용품", "기타 조류용품"],
      codes: ["1", "11", "111"],
    },
    {
      depth: 3,
      path: "잡화>패션잡화>안경테>안경테",
      names: ["잡화", "패션잡화", "안경테", "안경테"],
      codes: ["2", "22", "222"],
    },
    {
      depth: 3,
      path: "문구/취미/펫>관상어/수족관>기타 관리용품",
      names: ["문구/취미/펫", "관상어/수족관", "기타 관리용품"],
      codes: ["3", "33", "333"],
    },
  ];
  const input = {
    itemId: "AAA090",
    modelNumber: "AAA090",
    productName: "꿩안경",
    optionLabels: ["중", "대"],
    currentCategory: "",
    chinaProductLinks: [],
  };
  const shortlist = shortlistShoplingCategories(input, categories, 18, {
    itemId: input.itemId,
    coreProductTerms: ["조류 보호안경", "가금류 사육 보호구"],
    contextTerms: ["조류 사육", "꿩 닭 쪼기 방지"],
    catalogCategoryTerms: ["조류 사육용품", "조류용품", "소동물용품"],
    blockedCategoryTerms: ["사람용 안경", "수족관"],
    groundingStatus: "model_fallback",
    ignoredAttributes: ["중", "대"],
  });

  assert.ok(
    shortlist.some(
      (candidate) =>
        candidate.path === "문구/취미/펫>조류용품>기타 조류용품",
    ),
  );
  assert.ok(shortlist.some((candidate) => /조류용품/.test(candidate.path)));
});

test("두피브러시는 브러시 suffix만 보지 않고 두피 taxonomy anchor로 후보를 복구한다", () => {
  const categories = [
    {
      depth: 3,
      path: "생활/건강>건강관리용품>두피관리용품",
      names: ["생활/건강", "건강관리용품", "두피관리용품"],
      codes: ["1", "11", "111"],
    },
    {
      depth: 4,
      path: "뷰티>헤어케어>탈모/두피관리제>두피마사지기",
      names: ["뷰티", "헤어케어", "탈모/두피관리제", "두피마사지기"],
      codes: ["2", "22", "222", "2222"],
    },
    {
      depth: 2,
      path: "뷰티>네일케어>네일케어도구",
      names: ["뷰티", "네일케어", "네일케어도구"],
      codes: ["3", "33", "333"],
    },
  ];
  const input = {
    itemId: "AAA487",
    modelNumber: "AAA487",
    productName: "소프트 실리콘 두피브러쉬",
    optionLabels: [],
    currentCategory: "",
    chinaProductLinks: [],
  };
  const shortlist = shortlistShoplingCategories(input, categories, 18, {
    itemId: input.itemId,
    coreProductTerms: ["두피브러쉬", "샴푸브러쉬"],
    contextTerms: ["두피 세정", "두피 마사지"],
    catalogCategoryTerms: ["두피관리용품", "두피마사지기", "헤어브러시"],
    groundingStatus: "model_fallback",
    ignoredAttributes: ["소프트", "실리콘"],
  });

  assert.ok(shortlist.some((candidate) => /두피관리용품/.test(candidate.path)));
  assert.ok(shortlist.some((candidate) => /두피마사지기/.test(candidate.path)));
  assert.ok(shortlist.every((candidate) => !/네일케어/.test(candidate.path)));
});

test("실뜯개는 도구 suffix보다 수예·재봉 taxonomy anchor를 함께 검색한다", () => {
  const categories = [
    {
      depth: 4,
      path: "가구/인테리어>홈패브릭/수예>수예용품>부자재 기타",
      names: ["가구/인테리어", "홈패브릭/수예", "수예용품", "부자재 기타"],
      codes: ["1", "11", "111", "1111"],
    },
    {
      depth: 4,
      path: "가전/디지털>생활가전>재봉틀>재봉틀용품",
      names: ["가전/디지털", "생활가전", "재봉틀", "재봉틀용품"],
      codes: ["2", "22", "222", "2222"],
    },
    {
      depth: 4,
      path: "가구/인테리어>DIY자재/용품>자재>작업도구",
      names: ["가구/인테리어", "DIY자재/용품", "자재", "작업도구"],
      codes: ["3", "33", "333", "3333"],
    },
  ];
  const input = {
    itemId: "AAA012",
    modelNumber: "AAA012",
    productName: "컬러 실뜯개",
    optionLabels: [],
    currentCategory: "",
    chinaProductLinks: [],
  };
  const shortlist = shortlistShoplingCategories(input, categories, 18, {
    itemId: input.itemId,
    coreProductTerms: ["실뜯개", "재봉 수선도구"],
    contextTerms: ["바느질 수선", "재봉"],
    catalogCategoryTerms: ["수예용품", "수예", "재봉틀용품", "부자재"],
    groundingStatus: "model_fallback",
    ignoredAttributes: ["컬러"],
  });

  assert.ok(shortlist.some((candidate) => /수예용품/.test(candidate.path)));
  assert.ok(shortlist.some((candidate) => /재봉틀용품/.test(candidate.path)));
});

test("웹 시장분류가 있으면 모공브러쉬를 세안·클렌징 후보로 제한하고 헤어·청소·반려동물 분기를 차단한다", () => {
  const categories = [
    {
      depth: 4,
      path: "화장품/미용>스킨케어>클렌징>클렌징소품",
      names: ["화장품/미용", "스킨케어", "클렌징", "클렌징소품"],
      codes: ["1", "11", "111", "1111"],
    },
    {
      depth: 4,
      path: "생활/건강>욕실용품>세안용품>기타세안용품",
      names: ["생활/건강", "욕실용품", "세안용품", "기타세안용품"],
      codes: ["2", "22", "222", "2222"],
    },
    {
      depth: 4,
      path: "화장품/미용>헤어케어>헤어소품>헤어브러시",
      names: ["화장품/미용", "헤어케어", "헤어소품", "헤어브러시"],
      codes: ["3", "33", "333", "3333"],
    },
    {
      depth: 4,
      path: "생활/건강>청소용품>청소기용품>청소기브러시",
      names: ["생활/건강", "청소용품", "청소기용품", "청소기브러시"],
      codes: ["4", "44", "444", "4444"],
    },
    {
      depth: 4,
      path: "생활/건강>반려동물>미용용품>반려동물브러시",
      names: ["생활/건강", "반려동물", "미용용품", "반려동물브러시"],
      codes: ["5", "55", "555", "5555"],
    },
  ];
  const input = {
    itemId: "AAA490",
    modelNumber: "AAA490",
    productName: "걸이형 모공 롱브러쉬 색상랜덤",
    optionLabels: [],
    currentCategory: "",
    chinaProductLinks: [],
  };
  const shortlist = shortlistShoplingCategories(input, categories, 18, {
    itemId: input.itemId,
    coreProductTerms: ["모공브러쉬", "세안브러시", "클렌징브러시"],
    contextTerms: ["얼굴", "세안", "클렌징", "피부관리"],
    catalogCategoryTerms: ["세안용품", "클렌징소품", "미용소품"],
    blockedCategoryTerms: ["헤어", "두피", "청소", "반려동물"],
    marketCategoryPaths: ["화장품/미용 > 스킨케어 > 클렌징 > 클렌징소품"],
    marketEvidenceSummary: "얼굴 모공을 세정할 때 쓰는 클렌징 도구로 분류됩니다.",
    marketEvidenceConfidence: 92,
    groundingStatus: "web",
    ignoredAttributes: ["걸이형", "롱", "색상랜덤"],
  });

  assert.deepEqual(
    new Set(shortlist.map((candidate) => candidate.path)),
    new Set([categories[0].path, categories[1].path]),
  );
  assert.ok(shortlist.every((candidate) => candidate.matchKind === "market"));
  assert.ok(
    shortlist.every((candidate) => !/헤어|청소|반려동물/.test(candidate.path)),
  );
});

test("제품명사 후보가 전부 금지 분기면 세안 문맥 후보로 내려가고 헤어브러시를 억지로 선택하지 않는다", () => {
  const categories = [
    {
      depth: 4,
      path: "화장품/미용>헤어케어>헤어소품>헤어브러시",
      names: ["화장품/미용", "헤어케어", "헤어소품", "헤어브러시"],
      codes: ["1", "11", "111", "1111"],
    },
    {
      depth: 4,
      path: "생활/건강>욕실용품>세안용품>기타세안용품",
      names: ["생활/건강", "욕실용품", "세안용품", "기타세안용품"],
      codes: ["2", "22", "222", "2222"],
    },
  ];
  const input = {
    itemId: "AAA490",
    modelNumber: "AAA490",
    productName: "걸이형 모공 롱브러쉬",
    optionLabels: [],
    currentCategory: "",
    chinaProductLinks: [],
  };
  const shortlist = shortlistShoplingCategories(input, categories, 18, {
    itemId: input.itemId,
    coreProductTerms: ["롱브러시", "브러시"],
    contextTerms: ["세안"],
    blockedCategoryTerms: ["헤어"],
    ignoredAttributes: ["걸이형", "롱"],
  });

  assert.equal(shortlist.length, 1);
  assert.equal(shortlist[0].path, categories[1].path);
  assert.equal(shortlist[0].matchKind, "context");
});

test("곰돌이 털모자는 캐릭터 단어보다 시장 상품군인 방한모자를 우선한다", () => {
  const categories = [
    {
      depth: 4,
      path: "패션의류>패션잡화>모자>방한모자",
      names: ["패션의류", "패션잡화", "모자", "방한모자"],
      codes: ["1", "11", "111", "1111"],
    },
    {
      depth: 4,
      path: "출산/육아>완구>인형>곰인형",
      names: ["출산/육아", "완구", "인형", "곰인형"],
      codes: ["2", "22", "222", "2222"],
    },
    {
      depth: 4,
      path: "생활/건강>반려동물>의류>반려동물모자",
      names: ["생활/건강", "반려동물", "의류", "반려동물모자"],
      codes: ["3", "33", "333", "3333"],
    },
  ];
  const input = {
    itemId: "AAA410",
    modelNumber: "AAA410",
    productName: "곰돌이 털모자 A형",
    optionLabels: [],
    currentCategory: "",
    chinaProductLinks: [],
  };
  const shortlist = shortlistShoplingCategories(input, categories, 18, {
    itemId: input.itemId,
    coreProductTerms: ["털모자", "방한모자", "모자"],
    contextTerms: ["겨울", "방한", "패션잡화"],
    catalogCategoryTerms: ["방한모자", "겨울모자", "모자"],
    blockedCategoryTerms: ["완구", "인형", "반려동물"],
    marketCategoryPaths: ["패션잡화 > 모자 > 방한모자"],
    marketEvidenceSummary: "곰돌이 디자인의 사람용 겨울 방한모자입니다.",
    marketEvidenceConfidence: 88,
    groundingStatus: "web",
    ignoredAttributes: ["곰돌이", "A형"],
  });

  assert.equal(shortlist.length, 1);
  assert.equal(shortlist[0].path, categories[0].path);
  assert.equal(shortlist[0].matchKind, "market");
});

test("재질 단어가 실제 판매 제품이면 AI 핵심명사로 복원한다", () => {
  const categories = [
    {
      depth: 4,
      path: "생활/건강>청소용품>청소도구>스펀지",
      names: ["생활/건강", "청소용품", "청소도구", "스펀지"],
      codes: ["1", "11", "111", "1111"],
    },
    {
      depth: 4,
      path: "생활/건강>주방용품>설거지용품>수세미",
      names: ["생활/건강", "주방용품", "설거지용품", "수세미"],
      codes: ["2", "22", "222", "2222"],
    },
  ];
  const input = {
    itemId: "material-product",
    modelNumber: "AAA000",
    productName: "세척용 스펀지",
    optionLabels: [],
    currentCategory: "",
    chinaProductLinks: [],
  };
  const shortlist = shortlistShoplingCategories(input, categories, 18, {
    itemId: input.itemId,
    coreProductTerms: ["스펀지", "수세미"],
    contextTerms: ["청소", "설거지"],
    ignoredAttributes: ["세척용"],
  });

  assert.deepEqual(
    new Set(shortlist.map((candidate) => candidate.path)),
    new Set(categories.map((category) => category.path)),
  );
  assert.ok(shortlist.every((candidate) => candidate.matchKind === "core"));
});

test("독립 색상어는 제외하지만 블랙보드·블랙박스 합성 제품명은 보존한다", () => {
  const categories = [
    {
      depth: 3,
      path: "가구/인테리어>거실가구>사이드테이블",
      names: ["가구/인테리어", "거실가구", "사이드테이블"],
      codes: ["1", "11", "111"],
    },
    {
      depth: 3,
      path: "문구/취미>보드/칠판>블랙보드",
      names: ["문구/취미", "보드/칠판", "블랙보드"],
      codes: ["2", "22", "222"],
    },
    {
      depth: 3,
      path: "자동차>자동차기기>블랙박스",
      names: ["자동차", "자동차기기", "블랙박스"],
      codes: ["3", "33", "333"],
    },
  ];
  const base = {
    itemId: "item",
    modelNumber: "AAA",
    optionLabels: [],
    currentCategory: "",
    chinaProductLinks: [],
  };

  assert.deepEqual(
    inferShoplingCoreProductTerms(
      { ...base, productName: "사이드 테이블 블랙" },
      categories,
    ),
    ["테이블"],
  );
  assert.deepEqual(
    inferShoplingCoreProductTerms(
      { ...base, productName: "블랙보드" },
      categories,
    ),
    ["블랙보드"],
  );
  assert.deepEqual(
    inferShoplingCoreProductTerms(
      { ...base, productName: "블랙박스" },
      categories,
    ),
    ["블랙박스"],
  );
});

test("현재 모델명에 붙어 있는 A형·B형과 용량은 제거하고 제품명사를 유지한다", () => {
  const categories = [
    {
      depth: 4,
      path: "생활/건강>농축산용품>급수용품>닭물통",
      names: ["생활/건강", "농축산용품", "급수용품", "닭물통"],
      codes: ["1", "11", "111", "1111"],
    },
    {
      depth: 4,
      path: "생활/건강>생활용품>생활잡화>돼지코스토퍼",
      names: ["생활/건강", "생활용품", "생활잡화", "돼지코스토퍼"],
      codes: ["2", "22", "222", "2222"],
    },
  ];
  const base = {
    itemId: "item",
    modelNumber: "AAA",
    optionLabels: [],
    currentCategory: "",
    chinaProductLinks: [],
  };

  assert.deepEqual(
    inferShoplingCoreProductTerms(
      { ...base, productName: "닭물통A형 520ml" },
      categories,
    ),
    ["닭물통"],
  );
  assert.deepEqual(
    inferShoplingCoreProductTerms(
      { ...base, productName: "돼지코스토퍼B형" },
      categories,
    ),
    ["돼지코스토퍼"],
  );
});

test("정확한 제품명사 카테고리가 없으면 AI 용도 문맥으로만 후보를 만들고 자동적용 근거를 낮춘다", () => {
  const categories = [
    {
      depth: 4,
      path: "생활/건강>주방용품>조리도구>기타조리도구",
      names: ["생활/건강", "주방용품", "조리도구", "기타조리도구"],
      codes: ["1", "11", "111", "1111"],
    },
    {
      depth: 4,
      path: "문구/취미>공예용품>펀칭용품>종이펀치",
      names: ["문구/취미", "공예용품", "펀칭용품", "종이펀치"],
      codes: ["2", "22", "222", "2222"],
    },
  ];
  const input = {
    itemId: "AAA316",
    modelNumber: "AAA316",
    productName: "계란펀칭기",
    optionLabels: [],
    currentCategory: "",
    chinaProductLinks: [],
  };
  const shortlist = shortlistShoplingCategories(input, categories, 18, {
    itemId: input.itemId,
    coreProductTerms: ["계란펀칭기", "계란구멍뚫기"],
    contextTerms: ["주방", "조리", "계란"],
    ignoredAttributes: [],
  });

  assert.equal(shortlist[0].path, categories[0].path);
  assert.ok(shortlist.every((candidate) => candidate.matchKind === "context"));
  assert.ok(shortlist.every((candidate) => !/종이펀치/.test(candidate.path)));
  assert.equal(
    canAutoApplyShoplingCategory({
      confidence: 99,
      currentCategory: "",
      matchKind: "context",
    }),
    false,
  );
  assert.equal(
    canAutoApplyShoplingCategory({
      confidence: 95,
      currentCategory: "",
      matchKind: "core",
    }),
    true,
  );
  assert.equal(
    calibrateShoplingCategoryConfidence({
      confidence: 99,
      matchKind: "context",
      profile: { groundingStatus: "web" },
    }),
    64,
  );
  assert.equal(
    calibrateShoplingCategoryConfidence({
      confidence: 94,
      matchKind: "market",
      profile: {
        groundingStatus: "web",
        marketEvidenceConfidence: 72,
      },
    }),
    72,
  );
  assert.equal(
    calibrateShoplingCategoryConfidence({
      confidence: 95,
      matchKind: "core",
      profile: { groundingStatus: "model_fallback" },
    }),
    79,
  );
});

test("AI 카테고리 입력은 상품 ID·모델명과 최대 처리 수를 검증한다", () => {
  assert.deepEqual(
    parseProductCategoryInputs({
      items: [
        {
          itemId: "item-1",
          modelNumber: "AAA492",
          productName: "미니짐볼",
          optionLabels: ["핑크", "블루"],
          currentCategory: "",
          chinaProductLinks: ["https://detail.1688.com/offer/1.html"],
        },
      ],
    }),
    [
      {
        itemId: "item-1",
        modelNumber: "AAA492",
        productName: "미니짐볼",
        optionLabels: ["핑크", "블루"],
        currentCategory: "",
        chinaProductLinks: ["https://detail.1688.com/offer/1.html"],
      },
    ],
  );
  assert.throws(() => parseProductCategoryInputs({ items: [] }), /선택하세요/);
  assert.throws(
    () =>
      parseProductCategoryInputs({
        items: Array.from({ length: 26 }, (_, index) => ({
          itemId: `item-${index}`,
          productName: "상품",
        })),
      }),
    /최대 25개/,
  );
});

test("세안브러시는 같은 클렌징 분야라도 폼·젤·크림 같은 소모품 후보를 형태충돌로 제거한다", () => {
  const categories = [
    {
      depth: 2,
      path: "뷰티>클렌징/필링>클렌징폼",
      names: ["뷰티", "클렌징/필링", "클렌징폼"],
      codes: ["1", "11", "111"],
    },
    {
      depth: 2,
      path: "뷰티>클렌징/필링>클렌징젤",
      names: ["뷰티", "클렌징/필링", "클렌징젤"],
      codes: ["2", "22", "222"],
    },
    {
      depth: 2,
      path: "뷰티>클렌징/필링>클렌징크림",
      names: ["뷰티", "클렌징/필링", "클렌징크림"],
      codes: ["3", "33", "333"],
    },
    {
      depth: 2,
      path: "뷰티>뷰티소품>피부관리기",
      names: ["뷰티", "뷰티소품", "피부관리기"],
      codes: ["4", "44", "444"],
    },
    {
      depth: 2,
      path: "생활/건강>구강/세안/면도>면도소품",
      names: ["생활/건강", "구강/세안/면도", "면도소품"],
      codes: ["5", "55", "555"],
    },
  ];
  const input = {
    itemId: "AAA486",
    modelNumber: "AAA486",
    productName: "실리콘 미세세안브러쉬 색상랜덤",
    optionLabels: [],
    currentCategory: "",
    chinaProductLinks: [],
  };
  const shortlist = shortlistShoplingCategories(input, categories, 18, {
    itemId: input.itemId,
    coreProductTerms: ["세안브러쉬", "클렌징브러시", "페이스브러시"],
    contextTerms: ["얼굴", "세안", "클렌징"],
    productClass: "tool",
    formTerms: ["브러시", "세안도구"],
    functionTerms: ["얼굴 세정", "클렌징"],
    targetTerms: ["얼굴", "피부"],
    incompatibleCategoryTerms: [
      "폼",
      "젤",
      "크림",
      "오일",
      "로션",
      "비누",
      "세정제",
    ],
    catalogCategoryTerms: ["뷰티소품", "피부관리기", "클렌징", "세안"],
    groundingStatus: "model_fallback",
    ignoredAttributes: ["실리콘", "색상랜덤"],
  });

  assert.ok(shortlist.some((candidate) => /피부관리기/.test(candidate.path)));
  assert.ok(shortlist.every((candidate) => !/클렌징폼|클렌징젤|클렌징크림/.test(candidate.path)));
});

test("AI 모델명 분석은 제품명사·용도·속성을 분리해 카테고리 검색 프로필을 만든다", async () => {
  const inputs =
    [
      {
        itemId: "AAA489",
        modelNumber: "AAA489",
        productName: "걸이형 모공브러쉬 블랙",
        optionLabels: ["단품"],
        currentCategory: "",
        chinaProductLinks: [],
      },
    ];
  const profiles = normalizeShoplingCategorySearchProfiles(
    [
      {
        itemId: "AAA489",
        coreProductTerms: [
          "모공브러쉬",
          "세안브러쉬",
          "화장용 브러쉬",
          "화장용브러쉬",
        ],
        contextTerms: ["세안", "뷰티", "퍼스널케어"],
        ignoredAttributes: ["걸이형", "블랙", "단품"],
      },
    ],
    inputs,
  );

  assert.deepEqual(profiles, [
    {
      itemId: "AAA489",
      coreProductTerms: ["모공브러쉬", "세안브러쉬", "화장용 브러쉬"],
      contextTerms: ["세안", "뷰티", "퍼스널케어"],
      ignoredAttributes: ["걸이형", "블랙", "단품"],
    },
  ]);
  const groundedProfiles = normalizeShoplingCategorySearchProfiles(
    [
      {
        itemId: "AAA489",
        coreProductTerms: ["모공브러쉬", "세안브러시"],
        contextTerms: ["얼굴", "세안"],
        productClass: "tool",
        formTerms: ["브러시", "세안도구"],
        functionTerms: ["세안", "클렌징"],
        targetTerms: ["얼굴", "피부"],
        incompatibleCategoryTerms: ["폼", "젤", "크림", "오일"],
        catalogCategoryTerms: ["세안용품", "세안용품", "클렌징소품"],
        blockedCategoryTerms: ["용품", "헤어", "청소", "반려동물"],
        marketCategoryPaths: ["화장품/미용 > 스킨케어 > 클렌징"],
        marketEvidenceSummary: "얼굴 세안용 클렌징 도구로 확인됩니다.",
        marketEvidenceConfidence: 91,
        sourceDomains: ["WWW.Search.Naver.com", "not a domain"],
        groundingStatus: "web",
        ignoredAttributes: ["걸이형", "블랙"],
      },
    ],
    inputs,
  );
  assert.equal(groundedProfiles[0].productClass, "tool");
  assert.deepEqual(groundedProfiles[0].formTerms, ["브러시", "세안도구"]);
  assert.deepEqual(groundedProfiles[0].functionTerms, ["세안", "클렌징"]);
  assert.deepEqual(groundedProfiles[0].targetTerms, ["얼굴", "피부"]);
  assert.deepEqual(groundedProfiles[0].incompatibleCategoryTerms, [
    "폼",
    "젤",
    "크림",
    "오일",
  ]);
  assert.deepEqual(groundedProfiles[0].catalogCategoryTerms, [
    "세안용품",
    "클렌징소품",
  ]);
  assert.deepEqual(groundedProfiles[0].blockedCategoryTerms, [
    "헤어",
    "청소",
    "반려동물",
  ]);
  assert.deepEqual(groundedProfiles[0].sourceDomains, ["search.naver.com"]);
  assert.equal(groundedProfiles[0].marketEvidenceConfidence, 91);
  assert.equal(
    canAutoApplyShoplingCategory({
      confidence: 99,
      currentCategory: "",
      matchKind: "market",
    }),
    false,
  );
  const source = await readFile(
    new URL("../src/lib/shoplingCategoryCatalog.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /generateShoplingCategorySearchProfiles/);
  assert.match(source, /상위 분기 명사 2~3개와 세부 제품군 명사 2~4개/);
  assert.match(source, /합성어 안의 색상어/);
  assert.match(source, /브러시\/브러쉬/);
  assert.match(source, /걸이형 모공브러쉬 블랙/);
  assert.match(source, /type: "web_search"/);
  assert.match(source, /네이버 쇼핑·스마트스토어/);
  assert.match(source, /blockedCategoryTerms/);
  assert.match(source, /productClass/);
  assert.match(source, /incompatibleCategoryTerms/);
  assert.match(source, /물체 종류가 다르면 선택하지 않는다/);
  assert.match(source, /model_fallback/);
});

test("진행관리 UI는 카테고리 최신화·AI 후보 생성·수동 로그인 상태를 포함한다", async () => {
  const source = await readFile(
    new URL(
      "../public/product-launch-tracker-app/category-ai.js",
      import.meta.url,
    ),
    "utf8",
  );
  const app = await readFile(
    new URL("../public/product-launch-tracker-app/app.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /샵플링 카테고리 최신화/);
  assert.match(source, /선택 AI 카테고리 후보 생성/);
  assert.match(source, /manual_login_required/);
  assert.match(source, /categoryAiSuggestion/);
  assert.match(source, /categoryAiStatus: "review_required"/);
  assert.match(source, /shoplingCategory: item\.shoplingCategory/);
  assert.match(app, /category-ai\.js/);
});
