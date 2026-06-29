import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createReviewedRows,
  exportReviewedQueue,
  parseKeywordMvpCsv,
} from "../src/lib/keywordReviewQueue.ts";

const fixture = await readFile(
  new URL("./fixtures/keyword-mvp-sample.csv", import.meta.url),
  "utf8",
);
const rows = parseKeywordMvpCsv(fixture);

test("parses flexible headers and preserves original unknown columns", () => {
  const [row] = parseKeywordMvpCsv(
    "Product Key,Shop Key,Title,Suggested Title,unknown_field\n1,mall,Old,New,kept",
  );
  assert.equal(row.goodsKey, "1");
  assert.equal(row.mallKey, "mall");
  assert.equal(row.originalTitle, "Old");
  assert.equal(row.recommendedTitle, "New");
  assert.equal(row.raw.unknown_field, "kept");
});

test("missing optional columns use safe defaults without crashing", () => {
  const [row] = parseKeywordMvpCsv("goods_key\n123");
  assert.equal(row.goodsKey, "123");
  assert.equal(row.warningFlags, "");
  assert.equal(row.siteSrchKeywordCount, null);
  assert.equal(row.classification, "manual_review");
});

test("quoted CSV keyword fields parse commas and escaped quotes", () => {
  const quoted = rows.find((row) => row.goodsKey === "121053");
  assert.ok(quoted);
  assert.equal(
    quoted.recommendedSiteSrch,
    'alpha, beta, "quoted phrase", delta',
  );
});

test("classifies a fully passing ten-keyword row as auto apply candidate", () => {
  assert.equal(rows[0].classification, "auto_apply_candidate");
});

test("BLOCKED_TITLE_LENGTH becomes manual review", () => {
  assert.equal(rows[1].classification, "manual_review");
});

test("UNDERFILLED_SITE_SRCH becomes manual review", () => {
  assert.equal(rows[2].classification, "manual_review");
});

test("risk statuses become blocked risk", () => {
  assert.equal(rows[3].classification, "blocked_risk");
});

test("an ambiguous row defaults to manual review", () => {
  assert.equal(rows[4].classification, "manual_review");
});

test("reviewed export includes edits and review status", () => {
  const [reviewed] = createReviewedRows([rows[1]], { [rows[1].goodsKey]: { ptn_goods_cd: "TEST1-1g", group_suffix: "g", product_group: "미등록 그룹(g)", product_group_type: "확인 필요", product_group_status: "unregistered" } });
  reviewed.editedTitle = "User edited title";
  reviewed.editedSiteSrch = "user, edited, keywords";
  reviewed.reviewStatus = "approved";
  const [exported] = JSON.parse(exportReviewedQueue([reviewed]));

  assert.equal(exported.edited_title, "User edited title");
  assert.equal(reviewed.editedMallKey, reviewed.mallKey);
  assert.equal(exported.edited_site_srch, "user, edited, keywords");
  assert.equal(exported.edited_mall_key, reviewed.mallKey);
  assert.equal(exported.review_status, "approved");
  assert.equal(exported.classification, "manual_review");
  assert.equal(exported.source_row_index, 3);
  assert.equal(exported.ptn_goods_cd, "TEST1-1g");
  assert.equal(exported.product_group, "미등록 그룹(g)");
  assert.equal(exported.product_group_status, "unregistered");
});


