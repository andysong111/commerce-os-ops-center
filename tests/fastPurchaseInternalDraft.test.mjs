import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [draft, route, actions, page] = await Promise.all([
  readFile("src/lib/fastPurchaseInternalDraft.ts", "utf8"),
  readFile("src/app/api/fast-purchase/drafts/route.ts", "utf8"),
  readFile(
    "src/components/fast-purchase-mvp/FastPurchaseDraftActions.tsx",
    "utf8",
  ),
  readFile("src/app/fast-purchase-mvp/page.tsx", "utf8"),
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

test("a calendar month can commit only one different internal purchase Draft", () => {
  assert.match(draft, /monthlyPurchaseCycleFor\(new Date\(\)\.toISOString\(\)\)/);
  assert.match(draft, /draft\.cycleMonth === cycleMonth/);
  assert.match(draft, /object\(line\.latestPayload\)\.cycleMonth/);
  assert.match(draft, /FAST_PURCHASE_MONTHLY_CYCLE_ALREADY_USED/);
  assert.match(route, /FAST_PURCHASE_MONTHLY_CYCLE_ALREADY_USED/);
  assert.match(actions, /monthlyLocked/);
  assert.match(actions, /발주차시 생성완료/);
});

test("internal draft stores RESERVED commitment events but never ORDERED or external execution", () => {
  assert.match(draft, /status: "RESERVED"/);
  assert.match(draft, /requestedQuantity: line\.plannedQuantity/);
  assert.match(draft, /externalOrderExecuted: false/);
  assert.doesNotMatch(draft, /status: "ORDERED"/);
  assert.doesNotMatch(draft, /shopling|1688|world pay/i);
});

test("same-origin API is required for draft reads and writes", () => {
  assert.match(route, /isSameOriginOpsRequest/);
  assert.match(route, /export async function GET/);
  assert.match(route, /export async function POST/);
  assert.match(route, /FAST_PURCHASE_DRAFT_UNAUTHORIZED/);
});

test("browser action requires explicit confirmation before the monthly internal write", () => {
  assert.match(actions, /window\.confirm/);
  assert.match(actions, /월간 발주 Draft/);
  assert.match(actions, /실제 중국 주문·결제는 실행하지 않습니다/);
  assert.match(actions, /method: "POST"/);
  assert.match(page, /내부 Draft 가능 · 외부 자동주문 0/);
});
