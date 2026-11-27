import assert from "node:assert/strict";
import { test } from "node:test";
import { newSaurusBatch, planSaurusApproval, updateSaurusPreparation } from "../src/lib/aiSaurusBulkDetailCore.ts";
import { readOpsSaurusRelease, reconcileOpsSaurusStatus, startOpsSaurusProduct } from "../src/lib/aiSaurusBulkDetailProvider.ts";
import { applyProductLaunchTrackerMutation } from "../src/lib/productLaunchTrackerOptimized.ts";

const source = "https://detail.1688.com/offer/123.html";
const product = { id: "p1", productName: "테스트", chinaLinkUsage: { commonUrl: source },
  detailPageAsset: { detailImageUrl: "", mainImageUrl: "keep", resultId: "keep" } };
const date = "2026-11-27T01:00:00Z";
const deployment = "a".repeat(40);
const jobId = "7abc9460-f304-4c3c-bdb8-81342e8be910";
const assetId = "d6c0ea7c-e3ef-480e-990f-ffe615c33d03";
const hostedUrl = `https://ai-saurus.com/api/saas/marketplace-assets/${assetId}/image.jpg`;

test("loads the current production release on demand and rejects manifest drift", async (t) => {
  let version = "0.4.62";
  t.mock.method(globalThis, "fetch", async (path) => {
    assert.ok(path.startsWith("https://ai-saurus.com/"));
    return Response.json(path.includes("manifest") ? { version } : {
      enabled: true, contract: "ops-detail-v1", deployment, importer: "0.4.62", engine: "engine", credits: 13,
    });
  });
  assert.deepEqual(await readOpsSaurusRelease(), { deployment, importer: "0.4.62", engine: "engine", maxCredits: 13 });
  version = "0.4.63";
  await assert.rejects(readOpsSaurusRelease, /버전/);
});

test("prevents duplicate starts and saves only the QA-verified final URL after exact asset and credit evidence", () => {
  const batch = newSaurusBatch("batch", ["p1"], [product], date);
  const prepared = updateSaurusPreparation(batch, [{ id: "p1", options: ["단품"] }], true, date);
  assert.throws(() => updateSaurusPreparation({ ...prepared, queuedIds: ["p1"] }, [
    { id: "p1", options: ["안전하지 않은 변경"] },
  ], false, date), /준비 중인/);
  const latest = { deployment, importer: "0.4.62", engine: "engine", maxCredits: 13 };
  const running = startOpsSaurusProduct(prepared, "p1", "owner@example.com", date, latest);
  assert.throws(() => startOpsSaurusProduct(running.batch, "p1", "owner@example.com", date, latest), /제작 중/);
  const evidence = { state: "succeeded", providerJobId: jobId, engine: "engine", qa: "passed", assetId,
    hostedUrl, sha256: "1".repeat(64), creditCost: 13, costReceiptId: "credit-debit" };
  assert.throws(() => reconcileOpsSaurusStatus(running.product, { ...evidence, creditCost: 14 }, 0), /비용/);
  assert.throws(() => reconcileOpsSaurusStatus(running.product, { ...evidence, hostedUrl: hostedUrl + "?tmp=1" }, 0), /호스팅/);
  const complete = reconcileOpsSaurusStatus(running.product, evidence, 0);
  assert.equal(complete.stage, "awaiting_review");
  const planned = planSaurusApproval({ ...running.batch, products: [complete] }, ["p1"], [product])[0];
  assert.deepEqual(planned, { ...product, detailPageAsset: { ...product.detailPageAsset, detailImageUrl: hostedUrl } });
  const saved = applyProductLaunchTrackerMutation({ items: [product] }, {
    operation: "bulk_patch_items", patches: [{ itemId: "p1", patch: { detailPageAsset: { detailImageUrl: hostedUrl } } }],
  });
  assert.deepEqual(saved.state.items[0], planned);
});
