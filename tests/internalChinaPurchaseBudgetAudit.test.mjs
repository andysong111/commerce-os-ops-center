import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [audit, page, card, monthlyRevenue, workspace] = await Promise.all([
  readFile("src/lib/internalChinaPurchaseBudgetAudit.ts", "utf8"),
  readFile("src/app/china-order-manager/drafts/[draftId]/page.tsx", "utf8"),
  readFile(
    "src/components/china-order-manager/InternalChinaPurchaseBudgetAudit.tsx",
    "utf8",
  ),
  readFile("src/lib/shopling/calendarMonthRevenue.ts", "utf8"),
  readFile(
    "src/components/china-order-manager/InternalChinaPurchaseDraftWorkspace.tsx",
    "utf8",
  ),
]);

test("China order draft budgets from the previous full calendar month", () => {
  assert.match(audit, /monthlyPurchaseCycleFor\(draft\.sourceUpdatedAt\)/);
  assert.match(audit, /loadCalendarMonthNormalRevenue\(cycle\.budgetMonth\)/);
  assert.match(audit, /budgetMonthRevenueKrw \/ 2/);
  assert.match(audit, /DEFAULT_PURCHASE_COST_MULTIPLIER/);
  assert.match(audit, /calculateProductOrderBudget/);
  assert.match(audit, /productOrderBudgetKrw/);
  assert.match(audit, /selectedDraftEstimatedProductCostKrw/);
  assert.match(audit, /selectedDraftEstimatedLandedCostKrw/);
  assert.doesNotMatch(audit, /recent30RevenueKrw \/ 2/);
});

test("closed calendar-month Shopling revenue is frozen in the Ops ledger", () => {
  assert.match(monthlyRevenue, /SHOPLING_CALENDAR_MONTH_REVENUE/);
  // Versioned purchase-budget revenue replaced the old gross-only helper.
  assert.match(monthlyRevenue, /calendarMonthPurchaseBudgetRevenue/);
  assert.match(monthlyRevenue, /PURCHASE_BUDGET_REVENUE_POLICY_VERSION/);
  assert.match(monthlyRevenue, /if \(!closedCalendarMonth\(input\.month\)\) return null/);
  assert.match(monthlyRevenue, /calendarMonthFrozen: true/);
  assert.match(monthlyRevenue, /resolution=ignore-duplicates/);
});

test("saved actual 1688 CNY price has priority over Product Master reference cost", () => {
  assert.match(audit, /actualUnitPriceCny = decimal\(line\.unitPriceCny\)/);
  assert.match(
    audit,
    /actualUnitPriceCny \* draft\.exchangeRateKrwPerCny/,
  );
  assert.match(audit, /effectiveUnitCostKrw = actualUnitCostKrw \|\| referenceUnitCost/);
  assert.match(audit, /costSource: "ACTUAL_1688" \| "REFERENCE" \| "MISSING"/);
  assert.match(audit, /actualPriceCount/);
  assert.match(audit, /referencePriceCount/);
  assert.match(card, /원가 적용 우선순위/);
  assert.match(card, /실제 1688 위안단가/);
});

test("manual draft quantities are compared with the engine allocated quantities", () => {
  assert.match(audit, /engineRecommendedQuantity/);
  assert.match(audit, /quantityDeltaFromEngine/);
  assert.match(audit, /quantityAboveEngineCount/);
  assert.match(audit, /quantityBelowEngineCount/);
});

test("other active RESERVED drafts are surfaced before the operator orders", () => {
  assert.match(audit, /otherActiveDraftCount/);
  assert.match(audit, /otherActiveDraftQuantity/);
  assert.match(audit, /otherActiveDraftEstimatedProductCostKrw/);
  assert.match(card, /다른 활성 Draft/);
  assert.match(card, /과거 Draft는 해제/);
});

test("calendar-month budget and internal standard cost are visible on the China draft page", () => {
  assert.match(page, /loadInternalChinaPurchaseBudgetAudit/);
  assert.match(page, /InternalChinaPurchaseBudgetAudit/);
  assert.match(page, /budgetAudit=\{budgetAudit\}/);
  assert.match(card, /매출원가 기준 발주예산 검증/);
  assert.match(card, /1일~말일 고정/);
  assert.match(card, /상품대금 발주한도/);
  assert.match(card, /현재 Draft 상품대금/);
  assert.match(card, /내부기준원가/);
  assert.match(card, /내부 주문 수수료율/);
  assert.match(card, /예산 초과/);
});

test("order workspace shows live budget usage before save and refreshes the server audit after save", () => {
  assert.match(workspace, /실시간 월간 발주예산 검증/);
  assert.match(workspace, /budgetAudit\.productOrderBudgetKrw/);
  assert.match(workspace, /calculations\.productKrw/);
  assert.match(workspace, /calculations\.budgetUsedPercent/);
  assert.match(workspace, /router\.refresh\(\)/);
  assert.match(workspace, /발주초안 저장/);
});
