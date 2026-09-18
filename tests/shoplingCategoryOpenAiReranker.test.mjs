import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildNaverGroundedShoplingCandidatePool,
  sanitizeConstrainedOrderedPaths,
} from "../src/lib/shoplingCategoryOpenAiReranker.ts";

test("네이버 카테고리를 기준으로 샵플링 실제 원장 후보를 최대 8개까지 만든다", () => {
  const pool = buildNaverGroundedShoplingCandidatePool(
    ["화장품/미용 > 클렌징 > 클렌징도구 > 세안브러시"],
    [
      { path: "화장품/미용 > 클렌징용품 > 세안브러시" },
      { path: "화장품/미용 > 클렌징용품 > 클렌징도구" },
      { path: "화장품/미용 > 피부관리 > 페이스브러시" },
      { path: "자동차용품 > 세차용품 > 세차브러시" },
    ],
  );

  assert.ok(pool.length >= 1);
  assert.ok(pool.length <= 8);
  assert.equal(pool[0]?.path, "화장품/미용 > 클렌징용품 > 세안브러시");
  assert.ok(pool.every((candidate) => candidate.path));
  assert.ok(pool.every((candidate) => candidate.sourcePath.includes("세안브러시")));
});

test("OpenAI가 후보 밖 경로를 반환해도 실제 샵플링 후보만 남긴다", () => {
  const pool = [
    {
      path: "생활/건강 > 욕실용품 > 샤워기",
      score: 82,
      sourcePath: "생활/건강 > 욕실용품 > 샤워용품",
    },
    {
      path: "생활/건강 > 욕실용품 > 샤워용품",
      score: 76,
      sourcePath: "생활/건강 > 욕실용품 > 샤워용품",
    },
  ];

  const ordered = sanitizeConstrainedOrderedPaths(
    [
      "AI가 임의 생성한 > 존재하지 않는 > 경로",
      "생활/건강 > 욕실용품 > 샤워용품",
      "생활/건강 > 욕실용품 > 샤워기",
      "생활/건강 > 욕실용품 > 샤워용품",
    ],
    pool,
  );

  assert.deepEqual(ordered, [
    "생활/건강 > 욕실용품 > 샤워용품",
    "생활/건강 > 욕실용품 > 샤워기",
  ]);
});

test("OpenAI 재정렬 프롬프트는 네이버 근거와 제한 후보 외 새 경로 생성을 금지한다", async () => {
  const source = await readFile(
    new URL("../src/lib/shoplingCategoryOpenAiReranker.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /네이버에서 실제 확인한 카테고리 경로가 최우선 근거/);
  assert.match(source, /candidates에 제공된 path 중에서만 선택/);
  assert.match(source, /새로운 카테고리 경로를 만들거나 수정하면 안 된다/);
  assert.match(source, /모델명은 후보가 비슷할 때/);
  assert.match(source, /orderedPaths를 빈 배열/);
  assert.match(source, /allowed\.has\(path\)/);
  assert.match(source, /https:\/\/api\.openai\.com\/v1\/responses/);
});
