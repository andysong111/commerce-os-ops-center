import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [draft, route, actions, page, internalOrderDraft, internalOrderRoute] = await Promise.all([
  readFile("src/lib/fastPurchaseInternalDraft.ts", "utf8"),
  readFile("src/app/api/fast-purchase/drafts/route.ts", "utf8"),
  readFile(
    "src/components/fast-purchase-mvp/FastPurchaseDraftActions.tsx",
    "utf8",
  ),
  readFile("src/app/fast-purchase-mvp/page.tsx", "utf8"),
  readFile("src/lib/internalChinaPurchaseDraft.ts", "utf8"),
  readFile("src/app/api/china-order-manager/drafts/[draftId]/route.ts", "utf8"),
]);

test("draft creation is tied to the exact current fast-purchase fingerprint and mode", () => {
  assert.match(draft, /loadFastPurchaseMvpResilient/);
  assert.match(draft, /report\.fingerprint !== input\.sourceFingerprint/);
  assert.match(draft, /FAST_PURCHASE_DRAFT_SOURCE_CHANGED/);
  assert.match(draft, /report\.dataMode !== input\.dataMode/);
  assert.match(draft, /FAST_PURCHASE_DRAFT_MODE_CHANGED/);
});

test("only shortage or stockout manual rows with positive quantities can enter a draft", () => {
  assert.match(
    draft,
    /current\.action !== "MANUAL_REVIEW" &&\s*current\.action !== "DEMAND_ONLY_REVIEW"/,
  );
  assert.match(draft, /raw\.stockSense !== "LOW" && raw\.stockSense !== "OUT"/);
  assert.match(draft, /plannedQuantity <= 0/);
  assert.match(draft, /FAST_PURCHASE_DRAFT_QUANTITY_REQUIRED/);
});

test("manual quantities may exceed the demand reference but never 9999", () => {
  assert.match(draft, /const MANUAL_QUANTITY_MAX = 9_999/);
  assert.match(draft, /plannedQuantity > MANUAL_QUANTITY_MAX/);
  assert.match(draft, /FAST_PURCHASE_DRAFT_QUANTITY_EXCEEDED/);
  assert.match(draft, /FAST_PURCHASE_DRAFT_REFERENCE_CHANGED/);
  assert.doesNotMatch(draft, /FAST_PURCHASE_DRAFT_REFERENCE_EXCEEDED/);
  assert.doesNotMatch(
    draft,
    /current\.action === "DEMAND_ONLY_REVIEW" && plannedQuantity > currentReference/,
  );
  assert.match(actions, /const MANUAL_QUANTITY_MAX = 9_999/);
  assert.match(
    actions,
    /Math\.min\(\s*integer\(entry\.plannedQuantity\),\s*MANUAL_QUANTITY_MAX/,
  );
  assert.doesNotMatch(
    actions,
    /Math\.min\(plannedQuantity, integer\(row\.referenceDemandQuantity\)\)/,
  );
});

test("operator purchase Drafts use on-demand run dates and allow multiple runs in one month", () => {
  assert.match(draft, /inferPurchaseRunCycleBasis/);
  assert.match(draft, /purchaseRunCycle\.cycleKey/);
  assert.match(draft, /purchaseRunCycle\.cycleStartDate/);
  assert.match(draft, /previousCycleStartDate/);
  assert.match(draft, /FAST_PURCHASE_CYCLE_ALREADY_USED/);
  assert.doesNotMatch(route, /loadInternalChinaMonthlyPurchaseClose/);
  assert.doesNotMatch(route, /FAST_PURCHASE_MONTHLY_CYCLE_ALREADY_USED/);
  assert.doesNotMatch(actions, /monthlyLocked/);
  assert.match(actions, /같은 달에도 여러/);
});

test("internal draft stores RESERVED commitment events but never ORDERED or external execution", () => {
  assert.match(draft, /status: "RESERVED"/);
  assert.match(draft, /requestedQuantity: line\.plannedQuantity/);
  assert.match(draft, /externalOrderExecuted: false/);
  assert.doesNotMatch(draft, /status: "ORDERED"/);
  assert.doesNotMatch(draft, /shopling|1688|world pay/i);
});

test("review Draft can hold the full candidate pool while actual execution keeps the 100-SKU ceiling", () => {
  assert.match(draft, /PURCHASE_DRAFT_REVIEW_LINE_LIMIT/);
  assert.match(draft, /input\.lines\.length > MAX_LINES/);
  assert.match(internalOrderDraft, /PURCHASE_DRAFT_EXECUTION_LINE_LIMIT/);
  assert.match(internalOrderDraft, /INTERNAL_CHINA_ORDER_LINE_LIMIT/);
  assert.match(internalOrderRoute, /실제 주문 후보를 100종 이하로 줄인 뒤 진행하세요/);
});

test("same-origin API is required for draft reads and writes", () => {
  assert.match(route, /isSameOriginOpsRequest/);
  assert.match(route, /export async function GET/);
  assert.match(route, /export async function POST/);
  assert.match(route, /FAST_PURCHASE_DRAFT_UNAUTHORIZED/);
});

test("browser action requires explicit confirmation before the on-demand internal write", () => {
  assert.match(actions, /window\.confirm/);
  assert.match(actions, /발주차시 Draft/);
  assert.match(actions, /실제 중국 주문·결제는 실행하지 않습니다/);
  assert.match(actions, /method: "POST"/);
  assert.match(page, /내부 Draft 가능 · 외부 자동주문 0/);
});
