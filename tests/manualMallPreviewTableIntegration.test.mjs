import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../src/components/product-launch-flow/ProductLaunchFlow.tsx", import.meta.url),
  "utf8",
);
const sectionStart = source.indexOf("function ManualPreviewReviewSection(");
const sectionEnd = source.indexOf("function ManualApplyStatusCard(", sectionStart);
const tableSection = source.slice(sectionStart, sectionEnd);
const diff = (await import("node:child_process")).execFileSync("git", ["diff", "--", "src/components/product-launch-flow/ProductLaunchFlow.tsx"], { encoding: "utf8" });

test("ProductLaunchFlow imports buildManualMallPreviewRows", () => {
  assert.match(source, /import \{ buildManualMallPreviewRows \} from "@\/lib\/manualMallPreviewRows";/);
});

test("ProductLaunchFlow builds manual mall rows from existing states", () => {
  assert.match(source, /const manualMallPreviewRows = useMemo\(/);
  assert.match(source, /previewResult: manualPreviewResult/);
  assert.match(source, /preflightResult: manualPreflightResult/);
  assert.match(source, /applyResults: Array\.isArray\(manualApplyResult\?\.applyResults\)/);
  assert.match(source, /manualApplyResult\.applyResults\s*:\s*\[\]/);
  assert.match(source, /verifyResults: Array\.isArray\(manualApplyResult\?\.verifyResults\)/);
  assert.match(source, /manualApplyResult\.verifyResults\s*:\s*\[\]/);
  assert.match(source, /\[manualPreviewResult, manualPreflightResult, manualApplyResult\]/);
});

test("full table renders manualMallPreviewRows rows directly", () => {
  assert.match(tableSection, /const \{ status, rows, summary \} = manualMallPreviewRows;/);
  assert.match(tableSection, /rows\.map\(\(row, index\) =>/);
  assert.doesNotMatch(tableSection, /manualPreviewResult|previewResult\.items|eligibleItems\.map|blockedItems\.map|uploadRows|goodsKeys/);
});

test("not_generated and preview_only states have required notices", () => {
  assert.match(tableSection, /status === "not_generated"/);
  assert.match(tableSection, /전체 쇼핑몰 적용 미리보기/);
  assert.match(tableSection, /검토 계획 생성 전/);
  assert.match(tableSection, /상품명과 검색어를 입력한 뒤 검토 계획을 생성하세요\./);
  assert.match(tableSection, /status === "preview_only"/);
  assert.match(tableSection, /미리보기 생성됨 · 사전점검 전/);
});

test("all required headers exist", () => {
  for (const header of [
    "goods_key", "상품그룹", "쇼핑몰", "mall_key", "생성 상품명", "검색어", "상품명 키워드 수", "포함 키워드 수", "무결성", "미리보기 상태", "사전점검 상태", "반영 상태", "차단 사유", "경고",
  ]) {
    assert.match(tableSection, new RegExp(header));
  }
});

test("row order is not sorted or regrouped in the UI", () => {
  assert.doesNotMatch(tableSection, /\.sort\s*\(/);
  assert.doesNotMatch(tableSection, /filter\s*\(/);
});

test("multi-word finalTitle is displayed directly without parsing", () => {
  assert.match(tableSection, /\{row\.finalTitle\}/);
  assert.doesNotMatch(tableSection, /split\s*\(|parseManualCandidateList|parseManualMallTitleKeywords|resolveManualTitleOverride/);
});

test("table code does not call duplicate row generation helpers", () => {
  assert.doesNotMatch(tableSection, /buildManualMallTitleVariants|getMarketsForProductGroup|parseManualMallTitleKeywords|manualTitleOverrides|manualKeywordOverrides|uploadRows|goodsKeys/);
});

test("apply message is not used as a blocking reason", () => {
  assert.doesNotMatch(tableSection, /\.message|\["message"\]|message\]/);
});

test("summary displays total, eligible, blocked, applied, and failed counts", () => {
  for (const key of ["totalCount", "eligibleCount", "blockedCount", "appliedCount", "failedCount"]) {
    assert.match(tableSection, new RegExp(`summary\\.${key}`));
  }
});

test("blocked rows remain visible and get red styling", () => {
  assert.match(tableSection, /row\.preflightStatus === "blocked"/);
  assert.match(tableSection, /bg-red-50/);
  assert.doesNotMatch(tableSection, /return null|display:\s*"none"|hidden/);
});

test("no new fetch call or API endpoint is added by this PR", () => {
  assert.doesNotMatch(diff, /^\+.*fetch\s*\(/m);
  assert.doesNotMatch(diff, /^\+.*\/api\//m);
});

test("existing confirm and apply functions remain present", () => {
  assert.match(source, /const confirmManualCandidates = useCallback/);
  assert.match(source, /const applyManualCandidates = useCallback/);
});

test("existing compact execution plan path remains unchanged", () => {
  assert.match(source, /execution_plan_json: buildCompactKeywordApplyExecutionPlan\(\s*manualPreflightResult,\s*\)/);
});

test("source contains no workflow dispatch or direct Shopling write addition", () => {
  assert.doesNotMatch(diff, /^\+.*workflow_dispatch/im);
  assert.doesNotMatch(diff, /^\+.*shopling.*(write|update|api|fetch|request)/im);
});
