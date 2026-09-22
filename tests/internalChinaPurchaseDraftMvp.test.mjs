import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [engine, workspace, route, page, manager, fastActions, trackerMetadata] =
  await Promise.all([
    readFile("src/lib/internalChinaPurchaseDraft.ts", "utf8"),
    readFile(
      "src/components/china-order-manager/InternalChinaPurchaseDraftWorkspace.tsx",
      "utf8",
    ),
    readFile(
      "src/app/api/china-order-manager/drafts/[draftId]/route.ts",
      "utf8",
    ),
    readFile("src/app/china-order-manager/drafts/[draftId]/page.tsx", "utf8"),
    readFile("src/app/china-order-manager/page.tsx", "utf8"),
    readFile(
      "src/components/fast-purchase-mvp/FastPurchaseDraftActions.tsx",
      "utf8",
    ),
    readFile("src/lib/productLaunchPurchaseMetadata.ts", "utf8"),
  ]);

test("internal China draft starts from the existing fast-purchase RESERVED ledger", () => {
  assert.match(engine, /loadChinaOrderLedger/);
  assert.match(engine, /SOURCE_SYSTEM = "fast-purchase-mvp"/);
  assert.match(engine, /row\.sourceRunId === draftId/);
  assert.match(engine, /row\.openQuantity > 0/);
  assert.match(engine, /FAST_PURCHASE_RESERVED/);
});

test("closed draft excludes fully cancelled quantities from cost and quantity reconstruction", () => {
  assert.match(engine, /function effectiveCommitmentQuantity/);
  assert.match(engine, /row\.committedQuantity - row\.cancelledQuantity/);
  assert.match(engine, /effectiveCommitmentQuantity\(row\) > 0/);
  assert.match(engine, /effectiveCommitmentQuantity\(commitment\)/);
});

test("B-code metadata is reused from tracker, Product Master, and live Shopling fallback", () => {
  assert.match(engine, /loadProductPlanningSnapshot/);
  assert.match(engine, /loadProductLaunchPurchaseMetadataByBarcode/);
  assert.match(engine, /loadShoplingCurrentModelSnapshot/);
  assert.match(engine, /trackerUsable\?\.saleOption/);
  assert.match(engine, /trackerUsable\?\.chinaOption/);
  assert.match(engine, /trackerUsable\?\.supplierLink/);
  assert.match(engine, /live\?\.modelName/);
});

test("internal China draft prefers canonical identity over legacy Shopling labels", () => {
  const identityBlock =
    engine.match(/const trackerUsable =[^;]+;[\s\S]*?saleOption:/)?.[0] ?? "";

  const trackerModelNo = identityBlock.indexOf("trackerUsable?.modelNumber");
  const profileModelNo = identityBlock.indexOf("profile?.modelNo");
  const liveModelNo = identityBlock.indexOf("live?.modelNo");
  assert.ok(trackerModelNo >= 0 && profileModelNo >= 0 && liveModelNo >= 0);
  assert.ok(
    trackerModelNo < profileModelNo && profileModelNo < liveModelNo,
    "tracker and Product Master model numbers must win over Shopling fallback",
  );

  const trackerProductName = identityBlock.indexOf("trackerUsable?.productName");
  const profileProductName = identityBlock.indexOf("profile?.productName");
  const liveModelName = identityBlock.indexOf("live?.modelName");
  assert.ok(
    trackerProductName >= 0 && profileProductName >= 0 && liveModelName >= 0,
  );
  assert.ok(
    trackerProductName < profileProductName && profileProductName < liveModelName,
    "tracker and Product Master names must win over Shopling fallback",
  );
  assert.match(identityBlock, /productName: modelName/);
  assert.doesNotMatch(identityBlock, /modelName: live\?\.modelName/);
});

test("product launch metadata uses the model product-level fixed first China link for every B-code", () => {
  assert.match(trackerMetadata, /fixedFirstSupplierLink = summaryLinks\[0\]/);
  assert.match(trackerMetadata, /supplierLink: fixedFirstSupplierLink/);
  assert.match(trackerMetadata, /saleOption: text\(option\.saleOption\)/);
  assert.match(trackerMetadata, /chinaOption: text\(option\.chinaOption\)/);
  assert.match(trackerMetadata, /barcode = normalizeBarcode\(option\.barcode\)/);
  assert.doesNotMatch(trackerMetadata, /normalizeSupplierLink\(option\.supplierLink\)/);
  assert.doesNotMatch(trackerMetadata, /supplierLinkByIndex/);
});

test("tracker B-code metadata is authoritative while old saved blanks remain a fallback", () => {
  assert.match(engine, /function mergeSavedLine/);
  assert.match(engine, /saleOption: baseLine\.saleOption/);
  assert.match(
    engine,
    /chinaOption: baseLine\.chinaOption \|\| text\(saved\.chinaOption\)/,
  );
  assert.match(engine, /return saved \? mergeSavedLine\(line, saved\) : line/);
});

