import assert from "node:assert/strict";
import { test } from "node:test";
import { newSaurusBatch, planSaurusApproval, refreshSaurusPreparation, requireSaurusSourcingItems, sameSaurusReviewOptions, updateSaurusPreparation } from "../src/lib/aiSaurusBulkDetailCore.ts";
import { dispatchClaims, readOpsSaurusRelease, reconcileOpsSaurusStatus, startOpsSaurusProduct } from "../src/lib/aiSaurusBulkDetailProvider.ts";
import { showSaurusPopupMessage } from "../src/lib/aiSaurusBulkDetailPopup.ts";
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

const sourced = {
  ...product, id: "eligible", modelNumber: "AAA508",
  source: { system: "commerce-os-sourcing-engine", sourcingIntakeId: "reservation", materializedAt: "2026-07-31T15:00:00Z" },
  orderOptions: [{ saleOption: "단품 그레이", chinaOption: "单网灰色 大包装】10个起拍" }],
};

test("requires August 1 KST confirmed sourcing evidence for the entire selection", () => {
  const old = { ...sourced, id: "old", modelNumber: "AAA337", source: {
    ...sourced.source, sourceConfirmedAt: "2026-07-31T14:59:59.999Z",
  } };
  const october = { ...sourced, id: "october", source: {
    ...sourced.source, sourceConfirmedAt: "2026-10-14T00:00:00+09:00",
  } };
  assert.doesNotThrow(() => requireSaurusSourcingItems([old, sourced, october], ["eligible", "october"]));
  assert.throws(() => requireSaurusSourcingItems([old, sourced], ["eligible", "old"]), /2026년 8월 1일.*AAA337/);
  assert.throws(() => requireSaurusSourcingItems([{ ...sourced, source: {} }], ["eligible"]), /AAA508/);
  assert.throws(() => requireSaurusSourcingItems([{ ...sourced, archivedAt: date }], ["eligible"]), /AAA508/);
});

test("starts source review without names and only sends proven same-offer option hints", () => {
  const current = newSaurusBatch("batch", ["eligible"], [sourced], date);
  const hints = [{ sourceName: sourced.orderOptions[0].chinaOption, saleName: sourced.orderOptions[0].saleOption }];
  assert.deepEqual(current.products[0].reviewOptions, hints);
  const sourceLink = "https://detail.1688.com/offer/456.html";
  const different = newSaurusBatch("batch", ["eligible"], [{ ...sourced,
    chinaLinkUsage: { purchaseUrl: source, detailPageUrl: sourceLink },
  }], date);
  assert.equal(different.products[0].sourceUrl, sourceLink);
  assert.deepEqual(different.products[0].reviewOptions, []);
  const mixed = newSaurusBatch("batch", ["eligible"], [{ ...sourced, orderOptions: [
    { ...sourced.orderOptions[0], supplierLink: sourceLink },
  ] }], date);
  assert.deepEqual(mixed.products[0].reviewOptions, []);
  const prepared = updateSaurusPreparation(current, [{ id: "eligible", options: [] }], true, date);
  const latest = { deployment, importer: "0.4.63", engine: "engine", maxCredits: 13 };
  assert.throws(() => startOpsSaurusProduct(prepared, "eligible", "owner@example.com", date, latest), /검토 기능/);
  const running = startOpsSaurusProduct(prepared, "eligible", "owner@example.com", date, { ...latest, sourceReview: true });
  assert.deepEqual(dispatchClaims(running.product, 1).reviewOptions, hints);
  assert.notEqual(prepared.products[0].inputHash, current.products[0].inputHash);
});

test("persisted JSONB key order keeps the same sourcing options and preparation hash", () => {
  const actual = { ...sourced, modelNumber: "AAA496", orderOptions: [
    { saleOption: "단품 그레이", chinaOption: "【升级双舱高密绒】白色" },
  ] };
  const fresh = newSaurusBatch("batch", [actual.id], [actual], date);
  const persisted = structuredClone(fresh);
  persisted.products[0].reviewOptions = JSON.parse(
    '[{"saleName":"단품 그레이","sourceName":"【升级双舱高密绒】白色"}]',
  );
  const edits = [{ id: actual.id, options: ["단품 그레이"] }];
  const prepared = updateSaurusPreparation(persisted, edits, true, date);
  const freshHints = fresh.products[0].reviewOptions;
  assert.equal(sameSaurusReviewOptions(persisted.products[0].reviewOptions, freshHints), true);
  assert.equal(sameSaurusReviewOptions(freshHints, [{ ...freshHints[0], saleName: "다른 판매명" }]), false);
  assert.equal(sameSaurusReviewOptions(undefined, []), false);
  assert.equal(refreshSaurusPreparation(prepared, fresh), prepared);
  assert.equal(prepared.products[0].inputHash, updateSaurusPreparation(fresh, edits, true, date).products[0].inputHash);
});

test("collection popup shows the error and preserves an opened Studio window", () => {
  const holding = { closed: false, location: { href: "about:blank" },
    document: { title: "AI 사우루스 준비", body: { textContent: "수집 창을 여는 중입니다." } } };
  const title = "AI 사우루스 수집 오류";
  const message = "상품 정보가 변경됐습니다.";
  showSaurusPopupMessage(holding, title, message);
  assert.equal(holding.document.title, title);
  assert.equal(holding.document.body.textContent, message);

  const studio = {
    closed: false,
    get location() { throw new DOMException("Blocked cross-origin access", "SecurityError"); },
    get document() { assert.fail("Do not modify the opened Studio page"); },
  };
  assert.doesNotThrow(() => showSaurusPopupMessage(studio, title, message));
});
