import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright";
import { loadPurchaseCycleModule, receiptId, draftId, barcode, at, stockFixture } from "../tests/helpers/purchaseCycleHarness.mjs";

// Real production React component, local mocked server only. No credentials,
// Shopling/1688/database network or business-data mutations are permitted.
const closure = loadPurchaseCycleModule("src/lib/purchaseCycleClosureCore.ts");
function report(month = "2026-09", pending = false) {
  return closure.buildPurchaseCycleClosureReport({ cycleMonth: month, orderClosed: true, orderCount: 1, unassignedLineCount: 0, orderedQuantity: 7, receivedQuantity: 7, openQuantity: 0, receiptState: "COMPLETE", landedCostState: "COMPLETE", fundingState: "COMPLETE", approvedPriceCheckPending: false, followups: [{ receiptId, draftId, cycleMonth: month, lineCount: 1, barcodes: [barcode], receivedQuantity: 7, state: pending ? "PENDING" : "VERIFIED", canRetry: pending, errorCode: pending ? "RECEIPT_FOLLOWUP_READBACK_MISSING" : null, verifiedAt: pending ? null : at, fingerprint: "fixture" }], stock: stockFixture(), warnings: [] });
}
const bundled = await build({
  stdin: { contents: 'import React from "react"; import { createRoot } from "react-dom/client"; import { PurchaseCycleClosurePanel } from "./src/components/china-order-manager/PurchaseCycleClosurePanel.tsx"; createRoot(document.getElementById("app")).render(<PurchaseCycleClosurePanel refreshKey={1} />);', loader: "jsx", resolveDir: process.cwd() },
  bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "fixture-next-navigation", setup(plugin) {
    plugin.onResolve({ filter: /^next\/(link|navigation)$/ }, ({ path }) => ({ path, namespace: "fixture" }));
    plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ loader: "jsx", resolveDir: process.cwd(), contents: path === "next/link"
      ? 'import React from "react"; export default function Link({prefetch, children, ...props}) { return <a {...props}>{children}</a>; }'
      : 'import { useSyncExternalStore } from "react"; const subscribe=(fn)=>{window.addEventListener("popstate",fn);return()=>window.removeEventListener("popstate",fn)}; const get=()=>window.location.pathname+window.location.search; const useLocation=()=>useSyncExternalStore(subscribe,get,get); export function usePathname(){return useLocation().split("?")[0]} export function useSearchParams(){return new URLSearchParams(useLocation().split("?")[1]||"")}' }));
  } }],
});
const javascript = bundled.outputFiles[0].text;
const server = createServer((request, response) => {
  if (request.url === "/app.js") { response.writeHead(200, { "content-type": "application/javascript" }); response.end(javascript); return; }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end('<!doctype html><html lang="ko"><meta charset="utf-8"><style>body{font:16px system-ui;margin:32px;max-width:1200px}button,a{cursor:pointer;margin:8px;padding:12px}section{border:1px solid #ccc;padding:24px}p{line-height:1.6}</style><div id="app"></div><script src="/app.js"></script></html>');
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1360, height: 1100 } });
let mode = "pending";
const writes = [], errors = [], statuses = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.route("**/*", async (route) => {
  const request = route.request(); const url = new URL(request.url());
  assert.equal(url.origin, origin, "Browser fixture attempted external network");
  if (!url.pathname.startsWith("/api/")) return route.continue();
  if (request.method() === "POST") {
    assert.equal(url.pathname, "/api/china-order-manager/receipts/followup");
    assert.deepEqual(request.postDataJSON(), { receiptId }); writes.push(request.postDataJSON());
    await new Promise((resolve) => setTimeout(resolve, 150)); mode = "ready";
    return route.fulfill({ json: { ok: true, status: { state: "VERIFIED" } } });
  }
  assert.equal(request.method(), "GET"); assert.equal(url.pathname, "/api/china-order-manager/cycle-status");
  const month = url.searchParams.get("month") || "2026-09";
  statuses.push(month);
  const requestMode = mode;
  if (requestMode === "slow-september" && month === "2026-09") await new Promise((resolve) => setTimeout(resolve, 500));
  if (requestMode === "fail") return route.fulfill({ status: 503, json: { ok: false, message: "fixture read unavailable" } });
  return route.fulfill({ json: { ok: true, report: report(month, requestMode === "pending") } }).catch(() => undefined);
});
try {
  await page.goto(`${origin}/china-order-manager?month=2026-09`);
  const retry = page.getByRole("button", { name: "입고 후속 반영만 재시도", exact: true });
  await retry.waitFor();
  await retry.evaluate((button) => { button.click(); button.click(); });
  await page.getByRole("heading", { name: "다음 발주계산 준비 완료", exact: true }).waitFor();
  assert.equal(writes.length, 1, "double-click replayed quantity follow-up");
  assert.equal(await page.getByRole("link", { name: "최신 재고로 다음 발주계산" }).getAttribute("href"), "/china-order-manager/cash-envelope");
  console.log("PASS browser: double-click performs one receiptId-only follow-up and re-reads completion");
  mode = "fail";
  await page.getByRole("button", { name: "상태 새로고침", exact: true }).click();
  await page.getByRole("alert").waitFor();
  assert.equal(await page.getByRole("heading", { name: "다음 발주계산 준비 완료", exact: true }).count(), 0);
  mode = "pending";
  await page.getByRole("button", { name: "다시 확인", exact: true }).click();
  await retry.waitFor(); assert.equal(writes.length, 1);
  console.log("PASS browser: read failure clears stale completion; retry-read never repeats a write");
  mode = "slow-september";
  const before = statuses.length;
  await page.getByRole("button", { name: "상태 새로고침", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('section[aria-busy="true"]'));
  await page.evaluate(() => { history.pushState(null, "", "/china-order-manager?month=2026-08"); window.dispatchEvent(new PopStateEvent("popstate")); });
  await page.getByText("2026-08 · 발주사이클", { exact: true }).waitFor();
  await page.getByRole("heading", { name: "다음 발주계산 준비 완료", exact: true }).waitFor();
  await page.waitForTimeout(700);
  assert.equal(await page.getByText("2026-09 · 발주사이클", { exact: true }).count(), 0);
  assert.ok(statuses.length > before); assert.equal(writes.length, 1); assert.deepEqual(errors, []);
  console.log("PASS browser: late old-month response cannot replace current-month proof");
  await mkdir("artifacts/purchase-cycle-browser", { recursive: true });
  await page.screenshot({ path: "artifacts/purchase-cycle-browser/current-month.png", fullPage: true });
  await writeFile("artifacts/purchase-cycle-browser/result.json", JSON.stringify({ ok: true, scenarios: 3, writeRequests: writes, databaseWrites: 0, externalRequests: 0, pageErrors: errors }, null, 2));
} finally {
  await browser.close(); await new Promise((resolve) => server.close(resolve));
}