test("operator prep is persisted in the existing operation ledger without a schema migration", () => {
  assert.match(engine, /INTERNAL_CHINA_PURCHASE_PREP/);
  assert.match(engine, /commerce_operation_runs/);
  assert.match(engine, /resolution=merge-duplicates/);
  assert.match(engine, /source_event_id/);
  assert.match(engine, /externalOrderExecuted: false/);
});

test("reserved quantity and sale option remain source-owned while order-time cost and freight stay editable", () => {
  assert.match(engine, /INTERNAL_CHINA_QUANTITY_LOCKED/);
  assert.match(engine, /type EditableLine = Pick/);
  assert.doesNotMatch(
    engine.match(/type EditableLine = Pick<[\s\S]*?>;/)?.[0] ?? "",
    /saleOption/,
  );
  assert.match(engine, /saleOption: line\.saleOption/);
  assert.match(engine, /supplierLink/);
  assert.match(engine, /unitPriceCny/);
  assert.match(engine, /freightGroupId/);
  assert.match(engine, /domesticChinaFreightCny/);
  assert.match(workspace, /옵션 · \{line\.saleOption \|\| "-"\}/);
  assert.doesNotMatch(
    workspace,
    /updateLine\(line\.barcode,\s*\{\s*saleOption:/,
  );
  assert.match(
    workspace,
    /수량은[\s\S]*RESERVED로 확정되어 이 화면에서는 변경하지 않습니다/,
  );
});

test("1688 link is read-only and comes from the model fixed first product link", () => {
  assert.match(workspace, /모델 고정 1번 1688 링크/);
  assert.match(workspace, /해당 모델번호의 상품출시진행관리/);
  assert.match(workspace, /고정 1번 중국/);
  assert.match(workspace, /1688 열기/);
  assert.doesNotMatch(
    workspace,
    /updateLine\(line\.barcode,\s*\{\s*supplierLink:/,
  );
  assert.doesNotMatch(
    workspace.match(/function payload\(\)[\s\S]*?\n  }\n\n  async function saveDraft/)?.[0] ?? "",
    /supplierLink:/,
  );
});

test("exchange input is removed and internal standard cost is system-owned", () => {
  assert.match(engine, /INTERNAL_CHINA_FIXED_KRW_PER_CNY = 230/);
  assert.match(engine, /INTERNAL_CHINA_ORDER_COST_MULTIPLIER/);
  assert.match(engine, /internalOrderCostMultiplier/);
  assert.doesNotMatch(workspace, /적용 환율 KRW\/CNY/);
  assert.match(workspace, /내부기준원가/);
  assert.match(workspace, /실주문 원가 × 내부 주문 수수료율/);
});

test("product name column is removed and B-code model and sale option share one identity cell", () => {
  assert.match(workspace, /B-code \/ 모델 \/ 옵션/);
  assert.doesNotMatch(workspace, /<th className="px-3 py-3">상품명<\/th>/);
  assert.match(workspace, /line\.modelName/);
  assert.match(workspace, /line\.modelNo/);
  assert.match(workspace, /line\.saleOption/);
});

test("actual ORDERED ledger transition requires operator confirmation and mandatory order evidence", () => {
  assert.match(engine, /blockingOrderIssues/);
  assert.match(engine, /위안단가/);
  assert.match(engine, /1688 링크/);
  assert.match(workspace, /중국옵션/);
  assert.match(engine, /status: "ORDERED"/);
  assert.match(engine, /orderedQuantity: line\.quantity/);
  assert.match(workspace, /window\.confirm/);
  assert.match(workspace, /실제로 1688에서/);
  assert.match(workspace, /이 버튼은 1688 주문·결제를 실행하지 않습니다/);
});

test("internal order record never calls 1688 or payment APIs", () => {
  assert.doesNotMatch(engine, /fetch\([^)]*1688|placeOrder|payOrder|checkout/i);
  assert.match(engine, /externalOrderExecuted: false/);
  assert.match(route, /externalOrderExecuted: false/);
});

test("same-origin API supports read save and explicit ordered record", () => {
  assert.match(route, /isSameOriginOpsRequest/);
  assert.match(route, /export async function GET/);
  assert.match(route, /export async function PUT/);
  assert.match(route, /export async function POST/);
  assert.match(route, /MARK_ORDERED/);
});

test("fast purchase and monthly China manager route to the Ops Center native draft page", () => {
  assert.match(fastActions, /\/china-order-manager\/drafts\//);
  assert.match(fastActions, /Ops Center 중국 주문초안 열기/);
  assert.doesNotMatch(fastActions, /chatgpt\.site|orderManagerUrl/);
  assert.match(manager, /중국 주문초안/);
  assert.match(manager, /\/china-order-manager\/drafts\//);
  assert.match(manager, /빠른 발주안/);
  assert.match(page, /OPS CENTER NATIVE CHINA ORDER MVP/);
  assert.match(page, /기존 GPT Site의 주문 준비 단계를 대체/);
  assert.match(page, /budgetAudit=\{budgetAudit\}/);
});
