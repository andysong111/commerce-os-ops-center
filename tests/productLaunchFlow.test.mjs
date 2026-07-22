import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { buildLaunchSourceRowGroups } from "../src/lib/productLaunchFlow.ts";
import { normalizeManualSearchKeywords, parseManualCandidates, rotateMallTitleCandidates } from "../src/components/product-launch-flow/ProductLaunchFlow.tsx";

test("manual ProductLaunchFlow source contains required SaaS wizard copy", async () => {
  const source = await readFile("src/components/product-launch-flow/ProductLaunchFlow.tsx", "utf8");
  for (const text of [
    "상품출시 진행상태",
    "행번호 입력",
    "행별 상품명/검색어 후보 입력",
    "상품명 후보 입력",
    "검색어 후보 입력",
    "입력한 후보만 사용해 쇼핑몰별 상품명을 다르게 만듭니다.",
    "대표 미리보기",
    "전체 항목 펼쳐보기",
    "최종 반영 전 검토",
    "승인하고 실제 반영 실행",
    "개발자 진단 보기",
    "검색어는 상품별 1세트로 반영됩니다.",
  ]) assert.ok(source.includes(text), text);
});

test("manual ProductLaunchFlow source excludes old default engine console copy", async () => {
  const source = await readFile("src/components/product-launch-flow/ProductLaunchFlow.tsx", "utf8");
  for (const text of [
    "AI가 상품명 반영 준비",
    "AI 상품출시 에이전트",
    "키워드 입력 후 AI 검토 생성",
    "키워드 검토 시작",
    "상품그룹별 상품명 미리보기",
    "확장 적용 계획 생성",
    "샵플링 반영 미리보기 생성",
    "dry_run 실행",
    "실제 샵플링 반영 실행",
    "직접 파일 넣기",
    "상품그룹별 정책 안내",
    "상품그룹별 상품명 차별화",
    "속성 꾸밈어 추가",
    "누락 상품명 자동 보강",
    "키워드 결과를 불러왔습니다",
    "키워드 결과 파일이 준비되었습니다",
    "개별 키워드 검토 화면에서 열기",
    "product gather fallback",
  ]) assert.ok(!source.includes(text), text);
});

test("one source row with six goods_keys renders one candidate input set", () => {
  const rows = Array.from({ length: 6 }, (_, index) => ({ row: 950, goods_key: `GK${index + 1}`, ptn_goods_cd: `P-1${String.fromCharCode(97 + index)}`, product_name: `상품 ${index + 1}` }));
  const groups = buildLaunchSourceRowGroups(rows, "950");
  assert.equal(groups.length, 1);
  assert.equal(groups[0].sourceRowId, "950");
  assert.equal(groups[0].goodsKeys.length, 6);
});

test("manual candidates rotate mall titles and normalize search keywords", () => {
  const candidates = parseManualCandidates("게임패드,컨트롤러,조이스틱,미니");
  assert.equal(rotateMallTitleCandidates(candidates, 0), "게임패드 컨트롤러 조이스틱 미니");
  assert.equal(rotateMallTitleCandidates(candidates, 1), "컨트롤러 조이스틱 미니 게임패드");
  assert.equal(rotateMallTitleCandidates(candidates, 2), "조이스틱 미니 게임패드 컨트롤러");
  assert.equal(normalizeManualSearchKeywords("게임패드, 컨트롤러,조이스틱,미니,게임장비,보조기기,게임패드,케이블,거치대,충전,무선", ""), "게임패드,컨트롤러,조이스틱,미니,게임장비,보조기기,케이블,거치대,충전,무선");
});

test("approval safety and guarded external runner contract are present", async () => {
  const source = await readFile("src/components/product-launch-flow/ProductLaunchFlow.tsx", "utf8");
  assert.match(source, /const canApprove = allRowsReady && validationSuccess && blockedCount === 0 && !busy/);
  assert.match(source, /previewItems\.length > MAX_APPLY_ITEMS/);
  assert.match(source, /max_items: Math\.min\(MAX_APPLY_ITEMS, previewItems\.length\)/);
  assert.match(source, /APPLY_KEYWORD_RESULTS_TO_SHOPLING/);
  assert.match(source, /\/api\/keyword-shopling-apply\/run/);
  assert.match(source, /if \(isSuccessfulApplyResult\(applied\)\)/);
});

test("safety source contains no forbidden direct execution primitives or secrets", async () => {
  const source = await readFile("src/components/product-launch-flow/ProductLaunchFlow.tsx", "utf8");
  for (const pattern of [/API_AUTH_KEY/, /LOGIN_PASSWORD/, /shell:\s*true/, /child_process/, /PowerShell/i]) {
    assert.doesNotMatch(source, pattern);
  }
});
