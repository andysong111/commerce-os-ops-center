import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildShoplingBlockedTransitionDetail,
  describeShoplingStockFailure,
} from "../src/lib/shoplingStockFailureDetail.ts";
import { shoplingStockResultDetail } from "../src/lib/shoplingStockResponsibility.ts";

test("HF98 preserves the exact Shopling state and explains the BAF3-3 pre-submit block", () => {
  const detail = buildShoplingBlockedTransitionDetail(
    new Error("SHOPLING_PRODUCT_STATUS_TRANSITION_BLOCKED:Z"),
    { barcode: "BAF3-3", desiredStatus: "SOLD_OUT" },
  );

  assert.ok(detail);
  assert.equal(detail.currentStatusCode, "Z");
  assert.equal(detail.currentStatusLabel, "삭제");
  assert.equal(detail.phaseLabel, "전송 전 · Shopling API 상태 검증");
  assert.equal(detail.transmissionStarted, false);
  assert.match(detail.message, /BAF3-3/);
  assert.match(detail.message, /Z\(삭제\)/);
  assert.match(detail.message, /파란 전송 버튼을 누르지 않았습니다/);
  assert.match(detail.nextAction, /재등록/);
});

test("HF98 never guesses an undocumented Shopling status label", () => {
  const detail = buildShoplingBlockedTransitionDetail(
    "SHOPLING_OPTION_STATUS_TRANSITION_BLOCKED:H",
    { barcode: "BAF3-3", desiredStatus: "SOLD_OUT" },
  );

  assert.ok(detail);
  assert.equal(detail.currentStatusCode, "H");
  assert.equal(detail.currentStatusLabel, "B/C 외 상태");
  assert.match(detail.message, /H\(B\/C 외 상태\)/);
  assert.match(detail.nextAction, /현재 상태 H/);
});

test("HF98 gives old coarse BAF3-3 records an honest fallback without inventing a status", () => {
  const result = shoplingStockResultDetail({
    outcome: "FAILED",
    message:
      "대상 상품이 판매/품절(B/C) 상태가 아니어서 자동 전환을 차단했습니다.",
    evidence: {
      code: "SHOPLING_STOCK_STATE_COALESCED_API_FAILED",
      browserMutationStarted: false,
      appliedApiCount: 0,
    },
  });

  assert.equal(result.stage, "SHOPLING_API_STOCK_STATE");
  assert.equal(result.failurePhaseLabel, "전송 전 · Shopling API 상태 검증");
  assert.equal(result.failureCurrentStatus, "당시 응답에 상태 원문 미저장");
  assert.match(result.failureImpact, /파란 전송 버튼/);
  assert.match(result.failureNextAction, /GOODS KEY/);
});

test("HF98 parses the new exact status message into the visible run detail", () => {
  const failure = describeShoplingStockFailure({
    outcome: "FAILED",
    code: "SHOPLING_STOCK_STATE_COALESCED_API_FAILED",
    message:
      "BAF3-3 · 현재 Shopling 상품 상태가 Z(삭제)라 자동 전환 허용 범위인 B(판매중)·C(품절)에 포함되지 않습니다.",
    browserMutationStarted: false,
  });

  assert.ok(failure);
  assert.equal(failure.failureCurrentStatus, "Z(삭제)");
  assert.match(failure.failureNextAction, /삭제 상품/);
});

test("HF98 route and run UI expose reason, transmission impact, and next action", async () => {
  const [route, panel] = await Promise.all([
    readFile(
      new URL(
        "../src/app/api/inventory-stock-control/shopling-option-status/route.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../src/components/china-order-manager/InventoryStockoutOperatorPanel.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(route, /buildShoplingBlockedTransitionDetail/);
  assert.match(route, /failureDetail: blockedTransition/);
  assert.match(panel, /중단 위치/);
  assert.match(panel, /확인된 상태/);
  assert.match(panel, /실패 원인/);
  assert.match(panel, /전송 여부/);
  assert.match(panel, /다음 조치/);
});
