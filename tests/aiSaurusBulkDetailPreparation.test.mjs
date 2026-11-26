import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acceptSaurusHostedReceipt, confirmSaurusApprovalReadback, newSaurusBatch, planSaurusApproval, planSaurusRetry, planSaurusRun,
  refreshSaurusPreparation, saurusSelectionHash, updateSaurusPreparation,
} from "../src/lib/aiSaurusBulkDetailCore.ts";

const date = "2026-11-26T04:00:00.000Z";
const source = "https://detail.1688.com/offer/123456.html";
const purchase = "https://detail.1688.com/offer/345678.html";
const hosting = "https://images.example.org";
const budget = { approvedBudgetMinor: 1000, currency: "KRW" };
const item = {
  id: "p1", productName: "정리함",
  chinaLinkUsage: { commonUrl: purchase, purchaseUrl: purchase, detailPageUrl: source },
  orderOptions: [{ saleOption: " 빨강 " }, { value: "파랑" }, { saleOption: "빨강" }],
  detailPageAsset: { detailImageUrl: `${hosting}/old.jpg`, htmlUrl: `${hosting}/p1.html`, galleryUrls: ["gallery"] },
};
const second = { id: "p2", productName: "파우치", chinaProductLinks: [source, purchase] };
const third = { id: "p3", productName: "가방" };
const items = [item, second, third];

const release = (id, importerVersion) => ({
  origin: "https://ai-saurus.com", deploymentId: id, engineVersion: `engine-${id}`, importerVersion,
  contractVersion: "detail-hosting-v1", hostingOrigins: [hosting],
});
const session = (importerVersion, loggedIn = true) => ({
  loggedIn, evidenceId: "chrome-1688-proof", importerVersion, sourceOrigin: "https://detail.1688.com",
});
function batch() {
  return newSaurusBatch("batch", ["p1", "p2"], items, date);
}
function prepared() {
  return updateSaurusPreparation(batch(), [
    { id: "p1", options: ["커스텀"] }, { id: "p2", options: ["기본"] },
  ], true, date);
}
function receiptFor(product) {
  return {
    attemptKey: product.run.attemptKey, inputHash: product.inputHash, itemId: product.id,
    deploymentId: product.run.release.deploymentId, sessionEvidenceId: product.run.sessionEvidenceId,
    providerJobId: `job-${product.id}`, hostedImageUrl: `${hosting}/${product.id}.jpg`,
    sha256: "a".repeat(64), qa: "passed", transferReceiptId: `file-${product.id}`,
    costReceiptId: `cost-${product.id}`, costMinor: 800, currency: "KRW",
  };
}
async function reviewProducts(ready) {
  return Promise.all(ready.products.map(async (product, index) => {
    const running = await planSaurusRun(ready.id, product, items[index], {
      readProductionRelease: async () => release("current", "0.4.58"),
      readOperator1688Session: async () => session("0.4.58"),
    }, budget);
    return acceptSaurusHostedReceipt(running, receiptFor(running));
  }));
}

test("snapshots only the selected products with the existing production-link rule and catalog options", () => {
  const created = batch();
  assert.deepEqual(created.products.map(({ id, sourceUrl }) => [id, sourceUrl]), [["p1", source], ["p2", source]]);
  assert.deepEqual(created.products[0].options, ["빨강", "파랑"]);
  assert.equal(created.selectionHash, saurusSelectionHash(["p2", "p1"]));
  assert.equal(newSaurusBatch("batch", ["p1"], [{
    ...item, chinaLinkUsage: { commonUrl: source, purchaseUrl: purchase },
  }], date).products[0].sourceUrl, "");
  assert.throws(() => newSaurusBatch("batch", ["p1", "missing"], items, date), /모두 확인/);
  assert.throws(() => newSaurusBatch("batch", ["p1", "p1"], items, date), /중복/);
});

test("saves selected option edits only and revalidates fresh 1688 source data on reselection", () => {
  const created = batch();
  const changes = [{ id: " p1 ", options: [" 기본 ", "기본", "", "화이트"] }];
  const next = updateSaurusPreparation(created, changes, true, date);
  assert.equal(next.revision, 1);
  assert.deepEqual(next.products[0].options, ["기본", "화이트"]);
  assert.equal(next.products[0].stage, "waiting_connection");
  assert.notEqual(next.products[0].inputHash, created.products[0].inputHash);
  assert.equal(next.products[1], created.products[1]);
  assert.throws(() => updateSaurusPreparation(created, [{ id: "p3", options: ["기본"] }], true, date), /준비 중인/);
  assert.throws(() => updateSaurusPreparation(created, [{ id: "p1", options: [] }], true, date), /링크와 옵션명/);
  assert.throws(() => updateSaurusPreparation(newSaurusBatch("batch", ["p3"], items, date), [
    { id: "p3", options: ["기본"] },
  ], true, date), /링크와 옵션명/);

  const fresh = newSaurusBatch(next.id, ["p1", "p2"], [{ ...item, productName: "정리함 새 모델" }, second], date);
  const refreshed = refreshSaurusPreparation(next, fresh);
  assert.equal(refreshed.revision, 2);
  assert.equal(refreshed.products[0].stage, "draft");
  assert.deepEqual(refreshed.products[0].options, ["기본", "화이트"]);
  assert.equal(refreshSaurusPreparation(refreshed, fresh), refreshed);
});

