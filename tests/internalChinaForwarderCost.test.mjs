import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildInternalChinaActualPurchaseCostDraft } from "../src/lib/internalChinaActualPurchaseCostDraft.ts";

const [
  engine,
  storedClose,
  route,
  panel,
  historyPanel,
  fallbackPanel,
  page,
  receiptEngine,
  monthlyPriceSource,
  workflow,
] = await Promise.all([
  readFile("src/lib/internalChinaForwarderCost.ts", "utf8"),
  readFile("src/lib/internalChinaForwarderStoredClose.ts", "utf8"),
  readFile("src/app/api/china-order-manager/forwarder-cost/route.ts", "utf8"),
  readFile("src/components/china-order-manager/InternalChinaReceiptPanel.tsx", "utf8"),
  readFile("src/components/china-order-manager/InternalChinaForwarderCloseHistory.tsx", "utf8"),
  readFile("src/components/china-order-manager/InternalChinaForwarderCostFallback.tsx", "utf8"),
  readFile("src/app/china-order-manager/page.tsx", "utf8"),
  readFile("src/lib/internalChinaReceipt.ts", "utf8"),
  readFile("src/lib/monthlyPriceSource.ts", "utf8"),
  readFile(".github/workflows/china-order-ledger-ci.yml", "utf8"),
]);

test("actual forwarder charge closes the landed-cost multiplier instead of remaining a detached expense", () => {
  assert.ok(engine.includes('INTERNAL_CHINA_FORWARDER_COST_CLOSE'));
  assert.ok(engine.includes("actualCostKrw"));
  assert.ok(engine.includes("actualMultiplier"));
  assert.ok(engine.includes("appliesToProductUnitCost: true"));
  assert.ok(engine.includes("appliesToPriceAdjustment: true"));
  assert.equal(engine.includes("appliesToPriceGrade"), false);
  assert.ok(engine.includes("CHINA_FORWARDER_COST_RECEIPT_OPEN"));
});

test("landed-cost formula uses the payment-fee-inclusive order cost as its multiplier base", () => {
  assert.ok(engine.includes("(orderPaymentCost + actualForwarderCostKrw) / orderPaymentCost"));
  assert.ok(engine.includes("decimal(line.unitPriceCny) * line.quantity"));
  assert.ok(engine.includes("domesticChinaFreightKrw"));
  assert.ok(engine.includes("preFeeUnitKrw * draft.paymentFeeMultiplier * multiplier"));
});

test("China domestic freight is included before payment fee and landed-cost allocation", () => {
  assert.ok(engine.includes("function domesticChinaFreightKrw"));
  assert.ok(engine.includes("const productCost = productPurchaseCostKrw(draft)"));
  assert.ok(engine.includes("productCost + domesticFreight"));
  assert.ok(engine.includes("orderPaymentCost + actualCostKrw"));
  assert.ok(engine.includes("group.freightCny / group.quantity"));
});

