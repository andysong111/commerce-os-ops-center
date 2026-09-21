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
  assert.match(ingress, /externalOrderExecuted: false/);
  assert.doesNotMatch(ingress, /orderedOn1688\s*:\s*true/);
  assert.doesNotMatch(ingress, /status: "ORDERED"/);
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