test("resolves the production release each attempt and requires evidence from the updated 1688 Importer", async () => {
  const [product] = prepared().products;
  let latest = release("first", "0.4.58");
  let browser = session("0.4.58");
  const checks = {
    readProductionRelease: async (request) => {
      assert.deepEqual(request, { origin: "https://ai-saurus.com", cache: "no-store" });
      return latest;
    },
    readOperator1688Session: async ({ release: checkedRelease, sourceUrl }) => {
      assert.equal(checkedRelease, latest);
      assert.equal(sourceUrl, source);
      return browser;
    },
  };
  const first = await planSaurusRun("batch", product, item, checks, budget);
  latest = release("second", "0.4.59");
  const needsUpdate = await planSaurusRun("batch", product, item, checks, budget);
  assert.equal(needsUpdate.stage, "waiting_1688_login");
  assert.equal(needsUpdate.attempts, 0);
  browser = session("0.4.59", false);
  assert.equal((await planSaurusRun("batch", needsUpdate, item, checks, budget)).stage, "waiting_1688_login");
  browser = session("0.4.59");
  const secondRun = await planSaurusRun("batch", needsUpdate, item, checks, budget);
  assert.equal(secondRun.run.release.deploymentId, "second");
  assert.equal(secondRun.run.release.engineVersion, "engine-second");
  assert.notEqual(secondRun.run.attemptKey, first.run.attemptKey);
  await assert.rejects(() => planSaurusRun("batch", product, { ...item, productName: "변경 상품" }, checks, budget), /제작 입력이 변경/);
  const appWithoutContract = { ...latest, contractVersion: "future-contract" };
  await assert.rejects(() => planSaurusRun("batch", product, item, {
    ...checks, readProductionRelease: async () => appWithoutContract,
  }, budget), /운영 릴리스/);

  for (const change of [
    { itemId: "p2" }, { inputHash: "b".repeat(64) }, { deploymentId: "first" },
    { sessionEvidenceId: "other-chrome" }, { qa: "failed" }, { costMinor: 1001 },
    { hostedImageUrl: "https://ai-saurus.com/account" }, { hostedImageUrl: `${hosting}/temp.jpg?token=1` },
    { hostedImageUrl: "" },
  ]) assert.throws(() => acceptSaurusHostedReceipt(secondRun, { ...receiptFor(secondRun), ...change }), /영수증/);
});

test("batch approval verifies every selected success before changing only its hosted image URL", async () => {
  const ready = prepared();
  const review = { ...ready, products: await reviewProducts(ready) };
  const single = planSaurusApproval(review, ["p1"], items);
  assert.deepEqual(single, [{
    ...item, detailPageAsset: { ...item.detailPageAsset, detailImageUrl: `${hosting}/p1.jpg` },
  }, second, third]);
  const both = planSaurusApproval(review, ["p1", "p2"], items);
  assert.deepEqual(both[1], { ...second, detailPageAsset: { detailImageUrl: `${hosting}/p2.jpg` } });
  assert.equal(both[2], third);
  assert.deepEqual(planSaurusApproval(review, ["p1", "p2"], both), both);
  assert.throws(() => confirmSaurusApprovalReadback(review, ["p1", "p2"], single, date), /다시 확인/);
  assert.deepEqual(confirmSaurusApprovalReadback(review, ["p1", "p2"], both, date).products.map(({ stage }) => stage), ["approved", "approved"]);
  assert.throws(() => planSaurusApproval(review, ["p1", "p3"], items), /검수 통과/);
  assert.throws(() => planSaurusApproval({
    ...review, products: [review.products[0], { ...review.products[1], stage: "failed" }],
  }, ["p1", "p2"], items), /검수 통과/);
  assert.throws(() => planSaurusApproval(review, ["p1", "p2"], [item, {
    ...second, detailPageAsset: { detailImageUrl: `${hosting}/manual.jpg` },
  }, third]), /기존 상세페이지/);
  assert.equal(items[0].detailPageAsset.detailImageUrl, `${hosting}/old.jpg`);
});

test("only retries selected, settled failures and preserves the prior attempt count", async () => {
  const ready = prepared();
  const [product, other] = await reviewProducts(ready);
  const failed = { ...product, stage: "failed", receipt: undefined, error: "합성 실패" };
  const queue = { ...ready, products: [failed, other] };
  const reconciled = new Set([failed.run.attemptKey]);
  assert.throws(() => planSaurusRetry(queue, ["p1"], new Set(), date), /비용 처리/);
  assert.throws(() => planSaurusRetry(queue, ["p1", "p2"], reconciled, date), /비용 처리/);
  const retry = planSaurusRetry(queue, ["p1"], reconciled, date);
  assert.equal(retry.products[0].stage, "waiting_connection");
  assert.equal(retry.products[0].attempts, 1);
  assert.equal(retry.products[1], other);
  const launched = await planSaurusRun(queue.id, retry.products[0], item, {
    readProductionRelease: async () => release("next", "0.4.59"),
    readOperator1688Session: async () => session("0.4.59"),
  }, budget);
  assert.equal(launched.attempts, 2);
  assert.notEqual(launched.run.attemptKey, failed.run.attemptKey);
});
