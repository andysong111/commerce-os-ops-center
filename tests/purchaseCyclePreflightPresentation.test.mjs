import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPurchaseCycleCandidateSummary,
  resolvePurchaseCycleCalculationButtonState,
  resolvePurchaseCycleNextAction,
} from "../src/lib/purchaseCyclePreflightPresentation.ts";

test("발주안 계산 버튼은 준비·진행·완료·재계산 상태를 구분한다", () => {
  assert.deepEqual(
    resolvePurchaseCycleCalculationButtonState({ pending: false, calculationComplete: false, configurationChanged: false }),
    { phase: "ready", label: "2. 준비된 후보로 발주안 계산", disabled: false },
  );
  assert.deepEqual(
    resolvePurchaseCycleCalculationButtonState({ pending: true, calculationComplete: false, configurationChanged: false }),
    { phase: "pending", label: "발주안 계산 중...", disabled: true },
  );
  assert.deepEqual(
    resolvePurchaseCycleCalculationButtonState({ pending: false, calculationComplete: true, configurationChanged: false }),
    { phase: "complete", label: "발주안 계산 완료", disabled: true },
  );
  assert.deepEqual(
    resolvePurchaseCycleCalculationButtonState({ pending: false, calculationComplete: true, configurationChanged: true }),
    { phase: "changed", label: "변경사항으로 다시 계산", disabled: false },
  );
});

test("수동 6상품·8옵션과 자동소싱 62개 제외 현황을 정확히 요약한다", () => {
  assert.equal(
    buildPurchaseCycleCandidateSummary({
      manualProductCount: 6,
      manualOptionCount: 8,
      automaticCandidateCount: 62,
      includedAutomaticCount: 0,
    }),
    "수동 추가 6상품·8옵션 유지 · 자동소싱 62개 중 포함 0개·제외 62개",
  );
});

test("자동소싱 포함 수는 전체 후보 수를 넘지 않는다", () => {
  assert.equal(
    buildPurchaseCycleCandidateSummary({
      manualProductCount: -1,
      manualOptionCount: Number.NaN,
      automaticCandidateCount: 3,
      includedAutomaticCount: 9,
    }),
    "수동 추가 0상품·0옵션 유지 · 자동소싱 3개 중 포함 3개·제외 0개",
  );
});

test("계산 전후의 다음 작업을 안내한다", () => {
  assert.deepEqual(
    resolvePurchaseCycleNextAction({ pending: false, calculationComplete: false, remainingActionCount: 0, draftReady: false }),
    {
      current: "수동상품과 자동소싱 포함 여부를 마지막으로 확인합니다.",
      next: "‘2. 준비된 후보로 발주안 계산’을 누릅니다.",
    },
  );
  assert.deepEqual(
    resolvePurchaseCycleNextAction({ pending: false, calculationComplete: true, remainingActionCount: 1, draftReady: false }),
    {
      current: "계산은 끝났고 확인할 항목이 1건 남았습니다.",
      next: "화면의 확인 항목을 처리한 뒤 내부 Draft를 저장합니다.",
    },
  );
  assert.deepEqual(
    resolvePurchaseCycleNextAction({ pending: false, calculationComplete: true, remainingActionCount: 0, draftReady: true }),
    {
      current: "발주초안 준비가 완료되었습니다.",
      next: "중국 주문초안에서 재고·수량을 확인하고 5-1 원가·운임 기록을 진행합니다.",
    },
  );
});
