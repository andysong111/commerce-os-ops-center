import assert from "node:assert/strict";
import { test } from "node:test";
import { confirmSaurusApprovalReadback, newSaurusBatch, planSaurusApproval, planSaurusReviewDecision, refreshSaurusPreparation, requireSaurusSourcingItems, reserveSaurusApproval, sameSaurusReviewOptions, saurusBatchRevisionMode, updateSaurusPreparation } from "../src/lib/aiSaurusBulkDetailCore.ts";
import { dispatchClaims, readOpsSaurusRelease, reconcileOpsSaurusStatus, replaceProduct, startOpsSaurusProduct } from "../src/lib/aiSaurusBulkDetailProvider.ts";
import { readSaurusReviewAssets, saurusResultImageUrl } from "../src/lib/aiSaurusReviewAssets.ts";
import { showSaurusPopupMessage } from "../src/lib/aiSaurusBulkDetailPopup.ts";
import { applyProductLaunchTrackerMutation } from "../src/lib/productLaunchTrackerOptimized.ts";
import { saurusLaunchMaterials, saurusManualMaterials, saurusProductBCodes } from "../src/lib/aiSaurusLaunchMaterials.ts";
import { productLaunchSeoMaterialReadiness } from "../src/lib/productLaunchSeoMaterialReadiness.ts";
import { buildProductLaunchShoplingPayload } from "../src/lib/productLaunchTrackerShopling.ts";

const source = "https://detail.1688.com/offer/123.html";
const product = { id: "p1", productName: "테스트", chinaLinkUsage: { commonUrl: source },
  modelNumber: "AAA496", barcode: "BDG6-2", shoplingCategory: "생활용품>세탁용품", selfCodeBase: "AAA496",
  orderOptions: [{ optionName: "종류", saleOption: "단품", barcode: "BDG6-2", optionBarcodeNo: "123456789012", baseSalePriceKrw: 10000, unitCostKrw: 4000 }],
  detailPageAsset: { detailImageUrl: "", mainImageUrl: "", resultId: "keep" } };
const date = "2026-11-27T01:00:00Z";
const deployment = "a".repeat(40);
const jobId = "7abc9460-f304-4c3c-bdb8-81342e8be910";
const assetId = "d6c0ea7c-e3ef-480e-990f-ffe615c33d03";
const hostedUrl = `https://ai-saurus.com/api/saas/marketplace-assets/${assetId}/image.jpg`;

const firstGallery = {
  representative_main_catalog: "6592afe9-54f8-4202-af88-8d20091b7780",
  representative_alternate_whole: "e37777e9-c36a-49f1-8a19-6c65ebda53a3",
  representative_evidence_detail: "eb747774-2976-4982-8fa1-37288e27f6a6",
  representative_lifestyle_usage: "03efbdd9-85fa-4e0f-810d-d0da50424355",
  representative_adaptive_support: "3a598572-a7ee-4cab-8256-f059305ee201",
};

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

