import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { normalizePurchaseDraftDirectEditRequest } from "../src/lib/internalChinaPurchaseDraftDirectEditCore.ts";

const helper = await readFile(
  new URL("../src/lib/internalChinaPurchaseDraftDirectEdit.ts", import.meta.url),
  "utf8",
);
const route = await readFile(
  new URL(
    "../src/app/api/china-order-manager/drafts/[draftId]/direct-edits/route.ts",
    import.meta.url,
  ),
  "utf8",
);
const workspace = await readFile(
  new URL(
    "../src/components/china-order-manager/InternalChinaPurchaseDraftWorkspaceV2.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("direct edit request keeps exact additions, removals and quantities without a recalculation payload", () => {
  assert.deepEqual(
    normalizePurchaseDraftDirectEditRequest({
      requestId: "edit_request_123",
      additions: [{ barcode: "bbc4-2", targetQuantity: 15 }],
      quantityChanges: [{ barcode: "BAA2-3", targetQuantity: 25 }],
      excludedBarcodes: ["BCC5-2"],
    }),
    {
      requestId: "edit_request_123",
      additions: [{ barcode: "BBC4-2", targetQuantity: 15 }],
      quantityChanges: [{ barcode: "BAA2-3", targetQuantity: 25 }],
      excludedBarcodes: ["BCC5-2"],
    },
  );
});

test("direct edit rejects conflicting targets and non-5-unit quantities", () => {
  assert.throws(
    () => normalizePurchaseDraftDirectEditRequest({
      requestId: "edit_request_456",
      additions: [{ barcode: "BBC4-2", targetQuantity: 7 }],
      quantityChanges: [],
      excludedBarcodes: [],
    }),
    /PURCHASE_DRAFT_DIRECT_EDIT_QUANTITY_INVALID/,
  );
  assert.throws(
    () => normalizePurchaseDraftDirectEditRequest({
      requestId: "edit_request_789",
      additions: [{ barcode: "BBC4-2", targetQuantity: 10 }],
      quantityChanges: [],
      excludedBarcodes: ["BBC4-2"],
    }),
    /PURCHASE_DRAFT_DIRECT_EDIT_CONFLICT:BBC4-2/,
  );
});

test("direct edit persists one atomic operation batch and verifies exact readback", () => {
  assert.match(helper, /JSON\.stringify\(operations\)/);
  assert.match(helper, /resolution=ignore-duplicates,return=representation/);
  assert.match(helper, /direct-edit:\$\{input\.requestId\}/);
  assert.match(helper, /loadInternalChinaDraftWithQuantityOverrides/);
  assert.match(helper, /PURCHASE_DRAFT_DIRECT_EDIT_READBACK_MISMATCH/);
  assert.match(helper, /externalOrderExecuted: false/);
  assert.doesNotMatch(helper, /placeOrder|checkout|payOrder/i);
});

test("same-origin direct edit route saves without invoking purchase recalculation", () => {
  assert.match(route, /isSameOriginOpsRequest/);
  assert.match(route, /applyInternalChinaPurchaseDraftDirectEdit/);
  assert.match(route, /assertInternalChinaMonthlyPurchaseOpen/);
  assert.match(route, /재계산 없이 현재 발주안/);
  assert.doesNotMatch(route, /recalculatePurchaseCycleDraftInline/);
});

test("workspace makes direct save primary and blocks recalculation while manual edits are pending", () => {
  assert.match(workspace, /\/direct-edits/);
  assert.match(workspace, /재계산 없이 변경 저장/);
  assert.match(workspace, /hasPendingDirectEdits/);
  assert.match(workspace, /savingDirectEdits \|\|[\s\S]*hasPendingDirectEdits/);
  assert.match(workspace, /body\.overrides/);
  assert.match(workspace, /router\.refresh\(\)/);
});
