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

test("keyword review foundation contains no live Shopling execution", async () => {
  const source = await readFile(
    new URL("../src/app/keyword-review-queue/page.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /\/api\/shopling/i);
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

test("keyword review apply UX source includes mall key fill and Korean labels", async () => {
  const source = await readFile(
    new URL("../src/app/keyword-review-queue/page.tsx", import.meta.url),
    "utf8",
  );
  for (const text of [
    "샵플링 반영 미리보기 생성",
    "승인된 행",
    "반영 준비 완료",
    "수정 필요",
    "적용할 쇼핑몰(mall_key)을 선택하세요",
    "검색어를 입력하세요",
    "적용 쇼핑몰 선택",
    "선택 쇼핑몰 일괄 적용",
    "승인된 행에 쇼핑몰 적용",
    "빈 검색어 자동 채우기",
    "실행 전 최종 점검",
    "실행 가능 행",
    "최종 확인문구",
    "keywordReviewQueue.defaultMallKey",
    "defaultMallKey",
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
    "useState(DEFAULT_MALL_KEY)",
    "허용 쇼핑몰은 위 ‘적용 쇼핑몰 선택’ 값으로 자동 설정됩니다.",
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


test("product launch wizard step 4 prepares dry_run without requiring preflight readiness", async () => {
  const source = await readFile(
    new URL("../src/app/keyword-review-queue/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /const step4Disabled = !applyPlanReady \|\| readinessCounts\.previewReadyCount === 0;/,
  );
  assert.doesNotMatch(source, /const step4Disabled = .*preflightReady/);
  assert.match(source, /dry_run 실행 준비/);
  assert.match(
    source,
    /적용 점검을 생성했습니다\. 아래 dry_run 실행 버튼을 눌러 실제 반영 전 안전 점검을 진행하세요\./,
  );
  assert.match(source, /const step5Disabled = !dryRunSucceeded;/);
  assert.match(source, /dry_run 성공 후 실제 반영이 가능합니다\./);
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
