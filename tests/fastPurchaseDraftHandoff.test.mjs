import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [handoff, queue, route, actions] = await Promise.all([
  readFile("src/lib/fastPurchaseDraftHandoff.ts", "utf8"),
  readFile("src/lib/purchasePlanDraftQueue.ts", "utf8"),
  readFile("src/app/api/fast-purchase/drafts/queue/route.ts", "utf8"),
  readFile("src/components/fast-purchase-mvp/FastPurchaseDraftActions.tsx", "utf8"),
]);

test("legacy handoff remains available for backward compatibility", () => {
  assert.match(handoff, /loadFastPurchaseInternalDrafts/);
  assert.match(handoff, /loadProductPlanningSnapshot/);
  assert.match(handoff, /enqueuePurchasePlanDraft/);
  assert.match(handoff, /sourceRunId: draftId/);
  assert.match(route, /isSameOriginOpsRequest/);
});

test("legacy queue still refuses non-reserved or already progressing drafts", () => {
  assert.match(handoff, /draft\.openQuantity <= 0/);
  assert.match(
    handoff,
    /draft\.orderedQuantity > 0 \|\| draft\.receivedQuantity > 0/,
  );
  assert.match(
    handoff,
    /line\.status !== "RESERVED" \|\| line\.openQuantity <= 0/,
  );
  assert.match(handoff, /FAST_PURCHASE_HANDOFF_ALREADY_PROGRESSING/);
});

test("legacy relay still never executes a 1688 order", () => {
  assert.match(handoff, /unitCostKrw: 0/);
  assert.match(handoff, /externalOrderExecuted: false/);
  assert.doesNotMatch(handoff, /orderedOn1688|unitPriceCny|payment/i);
});

test("legacy relay metadata remains B-code safe", () => {
  assert.match(handoff, /function handoffModelNumber/);
  assert.match(handoff, /\^LEGACY-/i);
  assert.match(handoff, /return barcode/);
  assert.match(handoff, /loadProductLaunchPurchaseMetadataByBarcode/);
  assert.match(
    queue,
    /supplierLink: normalizeSupplierLink\(item\.supplierLink\)/,
  );
});

test("operator fast-purchase UI now opens the Ops Center internal China draft directly", () => {
  assert.match(actions, /function internalChinaDraftUrl/);
  assert.match(actions, /\/china-order-manager\/drafts\//);
  assert.match(actions, /Ops Center 중국 주문초안 열기/);
  assert.match(actions, /중국 발주 준비는 같은 발주차시 Draft를 계속 사용합니다/);
  assert.match(actions, /OPS CENTER NATIVE/);
  assert.doesNotMatch(actions, /\/api\/fast-purchase\/drafts\/queue/);
  assert.doesNotMatch(actions, /orderManagerUrl|chatgpt\.site/);
});
