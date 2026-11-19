import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { patchHf99EndedProductSkip } from "../src/lib/shoplingStockHf99Patch.ts";

async function hf99Hooks(fetchResult) {
  const source = patchHf99EndedProductSkip(
    await readFile("public/shopling-stock-state-sync/content-ops-v025.js", "utf8"),
  );
  const messages = [];
  const starts = [];
  const sandbox = { __COMMERCE_OS_EXPOSE_STOCK_HF87_OPS_TEST_HOOKS__: true };
  const window = {
    addEventListener() {},
    postMessage(message) { messages.push(message); },
  };
  const chrome = {
    runtime: {
      getManifest: () => ({ version: "0.6.59" }),
      onMessage: { addListener() {} },
      async sendMessage(message) {
        starts.push(message);
        return { ok: true, active: { stage: "A21_LIST", job: message.job } };
      },
    },
  };
  const fetch = async () => ({
    ok: true,
    status: 200,
    async json() { return { ok: true, result: fetchResult }; },
  });
  new Function("globalThis", "window", "location", "chrome", "fetch", source)(
    sandbox,
    window,
    { origin: "https://commerce-os-ops-center.vercel.app" },
    chrome,
    fetch,
  );
  return { hooks: sandbox.__commerceOsStockHf87OpsTestHooks, messages, starts };
}

test("HF99 completes an ended-only B-code without opening A21", async () => {
  const ended = {
    goodsKeys: [],
    transmissions: [],
    receipts: [],
    noActionableGoodsKeys: true,
    skippedEndedCount: 2,
    skippedEndedGoodsKeys: [
      { goodsKey: "108854", productSaleStatus: "E" },
      { goodsKey: "108855", productSaleStatus: "E" },
    ],
  };
  const { hooks, messages, starts } = await hf99Hooks(ended);
  await hooks.startFromOps({
    jobId: "ended-only",
    barcode: "BAF3-3",
    productKind: "OPTION",
    desiredStatus: "ON_SALE",
  });

  assert.equal(starts.length, 0);
  const result = messages.find((message) => message.outcome === "SUCCEEDED");
  assert.ok(result);
  assert.equal(result.evidence.code, "HF99_ENDED_ONLY_NO_TRANSMISSION");
  assert.equal(result.evidence.shoplingTransmissionStarted, false);
  assert.match(result.message, /판매종료\(E\) 2건/);
  assert.match(result.message, /A21 전송은 실행하지 않았습니다/);
});

test("HF99 sends only the remaining actionable goods key", async () => {
  const mixed = {
    goodsKeys: ["108872"],
    transmissions: [{
      goodsKey: "108872",
      optionCount: 1,
      transmissionKind: "PRODUCT_SALE_STATUS_SEND",
      effectiveProductKind: "SINGLE",
    }],
    receipts: [{ matchedGoodsKey: "108872", mutated: false }],
    noActionableGoodsKeys: false,
    skippedEndedCount: 2,
    skippedEndedGoodsKeys: [
      { goodsKey: "108854", productSaleStatus: "E" },
      { goodsKey: "108855", productSaleStatus: "E" },
    ],
  };
  const { hooks, starts } = await hf99Hooks(mixed);
  await hooks.startFromOps({
    jobId: "mixed",
    barcode: "BAF3-3",
    productKind: "OPTION",
    desiredStatus: "SOLD_OUT",
  });

  assert.equal(starts.length, 1);
  assert.deepEqual(starts[0].job.goodsKeys, ["108872"]);
  assert.equal(starts[0].job.stockStateTransmissions.length, 1);
});

test("HF99 package and page expose the ended-product-safe extension", async () => {
  const [route, page, workflow] = await Promise.all([
    readFile("src/app/api/shopling-stock-state-sync/download-hf99/route.ts", "utf8"),
    readFile("src/app/china-order-manager/stock-control/page.tsx", "utf8"),
    readFile(".github/workflows/shopling-stock-state-sync-ci.yml", "utf8"),
  ]);
  assert.match(route, /const VERSION = "0\.6\.59"/);
  assert.match(route, /SUCCEED_WITHOUT_A21_TRANSMISSION/);
  assert.match(page, /download-hf100/);
  assert.match(page, /v0\.6\.60 다운로드/);
  assert.match(workflow, /shoplingStockEndedSkipHf99\.test\.mjs/);
});

test("HF99 patch fails closed when the proven HF87 operations checkpoints are absent", () => {
  assert.throws(
    () => patchHf99EndedProductSkip("not-the-proven-content-ops-source"),
    /shopling_stock_hf99_patch_checkpoint_mismatch/,
  );
});