test("B-code approval saves six QA-verified URLs and the HTML consumed by SEO registration", () => {
  const batch = newSaurusBatch("batch", ["p1"], [product], date);
  const prepared = updateSaurusPreparation(batch, [{ id: "p1", options: ["단품"] }], true, date);
  assert.throws(() => updateSaurusPreparation({ ...prepared, queuedIds: ["p1"] }, [
    { id: "p1", options: ["안전하지 않은 변경"] },
  ], false, date), /준비 중인/);
  const latest = { deployment, importer: "0.4.62", engine: "engine", maxCredits: 13 };
  const running = startOpsSaurusProduct(prepared, "p1", "owner@example.com", date, latest);
  assert.throws(() => startOpsSaurusProduct(running.batch, "p1", "owner@example.com", date, latest), /제작 중/);
  const evidence = { state: "succeeded", providerJobId: jobId, engine: "engine", qa: "passed", assetId,
    hostedUrl, sha256: "1".repeat(64), creditCost: 13, costReceiptId: "credit-debit", reviewAssets: firstGallery };
  assert.throws(() => reconcileOpsSaurusStatus(running.product, { ...evidence, creditCost: 14 }, 0), /비용/);
  assert.throws(() => reconcileOpsSaurusStatus(running.product, { ...evidence, hostedUrl: hostedUrl + "?tmp=1" }, 0), /호스팅/);
  const complete = reconcileOpsSaurusStatus(running.product, evidence, 0);
  assert.equal(complete.stage, "awaiting_review");
  const ready = replaceProduct(running.batch, complete, date);
  const reserved = reserveSaurusApproval(ready, ["p1"], [product], date);
  assert.equal(reserved.products[0].stage, "approving");
  assert.throws(() => planSaurusReviewDecision(reserved, ["p1"], [product], "reject", date), /승인 대기/);
  assert.throws(() => planSaurusApproval(ready, ["p1"], [{ ...product, orderOptions: [
    { ...product.orderOptions[0], barcode: "BDG6-3" },
  ] }]), /B코드가 변경/);
  assert.throws(() => planSaurusApproval(ready, ["p1"], [{ ...product, orderOptions: [
    ...product.orderOptions, { ...product.orderOptions[0], barcode: "BDG6-3" },
  ] }]), /B코드가 변경/);
  const legacy = { ...ready, products: [{ ...ready.products[0], originalImageMaterials: undefined, bCodes: undefined }] };
  const changedAfterReview = { ...product, detailPageAsset: { detailImageUrl: "https://cdn.example.com/manual.jpg" } };
  assert.throws(() => reserveSaurusApproval(legacy, ["p1"], [changedAfterReview], date), /이미지 자료가 변경/);
  assert.throws(() => reserveSaurusApproval(legacy, ["p1"], [{ ...product, barcode: "", orderOptions: [] }], date), /B코드를 확인/);
  assert.deepEqual(reserveSaurusApproval(legacy, ["p1"], [product], date).products[0].bCodes, ["BDG6-2"]);
  const planned = planSaurusApproval(reserved, ["p1"], [product])[0];
  const materials = saurusLaunchMaterials(planned);
  assert.equal(materials.detailImageUrl, hostedUrl);
  assert.equal(materials.mainImageUrl, saurusResultImageUrl(firstGallery.representative_main_catalog));
  assert.deepEqual(materials.additionalImageUrls, Object.values(firstGallery).slice(1).map(saurusResultImageUrl));
  assert.match(materials.html, /<img src="https:\/\/ai-saurus.com\/api\/saas\/marketplace-assets\//);
  const saved = applyProductLaunchTrackerMutation({ items: [product] }, {
    operation: "bulk_patch_items", expectedStateUpdatedAt: date, patches: [{ itemId: "p1", patch: { detailPageAsset: materials } }],
  });
  assert.deepEqual(saved.state.items[0], planned);
  assert.equal(saved.state.items[0].detailPageAsset.resultId, "keep");
  assert.deepEqual(saved.state.items[0].orderOptions, product.orderOptions);
  assert.equal(productLaunchSeoMaterialReadiness(product).ready, false);
  assert.equal(productLaunchSeoMaterialReadiness(saved.state.items[0]).ready, true);
  const shopling = buildProductLaunchShoplingPayload(saved.state.items[0], {}, "fixture-only");
  assert.ok(shopling.detailHtml.includes(hostedUrl));
  assert.equal(shopling.images.main, materials.mainImageUrl);
  assert.deepEqual(shopling.images.additional, materials.additionalImageUrls);
  assert.throws(() => confirmSaurusApprovalReadback(reserved, ["p1"], [product], date), /다시 확인/);
  const resolved = confirmSaurusApprovalReadback(reserved, ["p1"], saved.state.items, date);
  assert.equal(resolved.products[0].stage, "approved");
  assert.equal(planSaurusApproval(resolved, ["p1"], saved.state.items)[0], saved.state.items[0]);
});

test("each finished product keeps its own gallery and incomplete results cannot be approved", () => {
  const second = { ...product, id: "p2", modelNumber: "AAA505", productName: "다음 상품", barcode: "BDG6-3",
    orderOptions: [{ ...product.orderOptions[0], barcode: "BDG6-3" }] };
  const batch = newSaurusBatch("batch", ["p1", "p2"], [product, second], date);
  const prepared = updateSaurusPreparation(batch, [
    { id: "p1", options: ["단품"] }, { id: "p2", options: ["단품"] },
  ], true, date);
  const latest = { deployment, importer: "0.4.63", engine: "engine", maxCredits: 13 };
  const firstRun = startOpsSaurusProduct(prepared, "p1", "owner@example.com", date, latest);
  const succeeded = {
    state: "succeeded", providerJobId: jobId, engine: "engine", qa: "passed", assetId,
    hostedUrl, sha256: "1".repeat(64), creditCost: 13, costReceiptId: "201", reviewAssets: firstGallery,
  };
  const first = reconcileOpsSaurusStatus(firstRun.product, succeeded, 0);
  assert.equal(first.stage, "awaiting_review");
  assert.deepEqual(first.receipt.reviewAssets, firstGallery);
  const secondRun = startOpsSaurusProduct(replaceProduct(firstRun.batch, first, date), "p2", "owner@example.com", date, latest);
  const secondSourceAssets = {
    representative_main_catalog: "fa66a622-a59b-4c6e-a6e8-76e558f97d7b",
    representative_alternate_whole: "https://unexpected.test/offer.jpg",
  };
  const secondAssetId = "86c92d17-3cb7-4a91-ae5c-528f15fa7dec";
  const secondResult = reconcileOpsSaurusStatus(secondRun.product, {
    ...succeeded, providerJobId: "aa50faec-b9ac-48dd-86dc-5533d661275e", assetId: secondAssetId,
    hostedUrl: saurusResultImageUrl(secondAssetId), costReceiptId: "202", reviewAssets: secondSourceAssets,
  }, 0);
  const persisted = JSON.parse(JSON.stringify(replaceProduct(secondRun.batch, secondResult, date)));
  assert.deepEqual(persisted.products.map(({ stage }) => stage), ["awaiting_review", "awaiting_review"]);
  assert.deepEqual(persisted.products[0].receipt.reviewAssets, firstGallery);
  assert.deepEqual(persisted.products[1].receipt.reviewAssets, {
    representative_main_catalog: secondSourceAssets.representative_main_catalog,
  });
  assert.throws(() => planSaurusApproval(persisted, ["p2"], [product, second]), /대표 이미지 1장/);
  assert.equal(planSaurusApproval(persisted, ["p1"], [product, second])[1], second);

  assert.equal(readSaurusReviewAssets(undefined, assetId), undefined);
  assert.equal(readSaurusReviewAssets({
    representative_main_catalog: assetId,
    representative_alternate_whole: firstGallery.representative_main_catalog,
    representative_evidence_detail: firstGallery.representative_main_catalog,
    checkpoint_representative_main_catalog: firstGallery.representative_alternate_whole,
  }, assetId), undefined);
});

test("a reviewed result can retry once across reselection and rejection permanently locks AI preparation", () => {
  const initial = newSaurusBatch("batch", ["p1"], [product], date);
  assert.deepEqual(saurusProductBCodes(product), ["BDG6-2"]);
  const prepared = updateSaurusPreparation(initial, [{ id: "p1", options: ["단품"] }], true, date);
  const latest = { deployment, importer: "0.4.63", engine: "engine", maxCredits: 13 };
  const started = startOpsSaurusProduct(prepared, "p1", "owner@example.com", date, latest);
  const evidence = { state: "succeeded", providerJobId: jobId, engine: "engine", qa: "passed", assetId,
    hostedUrl, sha256: "1".repeat(64), creditCost: 13, costReceiptId: "201", reviewAssets: firstGallery };
  const review = replaceProduct(started.batch, reconcileOpsSaurusStatus(started.product, evidence, 0), date);
  const retry = planSaurusReviewDecision(review, ["p1"], [product], "retry", date);
  assert.throws(() => planSaurusReviewDecision(retry, ["p1"], [product], "retry", date), /한 번/);
  const freshProduct = { ...product, productName: "이름 편집" };
  const refreshed = refreshSaurusPreparation(retry, newSaurusBatch("batch", ["p1"], [freshProduct], date));
  assert.equal(refreshed.products[0].attempts, 1);
  assert.equal(refreshed.products[0].stage, "waiting_connection");
  const second = startOpsSaurusProduct(refreshed, "p1", "owner@example.com", date, latest);
  assert.equal(second.product.attempts, 2);
  assert.notEqual(second.product.dispatch.attempt, started.product.dispatch.attempt);
  const final = replaceProduct(second.batch, reconcileOpsSaurusStatus(second.product, {
    ...evidence, providerJobId: "04ce59b8-0a74-4ff7-aba3-f483d20fe168", costReceiptId: "202",
  }, 0), date);
  assert.throws(() => planSaurusReviewDecision(final, ["p1"], [freshProduct], "retry", date), /한 번/);
  const rejected = planSaurusReviewDecision(final, ["p1"], [freshProduct], "reject", date);
  assert.equal(rejected.products[0].stage, "rejected");
  assert.deepEqual(rejected.products[0].bCodes, ["BDG6-2"]);
  assert.throws(() => planSaurusApproval(rejected, ["p1"], [freshProduct]), /검수 통과/);
  assert.throws(() => planSaurusReviewDecision(rejected, ["p1"], [freshProduct], "retry", date), /한 번/);
  assert.throws(() => updateSaurusPreparation(rejected, [{ id: "p1", options: [] }], true, date), /준비 중인/);
  assert.throws(() => startOpsSaurusProduct(rejected, "p1", "owner@example.com", date, latest), /제작 중/);

  const manual = saurusManualMaterials({
    detailImageUrl: "https://manual.example/detail.jpg?a=1&b=2",
    mainImageUrl: "https://manual.example/main.jpg",
    additionalImageUrls: ["https://manual.example/side.jpg"],
  }, '직접 "제작"');
  assert.match(manual.html, /a=1&amp;b=2/);
  assert.match(manual.html, /직접 &quot;제작&quot;/);
  assert.throws(() => saurusManualMaterials({ ...manual, detailImageUrl: "javascript:alert(1)" }, "테스트"), /HTTP/);
});

test("an older refresh can read the saved approval status while stale writes still conflict", () => {
  assert.equal(saurusBatchRevisionMode("refresh", 3, 4), "read-latest");
  assert.equal(saurusBatchRevisionMode("refresh", 4, 4), "current");
  assert.equal(saurusBatchRevisionMode("refresh", 5, 4), "conflict");
  assert.equal(saurusBatchRevisionMode("refresh", -1, 4), "conflict");
  for (const action of ["approve", "start", "resume", "retry", "save", "prepare", "clear_queue"]) {
    assert.equal(saurusBatchRevisionMode(action, 3, 4), "conflict");
  }
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
