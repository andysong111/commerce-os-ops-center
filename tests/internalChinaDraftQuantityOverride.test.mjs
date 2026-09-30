import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const helper = await readFile(
  new URL("../src/lib/internalChinaDraftQuantityOverride.ts", import.meta.url),
  "utf8",
);
const route = await readFile(
  new URL(
    "../src/app/api/china-order-manager/drafts/[draftId]/quantity/route.ts",
    import.meta.url,
  ),
  "utf8",
);
const draftRoute = await readFile(
  new URL(
    "../src/app/api/china-order-manager/drafts/[draftId]/route.ts",
    import.meta.url,
  ),
  "utf8",
);
const page = await readFile(
  new URL("../src/app/china-order-manager/drafts/[draftId]/page.tsx", import.meta.url),
  "utf8",
);
const component = await readFile(
  new URL(
    "../src/components/china-order-manager/InternalChinaDraftQuantityEditor.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("quantity override stores an absolute 1..9999 target without executing 1688", () => {
  assert.match(helper, /INTERNAL_CHINA_PURCHASE_QUANTITY_OVERRIDE/);
  assert.match(helper, /targetQuantity/);
  assert.match(helper, /quantity < 1 \|\| quantity > QUANTITY_MAX/);
  assert.match(helper, /externalOrderExecuted: false/);
  assert.doesNotMatch(helper, /placeOrder|payOrder|checkout/i);
});

test("draft page overlays operator quantities while normal metadata save strips quantity", () => {
  assert.match(page, /loadInternalChinaDraftWithQuantityOverrides/);
  assert.match(page, /InternalChinaDraftQuantityEditor/);
  assert.match(draftRoute, /stripDraftInputQuantities/);
  assert.match(draftRoute, /loadInternalChinaDraftWithQuantityOverrides/);
});

test("draft mutations and purchase-cost overlays honor the explicit cycle month", () => {
  assert.match(draftRoute, /assertInternalChinaMonthlyPurchaseOpen\(draft\.cycleMonth\)/);
  assert.match(route, /assertInternalChinaMonthlyPurchaseOpen\(base\.cycleMonth\)/);
  assert.match(helper, /loadInternalChinaMonthlyPurchaseSummary\(draft\.cycleMonth\)/);
  assert.doesNotMatch(draftRoute, /seoulCalendarMonth\(draft\.sourceUpdatedAt\)/);
  assert.doesNotMatch(route, /seoulCalendarMonth\(base\.sourceUpdatedAt\)/);
  assert.doesNotMatch(helper, /seoulCalendarMonth\(draft\.sourceUpdatedAt\)/);
});

test("quantity editor is existing-B-code only and reloads after a successful save", () => {
  assert.match(route, /INTERNAL_CHINA_QUANTITY_BARCODE_NOT_IN_DRAFT/);
  assert.match(route, /base\.lines\.some/);
  assert.match(component, /수량 변경 저장/);
  assert.match(component, /window\.location\.reload/);
  assert.match(component, /1개 이상 9,999개 이하/);
});

test("ORDERED correction carries lower quantities into cancellation and higher quantities into ordered amount", () => {
  assert.match(helper, /recordOrderedQuantityOverrideCorrections/);
  assert.match(helper, /downwardDelta/);
  assert.match(helper, /cancelledQuantity/);
  assert.match(helper, /upwardDelta/);
  assert.match(helper, /orderedQuantity/);
  assert.match(helper, /manualAddition: true/);
  assert.match(draftRoute, /recordOrderedQuantityOverrideCorrections/);
});
