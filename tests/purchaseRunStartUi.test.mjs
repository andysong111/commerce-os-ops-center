import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("purchase-run start reuses an unfinished run and creates only an internal draft", async () => {
  const service = await read("../src/lib/purchaseRunStart.ts");
  const route = await read("../src/app/api/china-order-manager/purchase-runs/start/route.ts");
  assert.match(service, /activePurchaseRun/);
  assert.match(service, /createPurchaseCyclePreflightDraft/);
  assert.match(service, /sourcingBudgetPercent:\s*0/);
  assert.match(route, /isSameOriginOpsRequest/);
  assert.match(route, /externalOrderExecuted:\s*false/);
  assert.doesNotMatch(service, /checkout|payment|submitOrder/i);
});

test("main manager is run-based and exposes the one-click start action", async () => {
  const page = await read("../src/app/china-order-manager/page.tsx");
  const startButton = await read("../src/components/china-order-manager/PurchaseRunStartButton.tsx");
  const nav = await read("../src/components/china-order-manager/ChinaOrderManagerNav.tsx");
  assert.match(page, /발주차시·입고 관리/);
  assert.match(page, /입고확정일별 발주 이력/);
  assert.match(page, /PurchaseRunStartButton/);
  assert.match(page, /InternalChinaPurchaseDraftGuide/);
  assert.match(page, /filterVisiblePurchaseRunHistory/);
  assert.doesNotMatch(page, /종료 이력|releasedGroups|releasedCount/);
  assert.match(page, /sourceRunId === selectedDraftId/);
  assert.match(startButton, /현재 발주 계속하기/);
  assert.match(startButton, /이번 발주 시작하기/);
  assert.doesNotMatch(page, /SELECTED MONTH|월별 마감 이력|월 처리 단계/);
  assert.match(nav, /발주차시·입고/);
});
