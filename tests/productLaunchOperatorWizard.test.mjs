import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { buildKeywordEngineDispatchPayload, buildLaunchSourceRowGroups, expandSeedKeywordsBySourceRowToGoodsKeys } from "../src/lib/productLaunchFlow.ts";

test("operator-first product launch source contains compact wizard copy", async () => {
  const flow = await readFile("src/components/product-launch-flow/ProductLaunchFlow.tsx", "utf8");
  const workspace = await readFile("src/components/keyword-review/KeywordReviewWorkspace.tsx", "utf8");
  const source = `${flow}\n${workspace}`;
  for (const text of [
    "행별 핵심 키워드",
    "실재고 시트 행마다 좋은 키워드를 한 번만 입력하세요.",
    "최종 반영 전 검토",
    "승인하고 샵플링 반영 실행",
    "전체 항목 펼쳐보기",
    "고급 / 상세 결과 보기",
    "검색어는 상품별 1세트로 반영됩니다.",
    "출시 보류 - 승인 대기",
    "출시 완료",
    "출시 보류 - 차단 항목 있음",
  ]) assert.ok(source.includes(text), text);
});

test("row 950 renders as one seed keyword group and expands to all generated goods keys", () => {
  const rows = Array.from({ length: 6 }, (_, index) => ({ row: 950, goods_key: `GK${index + 1}`, ptn_goods_cd: `P-1${String.fromCharCode(97 + index)}`, product_name: `상품 ${index + 1}` }));
  const groups = buildLaunchSourceRowGroups(rows, "950");
  assert.equal(groups.length, 1);
  assert.equal(groups[0].sourceRowId, "950");
  assert.equal(groups[0].goodsKeys.length, 6);
  const expanded = expandSeedKeywordsBySourceRowToGoodsKeys({ "950": "게임패드,컨트롤러,조이스틱,미니" }, groups);
  assert.deepEqual(Object.keys(expanded).sort(), ["GK1", "GK2", "GK3", "GK4", "GK5", "GK6"]);
  assert.ok(Object.values(expanded).every((value) => value === "게임패드,컨트롤러,조이스틱,미니"));
  const payload = buildKeywordEngineDispatchPayload(rows, "", expanded);
  assert.equal(payload.inputs.seed_keywords_by_goods_key_json, JSON.stringify(expanded));
});

test("embedded launch mode auto-prepares review but keeps real apply approval explicit", async () => {
  const workspace = await readFile("src/components/keyword-review/KeywordReviewWorkspace.tsx", "utf8");
  assert.match(workspace, /autoDryRun=\{isEmbedded\}/);
  assert.match(workspace, /void run\("dry_run", true\)/);
  assert.match(workspace, /onClick=\{\(\) => void run\("apply"\)\}/);
  assert.match(workspace, /blockedCount > 0/);
  assert.match(workspace, /compactApplyDisabled = disabled \|\| !dryRunSucceeded \|\| blockedCount > 0/);
  assert.match(workspace, /<details id="keyword-advanced-apply-details"/);
});

test("request identifiers and internal controls are gated behind advanced details", async () => {
  const flow = await readFile("src/components/product-launch-flow/ProductLaunchFlow.tsx", "utf8");
  const workspace = await readFile("src/components/keyword-review/KeywordReviewWorkspace.tsx", "utf8");
  assert.match(flow, /<details className="mt-4 rounded-xl bg-white p-4 text-sm font-semibold text-slate-800"><summary className="cursor-pointer">고급 \/ 상세 결과 보기<\/summary>/);
  assert.match(workspace, /<details id="keyword-advanced-apply-details"/);
  for (const text of ["속성 꾸밈어 추가", "확장 적용 계획 생성", "dry_run 실행", "payload JSON"]) {
    assert.ok(workspace.includes(text) || flow.includes(text), `${text} remains available in source for advanced mode`);
  }
});