test("receipt and forwarder cost use final barcode quantities with exact paid CNY instead of stale reservations", () => {
  const baseLine = {
    bundleUnit: 1, bundleUnitUpdatedAt: null, modelNo: "AAA001",
    modelName: "상품", productName: "상품", saleOption: "단품",
    chinaOption: "黑色", supplierLink: "https://detail.1688.com/offer/1.html",
    freightGroupId: "legacy", orderNumber: "", note: "", stockInputMode: "MANUAL",
  };
  const baseDraft = {
    draftId: "fast-purchase-draft:1234567890abcdef1234", cycleMonth: "2026-11",
    cycleMode: "ON_DEMAND", cycleKey: "2026-11-04", cycleStartDate: "2026-11-04",
    previousCycleStartDate: null, revenueRangeStartDate: null, revenueRangeEndDate: null,
    cycleBootstrap: false, status: "DRAFT", exchangeRateKrwPerCny: 230,
    internalOrderCostMultiplier: 1.5, paymentFeeMultiplier: 1.05,
    lineCount: 2, totalQuantity: 140, createdFrom: "FAST_PURCHASE_RESERVED",
    sourceUpdatedAt: "2026-11-04T00:00:00.000Z", savedAt: null,
    metadataWarnings: [], externalOrderExecuted: false,
    lines: [
      { ...baseLine, barcode: "BBA1-1", quantity: 100, unitPriceCny: 1, domesticChinaFreightCny: 0 },
      { ...baseLine, barcode: "BBB2-1", quantity: 40, unitPriceCny: 1, domesticChinaFreightCny: 0 },
    ],
  };
  const purchase = {
    cycleMonth: "2026-11", draftCount: 1, orderCount: 3, lineCount: 3,
    skuCount: 3, totalQuantity: 141, goodsPaidCny: 92,
    domesticChinaFreightCny: 8, serviceFeeCny: 0, actualOrderPaidCny: 100,
    actualOrderPaidKrwAtInternalFx: 23_000, exchangeRateKrwPerCny: 230,
    assignedLineCount: 3, unassignedLineCount: 0, importedFromActualOrder: false,
    cashFlowEarlyClose: false, latestRecordedAt: null,
    lines: [
      { draftId: baseDraft.draftId, barcode: "BBA1-1", modelNo: "AAA001", modelName: "상품", saleOption: "단품", chinaOption: "黑色", orderNumber: "1", supplierLink: baseLine.supplierLink, quantity: 5, goodsPaidCny: 40, domesticChinaFreightCny: 5, serviceFeeCny: 0, actualLinePaidCny: 45, actualLinePaidKrwAtInternalFx: 10_350, assigned: true },
      { draftId: baseDraft.draftId, barcode: "BBB2-1", modelNo: "AAA002", modelName: "상품2", saleOption: "흰색", chinaOption: "白色", orderNumber: "2", supplierLink: baseLine.supplierLink, quantity: 8, goodsPaidCny: 32, domesticChinaFreightCny: 3, serviceFeeCny: 0, actualLinePaidCny: 35, actualLinePaidKrwAtInternalFx: 8_050, assigned: true },
      { draftId: baseDraft.draftId, barcode: "BCC3-1", modelNo: "AAA003", modelName: "제외상품", saleOption: "단품", chinaOption: "红色", orderNumber: "3", supplierLink: baseLine.supplierLink, quantity: 1, goodsPaidCny: 20, domesticChinaFreightCny: 0, serviceFeeCny: 0, actualLinePaidCny: 20, actualLinePaidKrwAtInternalFx: 4_600, assigned: true },
    ],
  };
  const result = buildInternalChinaActualPurchaseCostDraft({
    baseDraft,
    purchase,
    barcodeEvidence: {
      draftId: baseDraft.draftId, cycleMonth: "2026-11", historyRecordId: "history",
      applicationNo: "1, 2", itemCount: 2, matchedItemCount: 2,
      recordUpdatedAt: "2026-11-19T00:00:00.000Z", evidenceHash: `sha256:${"a".repeat(64)}`,
      completedAt: "2026-11-21T00:00:00.000Z",
      lines: [{ barcode: "BBA1-1", quantity: 5 }, { barcode: "BBB2-1", quantity: 8 }],
    },
  });
  assert.equal(result.totalQuantity, 13);
  assert.equal(result.lines[0].unitPriceCny, 8);
  assert.equal(result.lines[0].domesticChinaFreightCny, 5);
  assert.equal(result.lines.some((line) => line.barcode === "BCC3-1"), false);
  assert.equal(result.actualOrderPaidKrwAtInternalFx, 18_400);
});

test("forwarder close always uses a legal operation-ledger status even when downstream sync needs attention", () => {
  assert.ok(engine.includes('status: "SUCCEEDED"'));
  assert.equal(engine.includes('? "SUCCEEDED" : "PARTIAL"'), false);
});

test("receipt close requires the exact forwarder amount only for the final receipt", () => {
  assert.ok(panel.includes("배송대행지 실제비용(원)"));
  assert.ok(panel.includes("fullReceiptPrepared"));
  assert.ok(panel.includes("actualForwarderCostKrw <= 0"));
  assert.ok(panel.includes('/api/china-order-manager/forwarder-cost'));
  assert.ok(panel.includes("부분입고"));
  assert.ok(panel.includes("최종 전량 입고"));
});

test("completed monthly drafts remain visible until actual landed cost is closed", () => {
  assert.ok(page.includes("hasActualOrderForReceiptWorkspace"));
  assert.ok(page.includes(".filter(() => hasReceiptWorkspace)"));
  assert.ok(page.includes("selectedDrafts"));
  assert.ok(page.includes("loadInternalChinaForwarderCostSummary"));
  assert.ok(page.includes("실제 원가 마감"));
});

test("recent closed monthly landed costs stay visible after the calendar month changes", () => {
  assert.ok(page.includes("loadRecentStoredInternalChinaForwarderCloses(12)"));
  assert.ok(page.includes("입고확정일별 발주 이력"));
  assert.ok(page.includes("selectedForwarderCloses"));
  assert.ok(storedClose.includes("loadRecentStoredInternalChinaForwarderCloses"));
  assert.ok(storedClose.includes("order=started_at.desc"));
  assert.ok(historyPanel.includes("최근 마감 원가"));
  assert.ok(historyPanel.includes("매입금액(중국내운임 포함)"));
  assert.ok(historyPanel.includes("실제 부대비용"));
  assert.ok(historyPanel.includes("실제 총지출"));
  assert.ok(historyPanel.includes("실제 도착 원가배수"));
  assert.ok(historyPanel.includes("결제수수료"));
  assert.ok(
    historyPanel.includes(
      "배송대행 마감 후에는 결제수수료 1.05는 유지하고 1.50만 실제 배송대행·관부가세 비용으로 교체",
    ),
  );
  assert.ok(historyPanel.includes("과거 주문 기록의 저장값은 소급 변경하지 않습니다"));
});

