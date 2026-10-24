import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("purchase-run start prepares every required source before opening the draft builder", async () => {
  const service = await read("../src/lib/purchaseRunPreparation.ts");
  const route = await read("../src/app/api/china-order-manager/purchase-runs/start/route.ts");
  assert.match(service, /sameDayPurchaseRun/);
  assert.match(service, /replaceablePriorPurchaseRun/);
  assert.match(service, /ensurePurchaseRunSalesRequest/);
  assert.match(service, /ensurePurchaseRunDemandRefreshRequest/);
  assert.match(service, /runProductDecisionLiveRefreshStep/);
  assert.match(service, /최신 주문·클레임을 읽고 있습니다/);
  assert.match(service, /runProductMasterShoplingSalesEventSyncStep/);
  assert.match(service, /loadPostApplyCanonicalReconciliation/);
  assert.match(service, /loadInventoryVerificationPriority/);
  assert.match(service, /prepared:\s*"1"/);
  assert.match(service, /replaceable\?\.draftId/);
  assert.match(route, /isSameOriginOpsRequest/);
  assert.match(route, /externalOrderExecuted:\s*false/);
  assert.match(route, /validationError \? 400 : 503/);
  assert.doesNotMatch(service, /checkout|payment|submitOrder|externalOrderExecuted:\s*true/i);
});

test("main manager is run-based and exposes the one-click start action", async () => {
  const page = await read("../src/app/china-order-manager/page.tsx");
  const startButton = await read("../src/components/china-order-manager/PurchaseRunStartButton.tsx");
  const nav = await read("../src/components/china-order-manager/ChinaOrderManagerNav.tsx");
  const freightBridge = await read("../src/app/freight-barcode-request/monthly/page.tsx");
  const freightClient = await read("../src/components/freight-barcode-request/FreightMonthlyOrderContextBridge.tsx");
  assert.match(page, /발주차시·입고 관리/);
  assert.match(page, /입고확정일별 발주 이력/);
  assert.match(page, /PurchaseRunStartButton/);
  assert.match(page, /InternalChinaPurchaseDraftGuide/);
  assert.match(page, /filterVisiblePurchaseRunHistory/);
  assert.doesNotMatch(page, /종료 이력|releasedGroups|releasedCount/);
  assert.match(page, /sourceRunId === selectedDraftId/);
  assert.match(page, /freight-barcode-request\/monthly\?month=.*&draft=/);
  assert.match(startButton, /이번 발주차시 시작/);
  assert.match(startButton, /이번 발주에 사용할 총현금/);
  assert.match(startButton, /신규상품 소싱예산 비율/);
  assert.match(startButton, /최신 판매·클레임·재고·미입고 자료/);
  assert.match(startButton, /최신자료 준비 중/);
  assert.match(startButton, /aria-label="발주차시 시작 창 닫기"/);
  assert.doesNotMatch(startButton, /onClick=\{close\}\s+disabled=\{starting\}/);
  assert.match(page, /중국 주문초안 ·/);
  assert.doesNotMatch(page, /SELECTED MONTH|월별 마감 이력|월 처리 단계/);
  assert.match(nav, /발주차시·입고/);
  assert.match(freightBridge, /selectInternalChinaPurchaseSummaryForDraft\(monthlySummary, draftId\)/);
  assert.match(freightBridge, /선택한 발주차시의 실제 1688 주문품/);
  assert.doesNotMatch(freightBridge, /월별 발주·입고 관리/);
  assert.match(freightClient, /savedAt: Date\.now\(\)/);
  assert.match(freightClient, /source=purchase-run/);
});
