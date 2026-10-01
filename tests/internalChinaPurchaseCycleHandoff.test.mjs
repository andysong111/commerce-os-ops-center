import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [handoff, draftReader, panel, fastPurchase] = await Promise.all([
  readFile("src/lib/internalChinaPurchaseCycleHandoff.ts", "utf8"),
  readFile("src/lib/fastPurchaseInternalDraft.ts", "utf8"),
  readFile("src/components/fast-purchase-mvp/PreviousPurchaseCycleHandoff.tsx", "utf8"),
  readFile("src/app/fast-purchase-mvp/page.tsx", "utf8"),
]);

test("prior-cycle handoff derives the previous month and only counts actually ordered drafts", () => {
  assert.ok(handoff.includes("previousCalendarMonth(currentCycleMonth)"));
  assert.ok(handoff.includes("draft.cycleMonth === previousCycleMonth && draft.orderedQuantity > 0"));
  assert.ok(handoff.includes("orderedQuantity"));
  assert.ok(handoff.includes("receivedQuantity"));
  assert.ok(handoff.includes("cancelledQuantity"));
  assert.ok(draftReader.includes("sum + line.cancelledQuantity"));
  assert.ok(handoff.includes("openQuantity"));
});

test("received plus explicitly cancelled prior orders are complete only when outstanding quantity is zero", () => {
  assert.ok(handoff.includes("receivedQuantity + cancelledQuantity >= orderedQuantity"));
  assert.ok(handoff.includes('receiptState: StageState'));
  assert.ok(handoff.includes("quantityImpactReady"));
});

test("landed cost close is checked against every prior ordered draft", () => {
  assert.ok(handoff.includes("loadStoredInternalChinaForwarderClose(draft.draftId)"));
  assert.ok(handoff.includes("landedCostCloses.every"));
  assert.ok(handoff.includes("close?.cycleMonth === previousCycleMonth"));
});

test("price verification joins approval to the prior ordered draft and matches the live browser-readback fingerprint", () => {
  assert.ok(handoff.includes("INTERNAL_CHINA_GROUP_COST_PRICE_APPROVAL"));
  assert.ok(handoff.includes("proposalSourceEventId"));
  assert.ok(handoff.includes("proposalSourceEventId.endsWith(draftId)"));
  assert.ok(handoff.includes("proposalFingerprint"));
  assert.ok(handoff.includes("INTERNAL_CHINA_GROUP_COST_PRICE_BROWSER_READBACK"));
  assert.ok(handoff.includes("snapshot.proposalFingerprint"));
  assert.ok(handoff.includes("snapshot.mallCheckCount"));
  assert.ok(handoff.includes("snapshot.mallMatchCount"));
  assert.ok(handoff.includes("snapshot.mallMismatchCount"));
  assert.ok(handoff.includes("snapshot.mallMissingCount"));
  assert.ok(handoff.includes("snapshot.failedGoodsKeyCount"));
  assert.ok(handoff.includes('text(snapshot.state) === "VERIFIED"'));
  assert.ok(handoff.includes("verifiedGoodsKeyCount === goodsKeyCount"));
  assert.ok(handoff.includes("matchedMallPriceCount === totalMallTargetCount"));
  assert.ok(handoff.includes("mismatchMallPriceCount === 0"));
  assert.ok(handoff.includes("missingMallPriceCount === 0"));
  assert.ok(handoff.includes("errorGoodsKeyCount === 0"));
});

test("funding and price evidence never write or change current purchase quantities", () => {
  assert.ok(handoff.includes("loadInternalChinaFundingCloseByCycleMonth"));
  assert.ok(handoff.includes("previousDrafts.length === 1"));
  assert.ok(handoff.includes("fundingClose?.draftId === previousDrafts[0].draftId"));
  assert.ok(handoff.includes("fundingClose.cycleMonth === previousCycleMonth"));
  assert.ok(handoff.includes("fundingClose.actualTotalOutflowKrw > 0"));
  assert.equal(handoff.includes('method: "POST"'), false);
  assert.equal(handoff.includes('method: "PATCH"'), false);
  assert.ok(panel.includes("이번 월 발주예산이나 권장수량을 자동으로 더하거나 빼지 않습니다"));
  assert.ok(panel.includes("미입고"));
});

test("fast purchase loads the handoff in parallel and shows one consolidated previous-cycle panel", () => {
  assert.ok(fastPurchase.includes("loadInternalChinaPurchaseCycleHandoff"));
  assert.ok(fastPurchase.includes("PreviousPurchaseCycleHandoff"));
  assert.ok(fastPurchase.includes("Promise.all"));
  assert.ok(panel.includes("PREVIOUS CYCLE → CURRENT PURCHASE INPUT"));
  assert.ok(panel.includes("직전 사이클 정상 마감"));
  assert.ok(panel.includes("Shopling 가격검증"));
});
