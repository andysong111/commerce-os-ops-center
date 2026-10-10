import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("sourcing ingress writes only an internal RESERVED China commitment and is replay-safe", async () => {
  const ingress = await source("../src/lib/sourcingPurchaseIngress.ts");
  assert.match(ingress, /status: "RESERVED"/);
  assert.match(ingress, /resolution=ignore-duplicates/);
  assert.match(ingress, /sourcingIntakeId/);
  assert.match(ingress, /sourcingOutboxId/);
  assert.match(ingress, /materializeSourcingReservedLaunchItem/);
  assert.match(ingress, /launchLifecycleStatus/);
  assert.match(ingress, /externalOrderExecuted: false/);
  assert.doesNotMatch(ingress, /orderedOn1688\s*:\s*true/);
  assert.doesNotMatch(ingress, /status: "ORDERED"/);
});

test("reserved sourcing creates an inbound-pending launch card and receipt updates the same identity", async () => {
  const materialization = await source("../src/lib/sourcingLaunchMaterialization.ts");
  assert.match(materialization, /RESERVED_NOTE\s*=\s*"신규소싱 확정 · 입고 대기"/);
  assert.match(materialization, /lifecycleStatus:\s*"RECEIVED"/);
  assert.match(materialization, /sourcingIntakeIds/);
  assert.match(materialization, /items\.map\(\(value\)\s*=>\s*text\(value\.id\)\s*===\s*itemId/);
  assert.match(materialization, /SOURCING_LAUNCH_RECEIPT_IDEMPOTENCY_CONFLICT/);
});

test("manual sourcing UI batches products with nested options and per-option storage choices", async () => {
  const [form, route, proxy] = await Promise.all([
    source("../src/components/sourcing-center/ManualProductIntakeForm.tsx"),
    source("../src/app/api/sourcing-center/manual-product/route.ts"),
    source("../src/lib/sourcingManualProductIntake.ts"),
  ]);
  assert.match(form, /variants:\s*\[emptyVariant\(variantId\)\]/);
  assert.match(form, /variants:\s*\[\.\.\.product\.variants, makeVariant\(\)\]/);
  assert.match(form, /\+ 같은 상품 옵션 추가/);
  assert.match(form, /\+ 다른 상품 추가/);
  assert.match(form, /판매 옵션명/);
  assert.match(form, /1688 중국 옵션/);
  assert.match(form, /storage\.\$\{variant\.id\}/);
  assert.match(form, /checked=\{variant\.storageSize === "S"\}/);
  assert.match(form, /checked=\{variant\.storageSize === "L"\}/);
  assert.match(form, /aria-busy=\{busy\}/);
  assert.match(form, /product\.variants\.map/);
  assert.match(form, /failedProducts\.length \? failedProducts/);
  assert.match(form, /실패 입력만 남겼습니다/);
  assert.match(form, /embedded = false/);
  assert.match(form, /embedded\s*\?\s*<h3/);
  assert.match(form, /calculationFormId/);
  assert.match(form, /stagedCandidates/);
  assert.match(form, /form=\{calculationFormId\}/);
  assert.match(form, /아직 발주안은 계산하지 않았습니다/);
  assert.match(form, /상품 \$\{products\.length\}종 · 옵션 \$\{optionCount\}개 후보 목록에 추가/);
  assert.match(form, /각 옵션에 별도 B코드와 수납공간이 배정됩니다/);
  assert.match(form, /disabled=\{busy\}/);
  assert.match(form, /commerce-os\.manual-sourcing-intake\.v1/);
  assert.match(form, /window\.localStorage\.getItem\(key\)/);
  assert.match(form, /window\.localStorage\.setItem\(storageKey\.current/);
  assert.match(form, /known\.has\(conceptId\)/);
  assert.match(form, /자동 임시저장됩니다/);
  assert.match(route, /isSameOriginOpsRequest/);
  assert.match(proxy, /x-commerce-os-integration-secret/);
  assert.match(proxy, /x-vercel-protection-bypass/);
  assert.match(proxy, /externalOrderExecuted:\s*false/);
  assert.match(proxy, /candidates:\s*ManualSourcingProductCandidate\[\]/);
});

test("sourcing purchase ingress is server-secret protected and fail-closed", async () => {
  const route = await source("../src/app/api/integrations/sourcing-purchase/route.ts");
  assert.match(route, /x-commerce-os-integration-secret/);
  assert.match(route, /SOURCING_ENGINE_INTEGRATION_SECRET/);
  assert.match(route, /PRODUCT_MASTER_INTEGRATION_SECRET/);
  assert.match(route, /status: configured \? 401 : 503/);
});

test("pre-inbound sourced lines retain identity and 1688 metadata without an active Product Master SKU", async () => {
  const [ledger, draft] = await Promise.all([
    source("../src/lib/chinaOrderLedger.ts"),
    source("../src/lib/internalChinaPurchaseDraft.ts"),
  ]);
  assert.match(ledger, /latestPayload/);
  assert.match(draft, /commitment\.latestPayload/);
  assert.match(draft, /sourcePayload\.modelNo/);
  assert.match(draft, /sourcePayload\.productName/);
  assert.match(draft, /sourcePayload\.supplierLink/);
  assert.match(draft, /sourcePayload\.unitPriceCny/);
});

test("normal fast-purchase planning adopts a sourcing-seeded unprogressed monthly draft", async () => {
  const draft = await source("../src/lib/fastPurchaseInternalDraft.ts");
  assert.match(draft, /currentCycleDraft\?\.draftId \|\| proposedDraftId/);
  assert.match(draft, /FAST_PURCHASE_MONTHLY_CYCLE_MULTIPLE_DRAFTS/);
  assert.match(draft, /currentCycleDraft\.orderedQuantity > 0/);
  assert.match(draft, /currentCycleDraft\.receivedQuantity > 0/);
});
