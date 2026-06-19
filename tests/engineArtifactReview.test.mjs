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
  assert.match(source, /외부 키워드 엔진 결과물을 검토만 합니다/);
  assert.match(source, /키워드 엔진을 직접 실행하지 않고/);
  assert.match(source, /샵플링 API를 호출하지 않으며|샵플링 API를 호출하지 않습니다/);
  assert.match(source, /사람이 검토\/승인해야/);
  assert.match(source, /keyword-engine-soon을 직접 실행하지 않습니다/);
});

test("detail page safety banner and page boundaries copy exists", async () => {
  const source = await readFile(new URL("../src/app/detail-page-draft-review/page.tsx", import.meta.url), "utf8");
  assert.match(source, /reviews imported external engine outputs only/i);
  assert.match(source, /No external\s+engine is executed from this page/i);
  assert.match(source, /샵플링 API를 호출하지 않습니다|no Shopling API call is made/i);
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

test("dashboard descriptions and module labels are Korean-first", async () => {
  const dashboardSource = await readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8");
  const registryText = JSON.stringify(moduleRegistry);
  const dashboardText = `${dashboardSource} ${registryText}`;

  for (const label of [
    "대시보드",
    "중국주문 원가계산기",
    "상품 마스터",
    "배대지 바코드 PDF 생성기",
    "키워드 엔진 실행기",
    "키워드 검토/승인 큐",
    "상세페이지 엔진 실행기",
    "상세페이지 초안 검수 / 미리보기",
    "재고 / 가격 관리",
    "샵플링 API 자동화",
    "사용 가능",
    "준비 중",
    "실행 가능",
    "모듈 열기",
    "실행기 열기",
  ]) {
    assert.match(dashboardText, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.equal(moduleRegistry.find((module) => module.id === "keyword-engine")?.status, "runner_scaffold");
  assert.equal(moduleRegistry.find((module) => module.id === "detail-page-engine")?.status, "runner_scaffold");
  assert.match(moduleRegistry.find((module) => module.id === "keyword-review-queue")?.description ?? "", /키워드 엔진 결과물/);
  assert.match(moduleRegistry.find((module) => module.id === "detail-page-draft-review")?.description ?? "", /상세페이지 엔진 산출물/);
});
