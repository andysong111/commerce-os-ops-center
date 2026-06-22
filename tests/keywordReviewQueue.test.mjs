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
  const [reviewed] = createReviewedRows([rows[1]]);
  reviewed.editedTitle = "User edited title";
  reviewed.editedSiteSrch = "user, edited, keywords";
  reviewed.reviewStatus = "approved";
  const [exported] = JSON.parse(exportReviewedQueue([reviewed]));

  assert.equal(exported.edited_title, "User edited title");
  assert.equal(exported.edited_site_srch, "user, edited, keywords");
  assert.equal(exported.review_status, "approved");
  assert.equal(exported.classification, "manual_review");
  assert.equal(exported.source_row_index, 3);
});

test("keyword review foundation contains no live Shopling execution", async () => {
  const source = await readFile(
    new URL("../src/app/keyword-review-queue/page.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /\/api\/shopling/i);
});

test("keyword review is sheet-only with no card or mode toggle", async () => {
  const source = await readFile(
    new URL("../src/app/keyword-review-queue/page.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /카드형 보기/);
  assert.doesNotMatch(source, /시트형 보기/);
  assert.doesNotMatch(source, /viewMode|setViewMode|ReviewRow/);
  assert.match(source, /검토 목록/);
  assert.match(
    source,
    /표에서 상품명과 검색어를 확인하고 승인 또는 보류를 선택하세요/,
  );
  assert.match(source, /<SheetReviewTable/);
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

test("preview and safety sections use beginner-friendly Korean labels", async () => {
  const source = await readFile(
    new URL("../src/app/keyword-review-queue/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /검토 결과 미리보기 만들기/);
  assert.match(source, /미리보기 만들기/);
  assert.doesNotMatch(source, /Generate payload\/XML preview/);
  assert.doesNotMatch(source, />Execution Preflight</);
  assert.match(source, /고급 안전 확인 열기/);
  for (const label of [
    "허용할 몰 키",
    "이미 처리한 상품번호",
    "최대 처리 행 수",
    "안전 확인 실행",
  ]) {
    assert.match(source, new RegExp(label));
  }
});

test("technical preview terms are kept in collapsed details only", async () => {
  const source = await readFile(
    new URL("../src/app/keyword-review-queue/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /기술 정보 보기/);
  assert.match(
    source,
    /Preview XML \/ payload \/ site_srch \/ preflight \/ preview-only flags/,
  );
  assert.doesNotMatch(
    source,
    /<h2[^>]*>.*payload|<p[^>]*>.*XML|<button[^>]*>.*preflight/i,
  );
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
