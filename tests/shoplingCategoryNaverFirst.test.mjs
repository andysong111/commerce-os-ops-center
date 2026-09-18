import assert from "node:assert/strict";
import test from "node:test";

import {
  matchNaverCategoryPathsToShopling,
  scoreNaverToShoplingCategory,
} from "../src/lib/shoplingCategoryNaverFirst.ts";

test("네이버 쇼핑 카테고리와 가장 유사한 샵플링 저장 경로를 우선한다", () => {
  const categories = [
    { path: "생활/건강 > 욕실용품 > 샤워기" },
    { path: "생활/건강 > 욕실용품 > 변기솔" },
    { path: "자동차용품 > 세차용품 > 세차브러시" },
  ];

  const matches = matchNaverCategoryPathsToShopling(
    ["생활/건강 > 욕실용품 > 샤워기"],
    categories,
  );

  assert.equal(matches[0]?.path, "생활/건강 > 욕실용품 > 샤워기");
  assert.ok((matches[0]?.score ?? 0) >= 90);
});

test("브러쉬/브러시 같은 흔한 표기 차이를 같은 카테고리로 본다", () => {
  const similar = scoreNaverToShoplingCategory(
    "화장품/미용 > 클렌징 > 세안브러쉬",
    "화장품/미용 > 클렌징용품 > 세안브러시",
  );
  const unrelated = scoreNaverToShoplingCategory(
    "화장품/미용 > 클렌징 > 세안브러쉬",
    "자동차용품 > 세차용품 > 세차브러시",
  );

  assert.ok(similar > unrelated);
  assert.ok(similar >= 60);
});

test("상위 분류만 같고 실제 상품 카테고리가 다르면 억지 매칭하지 않는다", () => {
  const matches = matchNaverCategoryPathsToShopling(
    ["생활 > 욕실용품 > 샤워기"],
    [{ path: "생활 > 욕실용품 > 변기솔" }],
  );

  assert.deepEqual(matches, []);
});


test("네이버 카테고리와 leaf가 약하게만 겹치는 후보는 제시하지 않는다", () => {
  const matches = matchNaverCategoryPathsToShopling(
    ["생활/건강 > 욕실용품 > 세안브러시"],
    [
      { path: "스포츠/레저 > 자동차용품 > 세차용품 > 세차브러시" },
      { path: "화장품/미용 > 클렌징용품 > 세안브러시" },
    ],
  );

  assert.equal(matches[0]?.path, "화장품/미용 > 클렌징용품 > 세안브러시");
  assert.ok(matches.every((entry) => !entry.path.includes("세차브러시")));
});


test("여러 네이버 카테고리가 나오면 네이버 순서대로 각각 가장 가까운 샵플링 경로를 후보로 만든다", () => {
  const matches = matchNaverCategoryPathsToShopling(
    [
      "생활/건강 > 욕실용품 > 샤워용품",
      "자동차용품 > 세차용품 > 세차브러시",
    ],
    [
      { path: "생활/건강 > 욕실용품 > 샤워기" },
      { path: "자동차용품 > 세차용품 > 세차브러시" },
      { path: "생활/건강 > 욕실용품 > 변기솔" },
    ],
  );

  assert.equal(matches[0]?.sourcePath, "생활/건강 > 욕실용품 > 샤워용품");
  assert.equal(matches[0]?.path, "생활/건강 > 욕실용품 > 샤워기");
  assert.equal(matches[1]?.sourcePath, "자동차용품 > 세차용품 > 세차브러시");
  assert.equal(matches[1]?.path, "자동차용품 > 세차용품 > 세차브러시");
});

test("네이버 대표 카테고리가 하나면 후보 2·3도 그 카테고리와 가까운 샵플링 경로로만 채운다", () => {
  const source = "화장품/미용 > 클렌징 > 세안브러시";
  const matches = matchNaverCategoryPathsToShopling(
    [source],
    [
      { path: "화장품/미용 > 클렌징용품 > 세안브러시" },
      { path: "화장품/미용 > 클렌징용품 > 클렌징도구" },
      { path: "자동차용품 > 세차용품 > 세차브러시" },
    ],
  );

  assert.equal(matches[0]?.sourcePath, source);
  assert.equal(matches[0]?.path, "화장품/미용 > 클렌징용품 > 세안브러시");
  assert.ok(matches.every((entry) => entry.sourcePath === source));
  assert.ok(matches.every((entry) => !entry.path.includes("세차브러시")));
});
