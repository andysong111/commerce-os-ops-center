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
