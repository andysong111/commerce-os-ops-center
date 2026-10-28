import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [managerPage, draftPage, loadingPage, draftLoader, auditLoader, adjustmentLoader] =
  await Promise.all([
    readFile("src/app/china-order-manager/page.tsx", "utf8"),
    readFile("src/app/china-order-manager/drafts/[draftId]/page.tsx", "utf8"),
    readFile("src/app/china-order-manager/drafts/[draftId]/loading.tsx", "utf8"),
    readFile("src/lib/internalChinaPurchaseDraft.ts", "utf8"),
    readFile("src/lib/internalChinaPurchaseBudgetAudit.ts", "utf8"),
    readFile("src/lib/purchaseCycleDraftRegeneration.ts", "utf8"),
  ]);

test("both visible selected-draft buttons open the selected China draft", () => {
  assert.match(
    managerPage,
    /href=\{`\/china-order-manager\/drafts\/\$\{encodeURIComponent\(selectedDrafts\[0\]\.draftId\)\}`\}/,
  );
  assert.match(
    managerPage,
    /run\.draftId === selectedDraftId[\s\S]*\? `\/china-order-manager\/drafts\/\$\{encodeURIComponent\(run\.draftId\)\}`/,
  );
  assert.match(managerPage, /prefetch=\{false\}/);
});

test("draft navigation immediately renders a visible loading state", () => {
  assert.match(loadingPage, /주문초안을 여는 중입니다/);
  assert.match(loadingPage, /role="status"/);
  assert.match(loadingPage, /버튼 입력은 정상적으로 처리/);
});

test("the draft page reuses one order-ledger read across draft, budget and adjustments", () => {
  assert.equal(
    (draftPage.match(/loadChinaOrderLedger\(\)/g) ?? []).length,
    1,
  );
  assert.match(draftPage, /loadInternalChinaPurchaseDraft\(draftId, \{ ledger \}\)/);
  assert.match(
    draftPage,
    /loadInternalChinaPurchaseBudgetAudit\(draftId, \{ draft: baseDraft, ledger \}\)/,
  );
  assert.match(
    draftPage,
    /loadPurchaseDraftOperatorAdjustments\(draftId, \{ ledger \}\)/,
  );
  assert.match(draftLoader, /preloadedLedger \?\? await loadChinaOrderLedger\(\)/);
  assert.match(auditLoader, /options\?\.ledger \? Promise\.resolve\(options\.ledger\)/);
  assert.match(adjustmentLoader, /options\?\.ledger \?\? await loadChinaOrderLedger\(\)/);
});

test("independent product metadata reads start together", () => {
  assert.match(
    draftLoader,
    /const \[planningRead, trackerRead\] = await Promise\.all\(\[/,
  );
  assert.match(draftLoader, /loadProductPlanningSnapshot\(\)/);
  assert.match(draftLoader, /loadProductLaunchPurchaseMetadataByBarcode\(\)/);
});
