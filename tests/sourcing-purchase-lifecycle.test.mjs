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
  assert.match(materialization, /items\.map\(\(value\)\s*=>\s*text\(value\.id\)\s*===\s*intakeId/);
  assert.match(materialization, /SOURCING_LAUNCH_RECEIPT_IDEMPOTENCY_CONFLICT/);
});

test("manual sourcing UI requires link, product name and an explicit storage choice", async () => {
  const [form, route, proxy] = await Promise.all([
    source("../src/components/sourcing-center/ManualProductIntakeForm.tsx"),
    source("../src/app/api/sourcing-center/manual-product/route.ts"),
    source("../src/lib/sourcingManualProductIntake.ts"),
  ]);
  assert.match(form, /name="sourceUrl"/);
  assert.match(form, /name="productName"/);
  assert.match(form, /name="storageSize" value="S" required/);
  assert.match(form, /name="storageSize" value="L" required/);
  assert.match(form, /embedded = false/);
  assert.match(form, /embedded\s*\?\s*<h3/);
  assert.match(form, /calculationFormId/);
  assert.match(form, /stagedCandidates/);
  assert.match(form, /form=\{calculationFormId\}/);
  assert.match(form, /계산 목록 식별값을 확인하지 못했습니다/);
  assert.match(form, /아직 발주안은 계산하지 않았습니다/);
  assert.match(form, /수동 후보 목록에 추가/);
  assert.match(form, /주문·결제를 실행하지 않습니다/);
  assert.match(route, /isSameOriginOpsRequest/);
  assert.match(proxy, /x-commerce-os-integration-secret/);
  assert.match(proxy, /x-vercel-protection-bypass/);
  assert.match(proxy, /externalOrderExecuted:\s*false/);
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
