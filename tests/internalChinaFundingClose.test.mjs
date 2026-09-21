import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  engine,
  route,
  panel,
  history,
  handoff,
  handoffPanel,
  fastPurchasePage,
  workflow,
] = await Promise.all([
  readFile("src/lib/internalChinaFundingClose.ts", "utf8"),
  readFile("src/app/api/china-order-manager/funding-close/route.ts", "utf8"),
  readFile("src/components/china-order-manager/InternalChinaFundingClosePanel.tsx", "utf8"),
  readFile("src/components/china-order-manager/InternalChinaForwarderCloseHistory.tsx", "utf8"),
  readFile("src/lib/internalChinaPurchaseCycleHandoff.ts", "utf8"),
  readFile("src/components/fast-purchase-mvp/PreviousPurchaseCycleHandoff.tsx", "utf8"),
  readFile("src/app/fast-purchase-mvp/page.tsx", "utf8"),
  readFile(".github/workflows/china-order-ledger-ci.yml", "utf8"),
]);

test("funding close is a dedicated monthly ledger operation and never rewrites the landed-cost close", () => {
  assert.ok(engine.includes('"INTERNAL_CHINA_MONTHLY_FUNDING_CLOSE"'));
  assert.ok(engine.includes('const FORWARDER_OPERATION_TYPE = "INTERNAL_CHINA_FORWARDER_COST_CLOSE"'));
  assert.ok(engine.includes("readForwarderClose"));
  assert.ok(engine.includes("storeFundingClose"));
  assert.equal(engine.includes("method: \"PATCH\""), false);
});

test("monthly funding close treats WorldFirst transfer as allocation and calculates the Korean wallet and emergency reserve", () => {
  assert.ok(engine.includes("totalSpendingBudgetKrw = integer(budgetMonthRevenueKrw / 2)"));
  assert.ok(engine.includes("koreaAccountAvailableKrw = totalSpendingBudgetKrw - worldFirstTransferKrw"));
  assert.ok(engine.includes("koreaAccountRemainingKrw -") === false);
  assert.ok(engine.includes("koreaAccountAvailableKrw - koreaAccountSpentKrw"));
  assert.ok(engine.includes("emergencyReserveTransferKrw: koreaAccountRemainingKrw"));
  assert.ok(engine.includes("worldFirstEndingUsd"));
  assert.ok(engine.includes("worldFirstEndingCnh"));
});

test("funding close is only allowed after final landed cost and cannot understate Korean-account forwarder spending", () => {
  assert.ok(engine.includes("CHINA_FUNDING_CLOSE_FORWARDER_REQUIRED"));
  assert.ok(engine.includes("CHINA_FUNDING_CLOSE_KOREA_SPEND_BELOW_FORWARDER"));
  assert.ok(engine.includes("koreaAccountSpentKrw < actualForwarderCostKrw"));
  assert.ok(engine.includes("CHINA_FUNDING_CLOSE_KOREA_SPEND_EXCEEDED"));
});

test("funding close API is same-origin guarded and reports both wallets", () => {
  assert.ok(route.includes("isSameOriginOpsRequest"));
  assert.ok(route.includes("recordInternalChinaFundingClose"));
  assert.ok(route.includes("WorldFirst"));
  assert.ok(route.includes("한국계좌"));
  assert.ok(route.includes("비상금"));
  assert.ok(route.includes("USD"));
  assert.ok(route.includes("CNH"));
});

// The existing simplified funding UI intentionally retired wallet entry. Keep
// legacy engine math coverage above, but do not require removed input controls.
test("simplified funding close submits only the cycle identity and never fabricates wallet balances", () => {
  assert.ok(panel.includes("simplified: true"));
  assert.match(panel, /JSON\.stringify\(\{\s*draftId,\s*cycleMonth,\s*simplified: true,\s*\}\)/);
  assert.ok(panel.includes("입고와 배송대행 실제 원가 마감을 먼저 완료하세요"));
  assert.ok(panel.includes("disabled={saving || invalid}"));
  assert.ok(panel.includes("전체 지출가능금액"));
  assert.ok(panel.includes("확정 배송대행 실제비용"));
  assert.ok(panel.includes("WorldFirst 관련 세부 원장은 지금 단계에서는 수집·계산하지 않습니다"));
  assert.equal(/<input\b/.test(panel), false);
  assert.equal(panel.includes("worldFirstEndingUsd:"), false);
  assert.equal(panel.includes("worldFirstEndingCnh:"), false);
});

test("recent landed-cost history exposes the final funding close and keeps a monthly funding history", () => {
  assert.ok(history.includes("loadInternalChinaFundingClose"));
  assert.ok(history.includes("InternalChinaFundingClosePanel"));
  assert.ok(history.includes("월 자금 마감 이력"));
  assert.ok(history.includes("WorldFirst 송금"));
  assert.ok(history.includes("WF 기말 USD"));
  assert.ok(history.includes("WF 기말 CNH"));
  assert.ok(history.includes("비상금 적립"));
});

test("successful funding closes can be read by cycle month for the next purchase workspace", () => {
  assert.ok(engine.includes("loadRecentInternalChinaFundingCloses"));
  assert.ok(engine.includes("loadInternalChinaFundingCloseByCycleMonth"));
  assert.ok(engine.includes("status=eq.SUCCEEDED"));
  assert.ok(engine.includes("order=started_at.desc"));
  assert.ok(engine.includes("byCycleMonth"));
});

test("fast purchase receives funding evidence through the prior-cycle handoff without changing current budget math", () => {
  assert.ok(fastPurchasePage.includes("loadInternalChinaPurchaseCycleHandoff"));
  assert.ok(handoff.includes("loadInternalChinaFundingCloseByCycleMonth"));
  assert.ok(handoffPanel.includes("WorldFirst 기말잔액"));
  assert.ok(handoffPanel.includes("한국계좌 비상금 적립"));
  assert.ok(handoffPanel.includes("이번 월 발주예산이나 권장수량을 자동으로 더하거나 빼지 않습니다"));
  assert.ok(handoffPanel.includes("미입고"));
});

test("funding close regression is wired into China order CI", () => {
  assert.ok(workflow.includes("src/lib/internalChinaFundingClose.ts"));
  assert.ok(workflow.includes("src/lib/internalChinaPurchaseCycleHandoff.ts"));
  assert.ok(workflow.includes("src/app/api/china-order-manager/funding-close/route.ts"));
  assert.ok(workflow.includes("src/components/china-order-manager/InternalChinaFundingClosePanel.tsx"));
  assert.ok(workflow.includes("src/components/fast-purchase-mvp/PreviousPurchaseCycleHandoff.tsx"));
  assert.ok(workflow.includes("src/app/fast-purchase-mvp/page.tsx"));
  assert.ok(workflow.includes("tests/internalChinaFundingClose.test.mjs"));
});
