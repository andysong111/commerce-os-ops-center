import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright";

const artifacts = "artifacts/reentry-shadow-ui";
await mkdir(artifacts, { recursive: true });
const compiled = await build({ stdin: { contents: 'import React from "react"; import { createRoot } from "react-dom/client"; import { PurchaseCycleReentryShadowPanel } from "./src/components/china-order-manager/PurchaseCycleReentryShadowPanel"; const root = createRoot(document.getElementById("root")); window.__unmountShadow = () => root.unmount(); root.render(<React.StrictMode><PurchaseCycleReentryShadowPanel targetMonth="2026-10" /></React.StrictMode>);', resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic" });
const script = compiled.outputFiles[0].text;
const server = createServer((req, res) => {
  if (req.url === "/app.js") { res.setHeader("content-type", "application/javascript"); res.end(script); return; }
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end('<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>body{font:15px system-ui;margin:32px}section>div{margin:14px 0}table{width:100%;border-collapse:collapse}td,th{padding:12px;border-bottom:1px solid #ddd;text-align:left}button{padding:12px}article{display:inline-block;padding:18px;margin-right:12px;border:1px solid #ddd}strong{display:block}p{line-height:1.7}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
const page = await context.newPage();
const errors = [], methods = [];
page.on("pageerror", (error) => errors.push(error.message));
let reads = 0, failure = false, fingerprint = "sha256:first";
function report() {
  return { targetCycleMonth: "2026-10", budgetMonth: "2026-09", mode: "SHADOW_READ_ONLY", state: "READY_SHADOW", writesEnabled: false, approvalGranted: false, actualPurchaseExecuted: false, generatedAt: "2026-09-14T00:00:00Z", demandAsOf: "2026-09-13T23:00:00Z", sourceFingerprint: fingerprint, summary: { exactCount: 1, candidateCount: 1, reviewCount: 0 }, blockers: [], warnings: [], rows: [{ barcode: "BAB3-1", productName: "브라우저 검증용 가상 상품", inventoryBasis: "EXACT", inventoryLowQuantity: 20, inventoryHighQuantity: 20, stockQuantity: fingerprint.endsWith("first") ? 20 : 10, openCommitmentQuantity: 30, target44Quantity: 100, candidateQuantity: fingerprint.endsWith("first") ? 50 : 60, allocatedQuantity: 0, stage: "PURCHASE_CANDIDATE", issues: [], manualOpenDifferenceQuantity: 0 }] };
}
await context.route("**/api/**", async (route) => {
  methods.push(route.request().method());
  assert.equal(route.request().method(), "GET", "browser must not issue any mutation");
  assert.ok(route.request().url().includes("/api/china-order-manager/reentry-shadow?targetMonth=2026-10"));
  reads++;
  await route.fulfill({ status: failure ? 503 : 200, contentType: "application/json", body: JSON.stringify(failure ? { ok: false } : { ok: true, report: report() }) });
});
try {
  await page.clock.install();
  await page.goto(origin);
  await page.getByText("최초 사전 점검 완료", { exact: true }).waitFor();
  assert.equal(reads, 1, "StrictMode remount must not lose initial result or double-fetch");
  assert.ok(await page.getByText("BAB3-1", { exact: true }).isVisible());
  assert.equal(await page.getByRole("button", { name: /예산확정|2-Lane|주문 실행/ }).count(), 0);
  await page.screenshot({ path: `${artifacts}/ready.png`, fullPage: true });
  const initialReads = reads; fingerprint = "sha256:changed";
  await page.clock.fastForward(300001);
  await page.getByText("원본 변화 감지 · 재고·미입고를 반영해 다시 계산했습니다.", { exact: true }).waitFor();
  assert.equal(reads, initialReads + 1, "5 minute automatic read");
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
  const beforeHidden = reads; await page.clock.fastForward(900001); assert.equal(reads, beforeHidden, "hidden tabs must not poll");
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" }); document.dispatchEvent(new Event("visibilitychange")); });
  await page.getByText("원본 변화 없음 · 최신성을 다시 확인했습니다.", { exact: true }).waitFor();
  await page.evaluate(() => { Object.defineProperty(navigator, "onLine", { configurable: true, value: false }); window.dispatchEvent(new Event("offline")); });
  const beforeOffline = reads; await page.clock.fastForward(900001); assert.equal(reads, beforeOffline, "offline must not poll");
  failure = true;
  await page.evaluate(() => { Object.defineProperty(navigator, "onLine", { configurable: true, value: true }); window.dispatchEvent(new Event("online")); });
  await page.getByRole("alert").filter({ hasText: "최신 조회에 실패" }).waitFor();
  assert.ok(await page.getByText("이전 기록 · 현재 판단 보류", { exact: true }).isVisible());
  assert.ok(await page.getByRole("cell", { name: "판단 보류", exact: true }).isVisible());
  await page.screenshot({ path: `${artifacts}/failed-safe.png`, fullPage: true });
  failure = false;
  await page.getByRole("button", { name: "읽기 전용 다시 계산", exact: true }).click();
  await page.getByText("사전 점검 결과 · 미승인", { exact: true }).waitFor();
  assert.equal(await page.getByRole("alert").count(), 0);
  await page.evaluate(() => window.__unmountShadow());
  const beforeUnmount = reads; await page.clock.fastForward(900001); assert.equal(reads, beforeUnmount, "unmounted screen must stop polling");
  assert.deepEqual(errors, []); assert.ok(methods.every((method) => method === "GET"));
  await writeFile(`${artifacts}/result.json`, JSON.stringify({ source: "REAL_COMPONENT_WITH_MOCK_READ_API", strictModeInitialRead: true, automaticRecalculation: true, hiddenPause: true, offlinePause: true, unmountStopsPolling: true, failureMarksPreviousStale: true, recovery: true, writeRequests: methods.filter((method) => method !== "GET").length, readRequests: reads, pageErrors: errors }, null, 2));
  console.log("REENTRY_SHADOW_BROWSER_PASS: StrictMode, auto refresh, hidden/offline pause, fail-safe display, recovery, 0 writes");
} finally { await browser.close(); server.close(); }
