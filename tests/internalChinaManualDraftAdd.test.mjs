import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const helper = await readFile(
  new URL("../src/lib/internalChinaPurchaseDraftManualAdd.ts", import.meta.url),
  "utf8",
);
const route = await readFile(
  new URL(
    "../src/app/api/china-order-manager/drafts/[draftId]/manual-lines/route.ts",
    import.meta.url,
  ),
  "utf8",
);
const component = await readFile(
  new URL(
    "../src/components/china-order-manager/InternalChinaManualDraftLineAdder.tsx",
    import.meta.url,
  ),
  "utf8",
);
const page = await readFile(
  new URL("../src/app/china-order-manager/drafts/[draftId]/page.tsx", import.meta.url),
  "utf8",
);

test("manual addition reserves into the existing monthly draft instead of creating a new draft", () => {
  assert.match(helper, /sourceRunId: draft\.draftId/);
  assert.match(helper, /status: "RESERVED"/);
  assert.match(helper, /requestedQuantity: targetQuantity/);
  assert.match(helper, /manualAddition: true/);
  assert.match(helper, /externalOrderExecuted: false/);
});

test("manual addition validates active Product Master B-codes and caps total quantity", () => {
  assert.match(helper, /row\.skuActive !== false/);
  assert.match(helper, /INTERNAL_CHINA_MANUAL_ADD_BARCODE_NOT_ACTIVE/);
  assert.match(helper, /MANUAL_QUANTITY_MAX = 9_999/);
  assert.match(helper, /INTERNAL_CHINA_MANUAL_ADD_QUANTITY_EXCEEDED/);
});

test("manual addition search also uses product-launch model names and sale options", () => {
  assert.match(helper, /loadProductLaunchPurchaseMetadataByBarcode/);
  assert.match(helper, /tracker\.byBarcode\.get\(barcode\)/);
  assert.match(helper, /trackerRow\?\.productName/);
  assert.match(helper, /trackerRow\?\.saleOption/);
  assert.match(helper, /joinedLabels/);
});

test("manual addition search supports comma-separated model, product and B-code terms", () => {
  assert.match(helper, /parseManualDraftSearchTerms/);
  assert.match(helper, /split\(\/\[,;\\n\\r\]\+\//);
  assert.match(helper, /bestSearchMatch/);
  assert.match(helper, /termIndex/);
  assert.match(helper, /RESULT_LIMIT_MAX = 200/);
  assert.match(component, /여러 개는 콤마로 구분/);
  assert.match(component, /aaa288, aaa131, BAF1-1/);
});

test("manual addition API is same-origin only and exposes search plus add", () => {
  assert.match(route, /isSameOriginOpsRequest/);
  assert.match(route, /export async function GET/);
  assert.match(route, /export async function POST/);
  assert.match(route, /searchInternalChinaManualDraftCandidates/);
  assert.match(route, /addInternalChinaManualDraftLine/);
  assert.match(route, /assertInternalChinaMonthlyPurchaseOpen\(draft\.cycleMonth\)/);
  assert.doesNotMatch(route, /seoulCalendarMonth\(draft\.sourceUpdatedAt\)/);
});

test("draft page exposes searchable B-code manual addition with open commitment warning", () => {
  assert.match(page, /InternalChinaManualDraftLineAdder/);
  assert.match(component, /추가할 B-code 검색/);
  assert.match(component, /다른 미입고/);
  assert.match(component, /현재 Draft에 추가/);
  assert.match(component, /추가수량 반영/);
  assert.match(component, /window\.location\.reload/);
});
