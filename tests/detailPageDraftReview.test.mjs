import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  classifyDetailPageDraft,
  exportReviewedDetailPageDraft,
  parseDetailPageDraftReview,
  parseMultiSourceSummary,
  parseRenderReport,
} from "../src/lib/detailPageDraftReview.ts";

const bathReport = await readFile(new URL("./fixtures/detail-page-draft-review/bath001-render-report.json", import.meta.url), "utf8");
const bathSummary = await readFile(new URL("./fixtures/detail-page-draft-review/bath001-summary.json", import.meta.url), "utf8");
const sampleHtml = "<section><h1>BATH001</h1><img src='local.png' /></section>";

test("valid BATH001-like render report parses", () => {
  const parsed = parseRenderReport(bathReport);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.data?.product_code, "BATH001");
  assert.equal(parsed.data?.rendered_block_count, 12);
});

test("invalid render report JSON returns errors", () => {
  const parsed = parseRenderReport("{bad json");
  assert.equal(parsed.data, null);
  assert.ok(parsed.errors[0].includes("Invalid render report JSON"));
});

test("missing optional fields do not crash", () => {
  const parsed = parseRenderReport('{"product_code":"MIN","rendered_block_count":1,"rendered_image_count":1}');
  assert.equal(parsed.data?.generated_images_used, null);
  assert.deepEqual(parsed.data?.missing_roles, []);
});

test("mvp_pass classification", () => {
  const renderReport = parseRenderReport(bathReport);
  const multiSourceSummary = parseMultiSourceSummary(bathSummary);
  assert.equal(classifyDetailPageDraft({ renderReport, multiSourceSummary, html: sampleHtml }), "mvp_pass");
});

test("missing_roles causes needs_review or failed according to severity", () => {
  const nonCritical = parseRenderReport('{"product_code":"X","rendered_block_count":2,"rendered_image_count":1,"missing_roles":["comparison"],"warnings":[],"mvp_pass":false}');
  assert.equal(classifyDetailPageDraft({ renderReport: nonCritical, html: sampleHtml }), "needs_review");
  const critical = parseRenderReport('{"product_code":"X","rendered_block_count":2,"rendered_image_count":1,"missing_roles":["hero"],"warnings":[],"mvp_pass":false}');
  assert.equal(classifyDetailPageDraft({ renderReport: critical, html: sampleHtml }), "blocked_or_failed");
});

test("zero rendered_image_count causes blocked_or_failed", () => {
  const report = parseRenderReport('{"product_code":"X","rendered_block_count":2,"rendered_image_count":0,"missing_roles":[],"warnings":[],"mvp_pass":false}');
  assert.equal(classifyDetailPageDraft({ renderReport: report, html: sampleHtml }), "blocked_or_failed");
});

test("no HTML causes blocked_or_failed", () => {
  const report = parseRenderReport(bathReport);
  assert.equal(classifyDetailPageDraft({ renderReport: report, html: "" }), "blocked_or_failed");
});

test("generated_images_used creates human review warning", () => {
  const result = parseDetailPageDraftReview({ html: sampleHtml, renderReportText: bathReport, multiSourceSummaryText: bathSummary });
  assert.ok(result.validationWarnings.some((warning) => warning.includes("Generated image usage")));
});

test("multi_source_summary parses coverage fields", () => {
  const parsed = parseMultiSourceSummary(bathSummary);
  assert.equal(parsed.errors.length, 0);
  assert.deepEqual(parsed.data?.new_roles, ["lifestyle", "benefit"]);
  assert.equal(parsed.data?.images_after, 7);
});

test("reviewed draft export includes notPublished true", () => {
  const exported = JSON.parse(exportReviewedDetailPageDraft({ productCode: "BATH001", classification: "mvp_pass", reviewStatus: "final_candidate", memo: "ok", renderReportSnapshot: parseRenderReport(bathReport).data, multiSourceSummarySnapshot: parseMultiSourceSummary(bathSummary).data, html: sampleHtml, generatedSourceFiles: [], createdAt: "2026-06-15T00:00:00.000Z" }));
  assert.equal(exported.notPublished, true);
});

test("reviewed draft export includes externalEngineExecution false", () => {
  const exported = JSON.parse(exportReviewedDetailPageDraft({ productCode: "BATH001", classification: "mvp_pass", reviewStatus: "final_candidate", memo: "ok", renderReportSnapshot: null, multiSourceSummarySnapshot: null, html: sampleHtml, generatedSourceFiles: [], createdAt: "2026-06-15T00:00:00.000Z" }));
  assert.equal(exported.externalEngineExecution, false);
});

test("no external API execution is present", async () => {
  const lib = await readFile(new URL("../src/lib/detailPageDraftReview.ts", import.meta.url), "utf8");
  const page = await readFile(new URL("../src/app/detail-page-draft-review/page.tsx", import.meta.url), "utf8").catch(() => "");
  const source = `${lib}\n${page}`;
  assert.equal(/fetch\(|new XMLHttpRequest|child_process|exec\(|spawn\(/i.test(source), false);
});
