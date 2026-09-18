import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [readiness, page, priority, preflight] = await Promise.all([
  readFile("src/lib/stage7PurchaseCostEvidenceReadiness.ts", "utf8"),
  readFile("src/app/stage7-purchase-cost-evidence/page.tsx", "utf8"),
  readFile("src/lib/stage8InventoryVerificationPriority.ts", "utf8"),
  readFile("src/lib/purchaseCyclePreflightCore.ts", "utf8"),
]);

test("stage7 reads only canonical Product Master verified purchase cost", () => {
  assert.match(readiness, /hasVerifiedPurchaseCost/);
  assert.match(readiness, /purchaseCostTrustSource/);
  assert.match(readiness, /verifiedPurchaseUnitCostKrw/);
  assert.match(readiness, /purchaseProtectedCostKrw/);
  assert.doesNotMatch(readiness, /stage8LegacyVerifiedCostEvidence|readPriceAdjustmentReceiptCache/);
});

test("legacy purchase-only evidence can satisfy cost gate without becoming receipt truth", () => {
  assert.match(priority, /!row\?\.hasVerifiedPurchaseCost/);
  assert.match(preflight, /row\.hasVerifiedPurchaseCost === true/);
  assert.match(preflight, /purchaseCostTrustSource/);
  assert.match(preflight, /verifiedPurchaseUnitCostKrw/);
  assert.match(preflight, /verifiedPurchaseCostAt/);
  assert.match(page, /확정입고원가와 별도 검증된 구매전용 원가근거/);
});

test("stage7 remains read-only and cannot mutate price inventory receipt or orders", () => {
  assert.match(readiness, /businessWritesEnabled: false/);
  assert.match(readiness, /priceWritesEnabled: false/);
  assert.match(readiness, /inventoryWritesEnabled: false/);
  assert.match(readiness, /receiptWritesEnabled: false/);
  assert.doesNotMatch(
    `${readiness}\n${page}`,
    /method:\s*["']POST["']|upsertRows|insert\(|update\(|delete\(|rpc\(/,
  );
});