test("landed-cost close shows total monthly spend budget and remaining cash against actual outflow", () => {
  assert.ok(historyPanel.includes("aggregateByCycleMonth"));
  assert.ok(historyPanel.includes("previousCalendarMonth"));
  assert.ok(historyPanel.includes("loadCalendarMonthNormalRevenue"));
  assert.ok(historyPanel.includes("totalSpendingBudgetKrw"));
  assert.ok(historyPanel.includes("remainingAfterSpendKrw"));
  assert.ok(historyPanel.includes("budgetMonthRevenueKrw / 2"));
  assert.ok(historyPanel.includes("월 전체 지출가능금액"));
  assert.ok(historyPanel.includes("사용 후 남은금액"));
  assert.ok(historyPanel.includes("실제 총지출"));
  assert.ok(historyPanel.includes("예산 기준월"));
  assert.ok(historyPanel.includes("기준 정상매출"));
  assert.ok(historyPanel.includes("지출 사용률"));
  assert.ok(
    historyPanel.includes(
      "월 전체 지출가능금액 = 직전 달력월 정상매출에서 에이블리 정상 주문당 무료배송 부담 3,000원을 차감한 뒤 ÷ 2",
    ),
  );
  assert.ok(
    historyPanel.includes(
      "사용 후 남은금액 = 전체 지출가능금액 - 실제 총지출",
    ),
  );
  assert.equal(historyPanel.includes("월 상품주문 가능액"), false);
  assert.equal(historyPanel.includes("미사용 상품주문 예산"), false);
});

test("China order manager fails fast instead of exhausting the Vercel function timeout", () => {
  assert.ok(page.includes("FORWARDER_TIMEOUT_MS = 4_500"));
  assert.ok(page.includes("METADATA_TIMEOUT_MS = 2_500"));
  assert.ok(page.includes("Promise.race"));
  assert.ok(page.includes("실시간 원가요약 조회가 4.5초를 넘었습니다"));
  assert.ok(page.includes("원장은 변경되지 않았습니다. 잠시 뒤 새로고침하세요"));
});

test("landed-cost summary uses the stored 1688 snapshot fast path before slow product metadata fallback", () => {
  assert.ok(engine.includes("loadStoredInternalChinaPurchaseDraftForCost"));
  const storedDraftIndex = engine.indexOf("loadStoredInternalChinaPurchaseDraftForCost(draftId)");
  const slowDraftIndex = engine.indexOf("loadInternalChinaPurchaseDraft(draftId)", storedDraftIndex);
  assert.ok(storedDraftIndex >= 0);
  assert.ok(slowDraftIndex > storedDraftIndex);
  assert.ok(engine.includes("storedDraft ?? await loadInternalChinaPurchaseDraft(draftId)"));
});

test("stored forwarder close is preserved as audit evidence while current totals are rebuilt from the canonical order ledger", () => {
  const storedIndex = page.indexOf("const stored = forwarderCloses.find");
  const summaryIndex = page.indexOf("loadInternalChinaForwarderCostSummary", storedIndex);
  assert.ok(storedIndex >= 0);
  assert.ok(summaryIndex > storedIndex);
  assert.ok(engine.includes("export function buildInternalChinaForwarderCostSummaryFromDraft"));
  assert.ok(page.includes("effectiveForwarderByDraft"));
  assert.ok(page.includes("selectedEffectiveForwarderCloses"));
  assert.ok(page.includes("과거 저장 원가를 현재 확정 1688 주문원장 기준으로 재계산해 표시합니다."));
  assert.ok(monthlyPriceSource.includes("buildInternalChinaForwarderCostSummaryFromDraft"));
  assert.ok(monthlyPriceSource.includes("MONTHLY_PRICE_LEGACY_CLOSE_REBASED"));
  assert.ok(monthlyPriceSource.includes("storedClose"));
  assert.ok(monthlyPriceSource.includes("effectiveClose: close"));
  assert.ok(route.includes("loadStoredInternalChinaForwarderClose"));
  assert.ok(storedClose.includes("source_event_id=eq."));
  assert.ok(storedClose.includes("internal-china-forwarder-cost:${draftId}"));
  assert.ok(storedClose.includes("READ_TIMEOUT_MS = 1_800"));
  assert.ok(storedClose.includes("actualMultiplier"));
  assert.ok(storedClose.includes("receiptCostReconciliation"));
  assert.ok(storedClose.includes("appliesToPriceAdjustment: true"));
  assert.equal(storedClose.includes("appliesToPriceGrade"), false);
});

