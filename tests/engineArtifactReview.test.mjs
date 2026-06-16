import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createEngineArtifactReviewSummary,
  DEFAULT_ENGINE_INTEGRATION_SAFETY_FLAGS,
} from "../src/lib/engineArtifactReview.ts";
import { moduleRegistry } from "../src/lib/moduleRegistry.ts";

test("shared engine safety flags default to no external execution", () => {
  assert.equal(DEFAULT_ENGINE_INTEGRATION_SAFETY_FLAGS.externalEngineExecution, false);
  assert.equal(DEFAULT_ENGINE_INTEGRATION_SAFETY_FLAGS.notPublished, true);
  assert.equal(DEFAULT_ENGINE_INTEGRATION_SAFETY_FLAGS.notAppliedToShopling, true);
  assert.equal(DEFAULT_ENGINE_INTEGRATION_SAFETY_FLAGS.previewOnly, true);
  assert.equal(DEFAULT_ENGINE_INTEGRATION_SAFETY_FLAGS.requiresHumanApproval, true);

  const summary = createEngineArtifactReviewSummary({ source: "keyword-engine-soon" });
  assert.equal(summary.safetyFlags.externalEngineExecution, false);
  assert.ok(summary.statuses.includes("execution_disabled"));
});

test("keyword page safety banner and page boundaries copy exists", async () => {
  const source = await readFile(new URL("../src/app/keyword-review-queue/page.tsx", import.meta.url), "utf8");
  assert.match(source, /reviews imported external engine outputs only/i);
  assert.match(source, /No external\s+engine is executed from this page/i);
  assert.match(source, /no Shopling API call is made/i);
  assert.match(source, /Human approval is required before any future execution/i);
  assert.match(source, /Does not run keyword-engine-soon directly/i);
});

test("detail page safety banner and page boundaries copy exists", async () => {
  const source = await readFile(new URL("../src/app/detail-page-draft-review/page.tsx", import.meta.url), "utf8");
  assert.match(source, /reviews imported external engine outputs only/i);
  assert.match(source, /No external\s+engine is executed from this page/i);
  assert.match(source, /no Shopling API call is made/i);
  assert.match(source, /Human approval is required before any future execution/i);
  assert.match(source, /Does not run product-detail-page-auto directly/i);
});

test("handoff docs mention both engine repos and OPS CENTER boundaries", async () => {
  const doc = await readFile(new URL("../docs/engine-artifact-handoff.md", import.meta.url), "utf8");
  assert.match(doc, /andysong111\/andysong111-keyword-engine-soon/);
  assert.match(doc, /andysong111\/product-detail-page-auto/);
  assert.match(doc, /Do not copy keyword-engine logic into OPS CENTER/);
  assert.match(doc, /Do not copy detail-page engine logic into OPS CENTER/);
  assert.match(doc, /OPS CENTER owns review, approval, preview, history, and execution safety/);
});

test("dashboard descriptions distinguish review modules from runner modules", () => {
  const keywordReview = moduleRegistry.find((module) => module.id === "keyword-review-queue");
  const keywordRunner = moduleRegistry.find((module) => module.id === "keyword-engine");
  const detailReview = moduleRegistry.find((module) => module.id === "detail-page-draft-review");
  const detailRunner = moduleRegistry.find((module) => module.id === "detail-page-engine");

  assert.match(keywordReview?.description ?? "", /Current usable workflow for imported keyword-engine artifacts/i);
  assert.match(keywordReview?.description ?? "", /review/i);
  assert.match(keywordReview?.description ?? "", /export|previews/i);
  assert.match(keywordRunner?.description ?? "", /Preparing future direct/i);
  assert.equal(keywordRunner?.status, "preparing");

  assert.match(detailReview?.description ?? "", /Current usable workflow for imported detail-page artifacts/i);
  assert.match(detailReview?.description ?? "", /preview/i);
  assert.match(detailReview?.description ?? "", /mark drafts/i);
  assert.match(detailRunner?.description ?? "", /Preparing future direct/i);
  assert.equal(detailRunner?.status, "preparing");
});
