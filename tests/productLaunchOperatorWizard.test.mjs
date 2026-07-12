import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { buildKeywordEngineDispatchPayload, buildLaunchSourceRowGroups, expandSeedKeywordsBySourceRowToGoodsKeys } from "../src/lib/productLaunchFlow.ts";

test("operator-first product launch source contains compact wizard copy", async () => {
  const flow = await readFile("src/components/product-launch-flow/ProductLaunchFlow.tsx", "utf8");
  for (const text of [
    "AI 상품출시 에이전트",
    "실재고 시트 행 번호 입력",
    "행별 핵심 키워드",
    "실재고 시트 행마다 좋은 키워드를 한 번만 입력하세요.",
    "최종 반영 전 검토",
    "승인하고 실제 반영 실행",
    "전체 항목 펼쳐보기",
    "개발자 진단 보기",
    "출시 보류 - 승인 대기",
    "실제 반영 중",
    "가격 최종 재적용 중",
    "출시 완료",
  ]) assert.ok(flow.includes(text), text);
});

test("product launch default render is compact and keeps diagnostics collapsed", async () => {
  const flow = await readFile("src/components/product-launch-flow/ProductLaunchFlow.tsx", "utf8");
  const defaultReturn = flow.slice(flow.indexOf("return (\n    <div className=\"space-y-6\">"), flow.indexOf("type LaunchReviewSummary"));
  assert.ok(defaultReturn.includes("<LaunchHero"));
  assert.ok(defaultReturn.includes("<RowInputSection"));
  assert.ok(defaultReturn.includes("<RowSeedKeywordSection"));
  assert.ok(defaultReturn.includes("<FinalReviewSection"));
  assert.ok(defaultReturn.includes("<ApprovalSection"));
  assert.ok(defaultReturn.includes("<details className=\"rounded-2xl border border-slate-200 bg-white p-6 shadow-sm\">"));
  assert.ok(!defaultReturn.includes("open className"), "developer diagnostics is collapsed by default");
  for (const text of [
    "속성 꾸밈어 추가",
    "누락 상품명 자동 보강",
    "상품그룹별 상품명 미리보기",
    "확장 적용 계획 생성",
    "샵플링 반영 미리보기 생성",
    "dry_run 실행",
    "실제 샵플링 반영 실행",
    "payload JSON",
    "payload JSON/XML",
    "직접 파일 넣기",
    "상품그룹별 상품명 차별화",
    "먼저 상품명 후보를 선택하세요",
  ]) assert.ok(!defaultReturn.includes(text), `${text} is not in default render`);
});

test("row seed keywords are grouped once per source row and expand to generated goods keys", () => {
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

test("multiple source rows render as one seed group per source row", () => {
  const rows = [
    { row: 950, goods_key: "GK1", ptn_goods_cd: "P-1a", product_name: "상품 1" },
    { row: 950, goods_key: "GK2", ptn_goods_cd: "P-1b", product_name: "상품 2" },
    { row: 951, goods_key: "GK3", ptn_goods_cd: "P-2a", product_name: "상품 3" },
    { row: 951, goods_key: "GK4", ptn_goods_cd: "P-2b", product_name: "상품 4" },
  ];
  const groups = buildLaunchSourceRowGroups(rows, "950,951");
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((group) => group.sourceRowId), ["950", "951"]);
});

test("embedded launch mode auto-prepares review but keeps real apply approval explicit", async () => {
  const flow = await readFile("src/components/product-launch-flow/ProductLaunchFlow.tsx", "utf8");
  const workspace = await readFile("src/components/keyword-review/KeywordReviewWorkspace.tsx", "utf8");
  assert.match(workspace, /autoDryRun=\{isEmbedded\}/);
  assert.match(workspace, /void run\("dry_run", true\)/);
  assert.match(workspace, /onClick=\{\(\) => void run\("apply"\)\}/);
  assert.match(workspace, /blockedCount > 0/);
  assert.match(workspace, /compactApplyDisabled = disabled \|\| !dryRunSucceeded \|\| blockedCount > 0/);
  assert.ok(flow.includes("autoApplyToShopling: false"));
});

test("review table, request identifiers, and developer diagnostics are hidden by default", async () => {
  const flow = await readFile("src/components/product-launch-flow/ProductLaunchFlow.tsx", "utf8");
  assert.match(flow, /<summary className="cursor-pointer font-bold text-slate-800">전체 항목 펼쳐보기<\/summary>/);
  assert.match(flow, /<summary className="cursor-pointer text-lg font-bold text-slate-950">개발자 진단 보기<\/summary>/);
  assert.ok(!flow.includes("request id table"));
});

test("OPS Center source does not contain forbidden direct execution or secret literals", async () => {
  const flow = await readFile("src/components/product-launch-flow/ProductLaunchFlow.tsx", "utf8");
  for (const text of ["API_AUTH_KEY", "LOGIN_PASSWORD", "child_process", "PowerShell", "shell: true"]) {
    assert.ok(!flow.includes(text), `${text} must not be present`);
  }
});