test("duplicate forwarder close is fail-closed at the write boundary", () => {
  assert.ok(route.includes("await loadStoredInternalChinaForwarderClose(input.draftId)"));
  assert.ok(route.includes("CHINA_FORWARDER_COST_ALREADY_CLOSED"));
  assert.ok(route.includes("기존 마감값을 유지합니다"));
  assert.ok(route.includes("? 409"));
});

test("forwarder amount fallback remains available only as a recovery UI while the API rechecks stored close", () => {
  assert.ok(page.includes("InternalChinaForwarderCostFallback"));
  assert.ok(fallbackPanel.includes("배송대행지 실제비용(원)"));
  assert.ok(fallbackPanel.includes("배송대행 비용 · 원가 마감"));
  assert.ok(fallbackPanel.includes('/api/china-order-manager/forwarder-cost'));
  assert.ok(fallbackPanel.includes("실제 도착 원가배수 = (결제원가 + 배송대행지 실제비용) ÷ 결제원가"));
  assert.ok(fallbackPanel.includes("결제수수료 1.05는 유지"));
  assert.ok(route.includes("loadStoredInternalChinaForwarderClose"));
  assert.equal(fallbackPanel.includes("상품등급"), false);
});

test("normal receipt panel previews the actual multiplier and downstream cost semantics", () => {
  assert.ok(panel.includes("actualMultiplierPreview"));
  assert.ok(panel.includes("forwarderCost.domesticChinaFreightKrw"));
  assert.ok(panel.includes("forwarderCost.orderPaymentCostKrw"));
  assert.ok(panel.includes("실제 도착 원가배수 = (결제원가 + 배송대행지 실제비용) ÷ 결제원가"));
  assert.ok(panel.includes("최종 SKU 매입원가는 SKU별 결제원가 × 실제 도착 원가배수"));
  assert.ok(panel.includes("실제 판매가격은 별도 승인 절차 없이 즉시 변경하지 않습니다"));
  assert.ok(panel.includes("월 가격조정으로 이동"));
  assert.ok(panel.includes("#monthly-price"));
  assert.ok(page.includes("MonthlyPricePanel"));
  assert.ok(page.includes("ready={receiptDone && forwarderDone}"));
  assert.equal(panel.includes("상품등급"), false);
});

test("forwarder cost API reports the actual multiplier and landed receipt-cost synchronization", () => {
  assert.ok(route.includes("isSameOriginOpsRequest"));
  assert.ok(route.includes("recordInternalChinaForwarderCost"));
  assert.ok(route.includes("실제 원가배수"));
  assert.ok(route.includes("결제수수료 ×"));
  assert.ok(route.includes("최종 SKU 매입원가는 SKU별 결제원가 × 실제 도착 원가배수"));
  assert.ok(route.includes("이후 가격조정 판단에 사용합니다"));
  assert.equal(route.includes("상품등급"), false);
});

test("initial receipt still excludes the temporary 1.50 until actual forwarder cost is known", () => {
  assert.ok(receiptEngine.includes("actualUnitCny * draft.exchangeRateKrwPerCny"));
  assert.equal(receiptEngine.includes("draft.internalOrderCostMultiplier"), false);
});

test("closing the forwarding expense rewrites same-cycle receipt costs with the actual multiplier before Product Master sync", () => {
  assert.ok(engine.includes("readPriceAdjustmentReceiptCache"));
  assert.ok(engine.includes("mergePriceAdjustmentReceiptCachePage"));
  assert.ok(engine.includes('row.id.startsWith("china-receipt:")'));
  assert.ok(engine.includes("landedCostMultiplier(draft, actualForwarderCostKrw)"));
  assert.ok(engine.includes("unitCostKrw: nextUnitCostKrw"));
  assert.ok(engine.includes("pushCanonicalProductMasterSnapshotFromTrackerState"));
  assert.ok(route.includes("Product Master에 재동기화했습니다"));
});

test("the forwarder regression suite is permanently wired into China Order Ledger CI", () => {
  assert.ok(workflow.includes('src/lib/internalChinaForwarderCost.ts'));
  assert.ok(workflow.includes('src/lib/internalChinaForwarderStoredClose.ts'));
  assert.ok(workflow.includes('src/components/china-order-manager/InternalChinaForwarderCloseHistory.tsx'));
  assert.ok(workflow.includes('src/app/api/china-order-manager/forwarder-cost/route.ts'));
  assert.ok(workflow.includes('tests/internalChinaForwarderCost.test.mjs'));
  assert.ok(workflow.includes('node --experimental-strip-types --test'));
});
