import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [engine, page] = await Promise.all([
  readFile("src/lib/stage8InventoryVerificationPriority.ts", "utf8"),
  readFile("src/app/stage8-inventory-verification-priority/page.tsx", "utf8"),
]);

test("provisional inventory readiness is read only and joins canonical demand to Product Master inventory and planning", () => {
  assert.match(engine, /loadCanonicalPurchaseShadow/);
  assert.match(engine, /loadProductMasterInventoryCostReadiness/);
  assert.match(engine, /loadProductPlanningSnapshot/);
  assert.match(engine, /writesEnabled: false/);
  assert.match(page, /재고실사 필수/);
});

test("initial zero unverified inventory remains provisional advisory evidence instead of a stocktake blocker", () => {
  assert.match(engine, /"PROVISIONAL"/);
  assert.match(engine, /if \(row\.inventoryVerified\) return "VERIFIED"/);
  assert.match(engine, /return "PROVISIONAL"/);
  assert.match(engine, /PROVISIONAL_DECISION_EVIDENCE_REQUIRED/);
  assert.doesNotMatch(engine, /STOCKTAKE_REQUIRED/);
  assert.match(page, /INITIAL_ZERO의 0은 실제 재고 0이라는 뜻이 아닙니다/);
  assert.match(page, /INITIAL_ZERO\/UNVERIFIED는 PROVISIONAL이며 advisory 발주수량 계산에는 사용할 수 있습니다/);
  assert.match(page, /STOCKTAKE는 오류 교정용 선택 기능이지 필수 절차가 아닙니다/);
});

test("provisional quantity and open commitment are subtracted from gross demand for advisory math only", () => {
  assert.match(engine, /calculateNetRequirement/);
  assert.match(engine, /inventoryCalculationUsable/);
  assert.match(engine, /availableQuantity: inventoryCalculationUsable/);
  assert.match(engine, /inventory\?\.inventoryQuantity/);
  assert.match(engine, /ledgerCommitment: openCommitment/);
  assert.match(engine, /moq:/);
  assert.match(engine, /cartonQuantity:/);
  assert.match(page, /기존 gross 권장수량에서 현재 PROVISIONAL 수량과 중국 미입고 약정을 반영해 참고용 권장수량은 계산/);
  assert.match(page, /별도 안전증거 없이는 실제 Draft 실행대상이 아닙니다/);
});

test("negative or review inventory still fails closed", () => {
  assert.match(engine, /row\.inventoryRequiresReview \|\| row\.inventoryVerification === "REVIEW"/);
  assert.match(engine, /LEDGER_REVIEW_REQUIRED/);
  assert.match(page, /원장 음수·identity 충돌은 REVIEW로 차단/);
});

test("verified purchase cost remains a separate execution cost gate", () => {
  assert.match(engine, /!row\?\.hasVerifiedPurchaseCost/);
  assert.match(engine, /purchaseCostTrustSource/);
  assert.match(engine, /verifiedPurchaseUnitCostKrw/);
  assert.match(engine, /COST_CONFIRMATION_REQUIRED/);
});

test("sold out reset is the normal path from provisional to verified inventory", () => {
  assert.match(page, /품절 확인 후 SOLD_OUT_RESET=0 또는 다른 신뢰 가능한 기준점이 생기면 VERIFIED로 전환/);
  assert.match(page, /실제 품절 확인 시 SOLD_OUT_RESET=0을 기준점으로 만들고 그 이후 입고·판매부터 VERIFIED 재고로 운영/);
  assert.match(engine, /stocktakeRequiredCount: 0/);
});

test("provisional inventory can never become execution-ready from the point estimate alone", () => {
  assert.match(engine, /const executionInventoryEligible = mode === "VERIFIED"/);
  assert.match(engine, /const advisoryOnly = mode === "PROVISIONAL"/);
  assert.match(engine, /action === "NONE"/);
  assert.match(engine, /executionInventoryEligible/);
  assert.match(page, /PROVISIONAL ≠ VERIFIED/);
  assert.match(page, /PROVISIONAL 한 점 수량만으로 실제 발주 Draft를 실행하지 않습니다/);
});