test("keyword review queue includes exception-first launch flow polish", async () => {
  const source = await readFile(
    new URL("../src/app/keyword-review-queue/page.tsx", import.meta.url),
    "utf8",
  );
  for (const expected of [
    "문제만 보기",
    "성공 항목 숨기기",
    "성공 항목 보기",
    "상세 실행 결과 열기",
    "전체 행 보기",
    "검색어가 10개 미만입니다. 현재는 경고입니다.",
    "KEYWORD_APPLY_CONFIRMATION_TEXT",
    "dry_run 성공 후 실제 반영이 가능합니다.",
  ]) {
    assert.ok(source.includes(expected), expected);
  }
  assert.doesNotMatch(source, /자동 진행.*run\("apply"\)|useEffect\([\s\S]{0,400}run\("apply"\)/);
});

test("keyword review foundation contains no live Shopling execution", async () => {
  const source = await readFile(
    new URL("../src/app/keyword-review-queue/page.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /https?:\/\/[^"\']*shopling/i);
  assert.doesNotMatch(source, /\/api\/shopling(?!-)/i);
  assert.match(source, /\/api\/keyword-shopling-apply\/run/);
  assert.match(source, /\/api\/keyword-shopling-apply\/actions-result/);
});

test("keyword review sheet and card modes are present", async () => {
  const source = await readFile(
    new URL("../src/app/keyword-review-queue/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /시트형 보기/);
  assert.match(source, /카드형 보기/);
  assert.match(source, /length > 5 \? "sheet" : "card"/);
});

test("sheet table renders Korean bulk review columns", async () => {
  const source = await readFile(
    new URL("../src/app/keyword-review-queue/page.tsx", import.meta.url),
    "utf8",
  );
  for (const label of [
    "선택",
    "상태",
    "상품번호",
    "현재 상품명",
    "추천 상품명",
    "추천 검색어",
    "검토 메모",
    "작업",
  ]) {
    assert.match(source, new RegExp(label));
  }
});

test("sheet mode supports editing title and keywords", async () => {
  const source = await readFile(
    new URL("../src/app/keyword-review-queue/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /editedTitle: event\.target\.value/);
  assert.match(source, /editedSiteSrch: event\.target\.value/);
  assert.match(source, /추천 상품명 없음 — 직접 입력/);
  assert.match(source, /검색어 없음 — 필요하면 입력/);
  assert.match(source, /수정됨/);
});

test("sheet mode supports per-row and bulk status updates", async () => {
  const source = await readFile(
    new URL("../src/app/keyword-review-queue/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /reviewStatus: "approved"/);
  assert.match(source, /reviewStatus: "hold"/);
  assert.match(source, /선택 항목 승인/);
  assert.match(source, /선택 항목 보류/);
  assert.match(source, /전체 검토 필요 항목 승인/);
  assert.match(source, /검토 필요 항목을 모두 승인하시겠습니까/);
});

test("sheet filters and search are configured", async () => {
  const source = await readFile(
    new URL("../src/app/keyword-review-queue/page.tsx", import.meta.url),
    "utf8",
  );
  for (const label of [
    "전체",
    "검토 필요",
    "승인 가능",
    "보류",
    "승인됨",
    "위험/차단",
    "검색어 없음",
    "추천 상품명 없음",
  ]) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /상품번호 또는 상품명 검색/);
  assert.match(source, /row\.goodsKey, row\.originalTitle, row\.editedTitle/);
});

test("sheet details hide raw technical fields behind details action", async () => {
  const source = await readFile(
    new URL("../src/app/keyword-review-queue/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /세부보기/);
  for (const label of [
    "mail_key",
    "sourceRowIndex",
    "quality_status",
    "confidence_status",
    "block_reason",
    "warning_flags",
    "counts",
    "raw site_srch",
  ]) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /expandedRows\.has\(index\)/);
});

test("copy helper states current sheet edits and statuses are copied", async () => {
  const source = await readFile(
    new URL("../src/app/keyword-review-queue/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /현재 수정\/승인\/보류 상태가 복사됩니다/);
  assert.match(source, /exportReviewedQueue\(rows\)/);
});

test("keyword review sheet safety contains no forbidden execution helpers", async () => {
  const page = await readFile(
    new URL("../src/app/keyword-review-queue/page.tsx", import.meta.url),
    "utf8",
  );
  const workflows = await readFile(
    new URL("../.github/workflows", import.meta.url),
    "utf8",
  ).catch(() => "");
  assert.doesNotMatch(
    page,
    /child_process|PowerShell|powershell|pwsh|exec\(|spawn\(|SHOPLING_.*TOKEN|GITHUB_TOKEN/,
  );
  assert.doesNotMatch(
    page,
    /Shopling API 실행|auto-apply|auto apply|apply\/write/i,
  );
  assert.equal(workflows, "");
});

test("keyword review supports local full clear, row delete, and bulk delete", async () => {
  const source = await readFile(
    new URL("../src/app/keyword-review-queue/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /현재 검토 목록 삭제/);
  assert.match(source, /현재 불러온 키워드 검토 목록을 삭제하시겠습니까/);
  assert.match(source, /샵플링에는 영향이 없고/);
  assert.match(source, /resetReviewLocalState/);
  assert.match(
    source,
    /sessionStorage\.removeItem\("opsCenter\.keywordEngine\.importedArtifact\.v1"\)/,
  );
  assert.match(source, /setSheetFilter\("all"\)/);
  assert.match(source, /setSheetSearch\(""\)/);
  assert.match(source, /setPayloadPreview\(null\)/);
  assert.match(source, /setPreflightResult\(null\)/);
  assert.match(source, /setCopyStatus\(""\)/);
  assert.match(source, /아직 불러온 키워드 결과가 없습니다/);
  assert.match(source, /검토할 키워드가 없습니다/);
  assert.match(source, /키워드 엔진 실행기로 이동/);
  assert.match(source, /직접 파일 넣기/);

  assert.match(source, /행 삭제/);
  assert.match(source, /이 행을 현재 검토 목록에서 삭제하시겠습니까/);
  assert.match(source, /선택 항목 삭제/);
  assert.match(source, /선택한 항목을 현재 검토 목록에서 삭제하시겠습니까/);
  assert.match(
    source,
    /current\.filter\(\(_, index\) => !targetIndexes\.has\(index\)\)/,
  );
  assert.match(source, /exportReviewedQueue\(rows\)/);
});

test("keyword review delete controls do not introduce external writes or shell helpers", async () => {
  const source = await readFile(
    new URL("../src/app/keyword-review-queue/page.tsx", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(
    source,
    /Shopling API 실행|auto-apply|auto apply|apply\/write/i,
  );
  assert.doesNotMatch(
    source,
    /child_process|PowerShell|powershell|pwsh|exec\(|spawn\(/,
  );
  assert.doesNotMatch(source, /GITHUB_TOKEN|SHOPLING_.*TOKEN|secret/i);
});

test("keyword review apply UX source removes manual mall selection and explains product-group automation", async () => {
  const source = await readFile(
    new URL("../src/app/keyword-review-queue/page.tsx", import.meta.url),
    "utf8",
  );
  for (const text of [
    "적용 쇼핑몰 선택",
    "선택 쇼핑몰 일괄 적용",
    "승인된 행에 쇼핑몰 적용",
    "빈 검색어 자동 채우기",
  ])
    assert.doesNotMatch(source, new RegExp(text));
  for (const text of [
    "상품그룹 기준으로 연결 쇼핑몰이 자동 선택됩니다",
    "mall_key는 상품그룹 설정에 따라 자동으로 결정됩니다",
    "사용자는 쇼핑몰을 직접 선택하지 않아도 됩니다",
    "상품그룹이 확인되지 않은 행은 적용 계획에서 차단됩니다",
    "상품그룹에 연결된 쇼핑몰별로 상품명과 mall_key가 자동 생성됩니다",
    "상품그룹별 상품명 미리보기",
    "상품그룹 기준 적용 계획 생성",
    "keyword-shopling-apply-section",
    "dry_run 실행 준비",
    "실제 샵플링 반영 실행",
    "fallbackSiteSrchFromTitle",
  ])
    assert.match(source, new RegExp(text.replace(/[()]/g, "\\$&")));
});

test("keyword review preflight defaults and Korean labels are present", async () => {
  const source = await readFile(
    new URL("../src/app/keyword-review-queue/page.tsx", import.meta.url),
    "utf8",
  );
  for (const text of [
    "useState(\"\")",
    "허용 쇼핑몰은 상품그룹 시장 등록 설정에 따라 자동 설정됩니다.",
    "useState(\"20\")",
    "실제 반영은 아래 ‘실제 샵플링 반영 실행’에서 확인문구 입력 후 진행됩니다.",
  ])
    assert.match(source, new RegExp(text.replace(/[()]/g, "\\$&")));

  const labelSource = await readFile(
    new URL("../src/lib/keywordReviewExecutionPreflight.ts", import.meta.url),
    "utf8",
  );
  for (const text of [
    "선택한 쇼핑몰이 허용 목록에 없습니다.",
    "같은 상품번호/쇼핑몰 조합이 중복되었습니다.",
    "검색어가 10개 미만입니다. 현재는 경고만 표시합니다.",
  ])
    assert.match(labelSource, new RegExp(text.replace(/[()]/g, "\\$&")));
});

test("keyword review apply UX removes selected English visible labels", async () => {
  const source = await readFile(
    new URL("../src/app/keyword-review-queue/page.tsx", import.meta.url),
    "utf8",
  );
  for (const text of [
    "Generate payload/XML preview",
    "INVALID ROWS",
    "PREVIEW-READY ROWS",
    "APPROVED ROWS",
    "Execution Preflight",
    "Run preflight check",
    "Result summary",
    "I understand this is a preview-only preflight",
    "FINAL_CONFIRMATION_REQUIRED",
    "MALL_KEY_NOT_ALLOWED",
    "DUPLICATE_GOODS_KEY",
    "FINAL_SITE_SRCH_UNDERFILLED",
  ])
    assert.doesNotMatch(source, new RegExp(text));
});


test("reviewed rows include product group metadata and missing fallback", () => {
  const [withMetadata, missingMetadata] = createReviewedRows([rows[0], rows[1]], {
    [rows[0].goodsKey]: { ptn_goods_cd: "TEST1-1a", group_suffix: "a", product_group: "도매1", product_group_type: "도매", product_group_status: "registered" },
  });
  assert.equal(withMetadata.ptnGoodsCd, "TEST1-1a");
  assert.equal(withMetadata.groupSuffix, "a");
  assert.equal(withMetadata.productGroup, "도매1");
  assert.equal(withMetadata.productGroupType, "도매");
  assert.equal(withMetadata.productGroupStatus, "registered");
  assert.equal(missingMetadata.productGroup, "상품그룹 확인 필요");
  assert.equal(missingMetadata.productGroupType, "확인 필요");
  assert.equal(missingMetadata.productGroupStatus, "missing");
});

test("keyword review UI includes dynamic group filters and policy placeholder copy", async () => {
  const source = await readFile(new URL("../src/app/keyword-review-queue/page.tsx", import.meta.url), "utf8");
  for (const expected of [
    "상품그룹",
    "도매 전체",
    "소매 전체",
    "기타 전체",
    "상품그룹 확인 필요",
    "미등록 그룹",
    "다음 단계에서 상품그룹별 상품명 정책을 적용합니다",
    "미등록 그룹은 정책 적용 전 상품그룹 정의표에 등록하는 것을 권장합니다",
  ]) {
    assert.match(source, new RegExp(expected));
  }
});


test("keyword review page contains complete product launch wizard copy and anchors", async () => {
  const source = await readFile(
    new URL("../src/app/keyword-review-queue/page.tsx", import.meta.url),
    "utf8",
  );
  for (const label of [
    "상품 출시 플로우",
    "Step 1",
    "Step 2",
    "Step 3",
    "Step 4",
    "Step 5",
    "상품명 후보 선택",
    "상품그룹별 상품명 미리보기",
    "상품그룹 기준 적용 계획 생성",
    "dry_run 실행 준비",
    "실제 반영",
    "1 → 2 → 3 → 4 → 5 순서대로 진행하세요",
    "버튼을 순서대로 누르면 안전하게 등록할 수 있습니다",
    "승인된 상품명이 있어야 진행할 수 있습니다",
    "상품그룹별 미리보기를 먼저 생성하세요",
    "적용 계획을 먼저 생성하세요",
    "dry_run 성공 후 실제 반영이 가능합니다",
    "적용 점검을 생성했습니다. 아래 dry_run 실행 버튼을 눌러 실제 반영 전 안전 점검을 진행하세요.",
    "이 단계는 아직 샵플링에 반영하지 않습니다",
    "실제 반영 버튼을 누르기 전까지 상품명은 변경되지 않습니다",
    "고급 검토 옵션 열기",
    "상세 검토표입니다",
    "keyword-shopling-apply-section",
  ]) {
    assert.match(source, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("keyword review wizard readiness rules avoid Step 4 deadlock", async () => {
  const source = await readFile(
    new URL("../src/app/keyword-review-queue/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /const step2Disabled = counts\.approvedCount === 0/);
  assert.match(source, /const step3Disabled = !groupPreviewReady/);
  assert.match(source, /const step4Disabled = !applyPlanReady \|\| counts\.previewReadyCount === 0/);
  assert.doesNotMatch(source, /const step4Disabled = !applyPlanReady \|\| counts\.previewReadyCount === 0 \|\| !preflightReady/);
  assert.match(source, /const step5Disabled = !dryRunSucceeded/);
});

test("guided preview action is preview only and actual apply is dry_run guarded", async () => {
  const source = await readFile(
    new URL("../src/app/keyword-review-queue/page.tsx", import.meta.url),
    "utf8",
  );
  const guided = source.slice(source.indexOf("function runGuidedApprovalPreviewPlan"), source.indexOf("function generateGroupPreview"));
  assert.doesNotMatch(guided, /fetch\s*\(/);
  assert.doesNotMatch(guided, /\/api\/keyword-shopling-apply\/run/);
  assert.doesNotMatch(guided, /mode:\s*["'](?:dry_run|apply)["']/);
  assert.match(source, /mode === "apply" && !dryRunSucceeded/);
  assert.match(source, /disabled=\{disabled \|\| !dryRunSucceeded\}/);
});
