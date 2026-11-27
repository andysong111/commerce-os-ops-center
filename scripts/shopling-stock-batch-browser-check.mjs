import assert from "node:assert/strict";
import { chromium } from "playwright";

const origin = new URL(process.env.INVENTORY_UI_BASE_URL || "http://127.0.0.1:3210").origin;
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
});
const barcodes = ["BCD8-1", "BCD8-2"];
const jobs = barcodes.map((barcode, index) => ({
  barcode, jobId: "fixture-" + barcode, desiredStatus: "ON_SALE", productKind: "OPTION",
  productName: "컨트롤러", modelNo: "AAA365", goodsKeys: ["135791"],
  stockBatchPlan: "fixture-plan-" + barcode, stockBatchDependencies: barcodes.slice(0, index),
  desiredSince: "2026-11-27T00:00:00Z",
}));
const product = {
  goodsKey: "135791", productName: "컨트롤러", partnerGoodsCode: "AAA365", productSaleStatus: "C",
  beforeAvailability: "ALL_SOLD_OUT", afterAvailability: "ALL_ON_SALE",
  finalizeBarcode: "BCD8-2", parentDesiredStatus: "ON_SALE",
  options: jobs.map(({ barcode }, index) => ({
    barcode, optionId: String(index + 1), selection: [{ title: "기종", value: index ? "PS5" : "PS4" }],
    optionStatus: "C", plannedStatus: "B",
  })),
};

try {
  for (const complete of [true, false]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const events = [];
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === "/api/inventory-stock-control/unified-batch" && req.method() === "POST") {
        const command = req.postDataJSON();
        assert.deepEqual(command.onSaleBarcodes, barcodes);
        assert.equal(command.stockPlanVersion, 1);
        return route.fulfill({ json: { ok: true, savedCount: 2, jobs, stockPlanProducts: [product] } });
      }
      if (url.pathname === "/api/inventory-stock-control/sync" && req.method() === "POST") {
        const { barcode, outcome } = req.postDataJSON();
        events.push([barcode, outcome]);
        return route.fulfill({ json: { ok: true } });
      }
      if (req.method() !== "GET" && req.method() !== "HEAD") throw new Error("Unexpected write to " + url.pathname);
      if (url.pathname.startsWith("/api/")) return route.fulfill({ json: { ok: true, jobs: [], items: [], report: { rows: [] } } });
      return route.continue();
    });
    await page.addInitScript(({ complete }) => {
      window.stockDispatches = [];
      const prefix = "COMMERCE_OS_SHOPLING_STOCK_SYNC_";
      const emit = (type, data) => window.postMessage({ type: prefix + type, extensionVersion: "0.6.62", ...data }, location.origin);
      window.addEventListener("message", e => {
        if (e.origin !== location.origin || e.source !== window) return;
        if (e.data?.type === prefix + "EXTENSION_PING_HF27") {
          emit("EXTENSION_READY_HF27", {});
          emit("STATUS_HF27", { idleConfirmed: true, statusProbeOk: true, active: null });
        }
        if (e.data?.type === prefix + "SESSION_PREFLIGHT_REQUEST") {
          emit("SESSION_PREFLIGHT_RESULT", { ok: true, authenticated: true, requestId: e.data.requestId });
        }
        if (e.data?.type !== prefix + "START_HF27") return;
        const job = e.data.job;
        window.stockDispatches.push([job.barcode, job.stockBatchPlan]);
        emit("RESULT_HF27", { job, jobId: job.jobId, outcome: "SUCCEEDED", finishedAt: Date.now(),
          message: "샵플링 모의 접수", evidence: { stockPlanComplete: complete } });
      });
    }, { complete });
    try {
      await page.goto(origin + "/china-order-manager/stock-control", { waitUntil: "domcontentloaded" });
      await page.getByText(/자동화 연결됨 · v0.6.62/).first().waitFor();
      await page.getByPlaceholder(/BAA1-1/).fill(barcodes.join("\n"));
      await page.getByRole("button", { name: /전체 2건 저장·적용 시작/ }).click();
      await page.waitForFunction((complete) => {
        const el = document.querySelector('[data-testid="shopling-direct-run-summary"]');
        return complete ? el?.textContent?.includes("2/2건") && el?.textContent?.includes("전체 작업 끝남")
          : el?.textContent?.includes("확인 필요") || el?.textContent?.includes("작업 중단");
      }, complete, { timeout: 20_000 });
      const dispatches = await page.evaluate(() => window.stockDispatches);
      const expected = complete ? jobs : jobs.slice(0, 1);
      assert.deepEqual(dispatches, expected.map(j => [j.barcode, j.stockBatchPlan]));
      assert.deepEqual(events.filter(([,status]) => status === "STARTED").map(([b]) => b), expected.map(j => j.barcode));
      assert.deepEqual(events.filter(([,status]) => status === "SUCCEEDED").map(([b]) => b), complete ? barcodes : []);
      if (!complete) assert.ok(events.some(([barcode, outcome]) => barcode === "BCD8-1" && outcome === "UNCERTAIN"));
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ complete, dispatches, events }));
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
