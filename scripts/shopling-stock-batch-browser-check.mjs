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
    const commands = new Set();
    let omitLastJob = false;
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === "/api/inventory-stock-control/unified-batch" && req.method() === "POST") {
        const command = req.postDataJSON();
        const sale = command.onSaleBarcodes.length > 0;
        assert.deepEqual(sale ? command.onSaleBarcodes : command.stockoutBarcodes, barcodes);
        assert.equal(command.stockPlanVersion, 1);
        assert.ok(!commands.has(command.batchId));
        commands.add(command.batchId);
        const requestId = "unified-command:" + command.batchId;
        const desiredStatus = sale ? "ON_SALE" : "SOLD_OUT";
        const saved = jobs.map(job => ({...job, desiredStatus, retransmissionRequestId: requestId,
          jobId: `stock-command:${requestId}:${job.barcode}:${desiredStatus}`}));
        return route.fulfill({ json: { ok: true, savedCount: 2, batchId: command.batchId, commandRequestId: requestId,
          jobs: omitLastJob ? saved.slice(0, 1) : saved, stockPlanProducts: [product] } });
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
      window.stockComplete = complete;
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
        const receipt = {job, jobId: job.jobId, outcome: "SUCCEEDED",
          message: "샵플링 모의 접수", evidence: {stockPlanComplete: window.stockComplete}};
        if (window.priorStockReceipt) emit("RESULT_HF27", {...window.priorStockReceipt, finishedAt: Date.now()});
        emit("RESULT_HF27", {...receipt, finishedAt: Date.now()});
        window.priorStockReceipt = receipt;
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
      const firstRunEvents = [...events];
      // Re-enter both codes after either outcome, then reverse the direction, in the same tab.
      for (const direction of ["ON_SALE", "SOLD_OUT"]) {
        events.length = 0;
        await page.evaluate(() => { window.stockComplete = true; window.stockDispatches = []; });
        await page.getByPlaceholder(direction === "ON_SALE" ? /BAA1-1/ : /BBD3-1/).fill(barcodes.join("\n"));
        await page.getByRole("button", {name: /전체 2건 저장·적용 시작/}).click();
        await page.waitForFunction(() => window.stockDispatches.length === 2 &&
          document.querySelector('[data-testid="shopling-direct-run-summary"]')?.textContent?.includes("전체 작업 끝남"));
        assert.deepEqual(events.filter(([,state]) => state === "STARTED").map(([barcode]) => barcode), barcodes);
        assert.deepEqual(events.filter(([,state]) => state === "SUCCEEDED").map(([barcode]) => barcode), barcodes);
      }
      omitLastJob = true;
      events.length = 0;
      await page.evaluate(() => { window.stockDispatches = []; });
      const input = page.getByPlaceholder(/BAA1-1/);
      await input.fill(barcodes.join("\n"));
      await page.getByRole("button", {name: /전체 2건 저장·적용 시작/}).click();
      await page.getByText(/저장된 전송 목록이 일치하지 않아.*BCD8-2/).waitFor();
      assert.equal(await input.inputValue(), barcodes.join("\n"));
      assert.deepEqual(await page.evaluate(() => window.stockDispatches), []);
      assert.deepEqual(events, []);
      assert.equal(commands.size, 4);
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ complete, dispatches, firstRunEvents, repeatedCommandsVerified: 2, incompleteResponseDispatches: 0 }));
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
