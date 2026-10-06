import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const registry = await readFile(
  new URL("../src/lib/opsModuleRegistry.ts", import.meta.url),
  "utf8",
);
const page = await readFile(
  new URL("../src/app/sourcing-center/page.tsx", import.meta.url),
  "utf8",
);

test("Ops dashboard exposes one easy-language sourcing center card", () => {
  assert.match(registry, /module\.id === "sourcing-engine"/);
  assert.match(registry, /title: "소싱센터"/);
  assert.match(registry, /route: "\/sourcing-center"/);
  assert.match(registry, /actionLabel: "소싱센터 열기"/);
  assert.match(registry, /전체 소싱 흐름 · 한눈에 보기/);
});

test("sourcing center opens the full sourcing pipeline in plain Korean", () => {
  const requiredRoutes = [
    "/collector-setup",
    "/extension-preview",
    "/candidate-processing",
    "/naver-validation",
    "/shopping-insight",
    "/market-demand-score",
    "/supply-evidence-1688",
    "/direct-offer-resolver",
    "/supply-fact-resolver",
    "/profitability-plan",
    "/market-price-check",
    "/decision-readiness",
    "/ai-detail-preflight",
    "/test-order-plan",
  ];
  for (const route of requiredRoutes) assert.match(page, new RegExp(route.replaceAll("/", "\\/")));

  assert.match(page, /1688 후보 수집부터 한국 수요 확인/);
  assert.match(page, /실제 공급상품 고르기/);
  assert.match(page, /정확한 옵션·단가 확인/);
  assert.match(page, /수익이 남는지 계산/);
  assert.match(page, /AI 상세페이지 2장 시험/);
  assert.match(page, /소액 테스트 발주 계획/);
});

test("sourcing center surfaces the live next action without blocking manual navigation", () => {
  assert.match(page, /\/api\/integrations\/pipeline-status/);
  assert.match(page, /x-commerce-os-integration-secret/);
  assert.match(page, /SOURCING_ENGINE_PROTECTION_BYPASS/);
  assert.match(page, /지금 할 일/);
  assert.match(page, /실시간 상태를 읽지 못했습니다/);
  assert.match(page, /각 단계 버튼은 정상적으로 열립니다/);
  assert.match(page, /TEST_READY 후보만 보는 구조/);
});

test("sourcing center explains the closed-loop replenishment policy and operator action", () => {
  assert.match(page, /운영 루프/);
  assert.match(page, /후보 풀이 소진됐을 때만 보충/);
  assert.match(page, /신규 후보 보충/);
  assert.match(page, /현재 사람 개입/);
  assert.match(page, /이번 최소행동/);
  assert.match(page, /operatorActionLabel/);
  assert.match(page, /afterAction/);
  assert.match(page, /automaticContinuation/);
  assert.match(page, /1688 브라우저 화면에서 후보를 한 번 수집·저장/);
  assert.match(page, /AI 의미분석·NAVER·Shopping Insight/);
  assert.match(page, /운영 중에도 후보 풀이 소진됐을 때만 다시 호출/);
});

test("sourcing center separates upstream funnel counts from final decision counts", () => {
  assert.match(page, /confirmedOpportunityCandidates/);
  assert.match(page, /supplyAnchorResolvedCandidates/);
  assert.match(page, /complexityRejectedCandidates/);
  assert.match(page, /supplyPendingCandidates/);
  assert.match(page, /decisionCandidates/);
  assert.match(page, /처음 검증 후보/);
  assert.match(page, /공급상품 확정/);
  assert.match(page, /운영복잡 제외/);
  assert.match(page, /공급 선택 대기/);
  assert.match(page, /최종 판단 대상/);
  assert.match(page, /단순 합계로 더하지 않습니다/);
});
