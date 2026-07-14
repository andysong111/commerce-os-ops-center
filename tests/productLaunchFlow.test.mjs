import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const FLOW = "src/components/product-launch-flow/ProductLaunchFlow.tsx";
const LIB = "src/lib/productLaunchFlow.ts";

test("ProductLaunchFlow source exposes the manual-candidate operator flow copy", async () => {
  const source = await readFile(FLOW, "utf8");
  [
    "행별 상품명/검색어 후보 입력",
    "상품명 후보 입력",
    "검색어 후보 입력",
    "입력한 후보만 재료로 사용해 쇼핑몰별 상품명을 다르게 만듭니다.",
    "쇼핑몰별 상품명 미리보기",
    "최종 반영 전 검토",
    "승인하고 실제 반영 실행",
    "개발자 진단 보기",
    "검색어는 상품별 1세트로 반영됩니다.",
  ].forEach((copy) => assert.match(source, new RegExp(copy)));
});

test("ProductLaunchFlow default source does not expose keyword-engine operator review copy", async () => {
  const source = await readFile(FLOW, "utf8");
  [
    "키워드 결과 파일이 준비되었습니다",
    "키워드 검토 시작",
    "상품명 후보 선택",
    "속성 꾸밈어 추가",
    "누락 상품명 자동 보강",
    "확장 적용 계획 생성",
    "상품그룹별 상품명 미리보기",
    "샵플링 반영 미리보기 생성",
    "직접 파일 넣기",
    "dry_run 실행",
    "실제 샵플링 반영 실행",
  ].forEach((copy) => assert.doesNotMatch(source, new RegExp(copy)));
});

test("manual candidate helpers and session state are present", async () => {
  const flow = await readFile(FLOW, "utf8");
  const lib = await readFile(LIB, "utf8");
  assert.match(flow, /manualTitleCandidatesBySourceRow/);
  assert.match(flow, /manualSearchCandidatesBySourceRow/);
  assert.match(flow, /productLaunchFlow\.manualCandidatesBySourceRow/);
  assert.match(flow, /ProductLaunchSessionV2 = .*manualTitleCandidatesBySourceRow/s);
  assert.match(lib, /parseManualCandidateList/);
  assert.match(lib, /normalizeSearchKeywords/);
  assert.match(lib, /generateMallTitlesFromManualCandidates/);
  assert.match(lib, /buildManualCandidatePreview/);
});
