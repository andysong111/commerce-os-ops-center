import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

async function cssFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await cssFiles(path));
    else if (entry.name.endsWith(".css")) files.push(path);
  }
  return files;
}

const fixtureSource = `
  import React from "react";
  import { createRoot } from "react-dom/client";
  import { InternalChinaReceiptPanel } from "./src/components/china-order-manager/InternalChinaReceiptPanel.tsx";

  const base = {
    modelNo: "MODEL-01", modelName: "테스트 모델", saleOption: "단품", imageUrl: "",
    orderedQuantity: 10, receivedQuantity: 0, openQuantity: 10, status: "ORDERED",
    ondolpassExpectedQuantity: 10, ondolpassReceivedQuantity: 0,
    ondolpassRowCount: 1, ondolpassReceivedRowCount: 0, ondolpassPendingRowCount: 1,
    ondolpassDisposedRowCount: 0, ondolpassMismatchCount: 0, suggestedReceiptQuantity: 0,
  };
  const mixed = [
    { ...base, barcode: "DONE-1", ondolpassReceivedQuantity: 10, ondolpassReceivedRowCount: 1, ondolpassPendingRowCount: 0, suggestedReceiptQuantity: 10 },
    { ...base, barcode: "DONE-2", ondolpassReceivedQuantity: 6, ondolpassReceivedRowCount: 1, ondolpassPendingRowCount: 0, suggestedReceiptQuantity: 6 },
    { ...base, barcode: "PART-1", ondolpassRowCount: 2, ondolpassReceivedQuantity: 5, ondolpassReceivedRowCount: 1, ondolpassPendingRowCount: 1, suggestedReceiptQuantity: 5 },
    { ...base, barcode: "WAIT-1" },
    { ...base, barcode: "CHECK-1", ondolpassReceivedQuantity: 0, ondolpassMismatchCount: 1 },
  ];
  const forwarderCost = {
    productPurchaseCostKrw: 100000, domesticChinaFreightKrw: 10000, paymentFeeMultiplier: 1.05,
    paymentFeeCostKrw: 5500, orderPaymentCostKrw: 115500, estimatedMultiplier: 1.5,
    estimatedForwarderCostKrw: 57750, estimatedTotalOutflowKrw: 173250,
    actualCostKrw: null, actualTotalOutflowKrw: null, actualMultiplier: null, closedAt: null,
  };
  const mixedObservation = {
    observedAt: "2026-11-21T12:00:00.000Z", snapshotHash: "fixture", rowCount: 6,
    receivedRowCount: 3, pendingRowCount: 2, disposedRowCount: 0, mismatchCount: 1,
    expectedQuantity: 50, displayedQuantity: 50, observedReceivedQuantity: 21, complete: false,
    issues: ["ORDER_NO_MISMATCH:673842:5"],
  };
  const root = createRoot(document.getElementById("app"));
  function render(mode = "mixed") {
    const lines = mode === "unobserved"
      ? mixed.map((line) => ({ ...line, ondolpassExpectedQuantity: null, ondolpassReceivedQuantity: null, ondolpassRowCount: 0, ondolpassReceivedRowCount: 0, ondolpassPendingRowCount: 0, ondolpassMismatchCount: 0, suggestedReceiptQuantity: null }))
      : mode === "complete" ? mixed.slice(0, 2) : mixed;
    root.render(<InternalChinaReceiptPanel
      draftId="fast-purchase-draft:1234567890abcdef1234"
      cycleMonth="2026-11"
      lines={lines}
      forwarderCost={forwarderCost}
      observation={mode === "unobserved" ? null : { ...mixedObservation, mismatchCount: mode === "complete" ? 0 : 1, issues: mode === "complete" ? [] : mixedObservation.issues }}
    />);
  }
  window.setFixtureMode = render;
  render();
`;

const bundled = await build({
  stdin: { contents: fixtureSource, loader: "jsx", resolveDir: process.cwd() },
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{
    name: "fixture-next",
    setup(plugin) {
      plugin.onResolve({ filter: /^next\/(image|navigation)$/ }, ({ path }) => ({ path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({
        loader: "jsx",
        resolveDir: process.cwd(),
        contents: path === "next/image"
          ? 'import React from "react"; export default function Image(props) { return <img {...props} />; }'
          : 'export function useRouter() { return { refresh() {} }; }',
      }));
    },
  }],
});
const javascript = bundled.outputFiles[0].text;
const styles = (await Promise.all((await cssFiles(".next/static")).map((path) => readFile(path, "utf8")))).join("\n");
const server = createServer((request, response) => {
  if (request.url === "/app.js") {
    response.writeHead(200, { "content-type": "application/javascript" });
    response.end(javascript);
    return;
  }
  if (request.url === "/app.css") {
    response.writeHead(200, { "content-type": "text/css" });
    response.end(styles);
    return;
  }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/app.css"><body class="bg-slate-100 p-4"><main id="app" class="mx-auto max-w-5xl"></main><script src="/app.js"></script></body></html>');
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1050, height: 900 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.route("**/*", async (route) => {
  assert.equal(new URL(route.request().url()).origin, origin, "Browser fixture attempted external network");
  return route.continue();
});
try {
  await page.goto(origin);
  await page.getByRole("heading", { name: /확인이 필요한 품목 · 3개/ }).waitFor();
  await page.getByRole("heading", { name: /입고 감지완료 품목 · 2개/ }).waitFor();
  await page.getByText("근거 불일치란?", { exact: true }).waitFor();
  const nestedScroll = await page.locator("#app *").evaluateAll((elements) => elements.filter((element) => {
    const style = getComputedStyle(element);
    const vertical = ["auto", "scroll"].includes(style.overflowY) && element.scrollHeight > element.clientHeight + 1;
    const horizontal = ["auto", "scroll"].includes(style.overflowX) && element.scrollWidth > element.clientWidth + 1;
    return vertical || horizontal;
  }).length);
  assert.equal(nestedScroll, 0, "receipt panel still contains a nested scrollbar");
  assert.ok(await page.getByLabel("DONE-1 이번 입고수량").isVisible());
  await mkdir("artifacts/ondolpass-receipt-ui-browser", { recursive: true });
  await page.screenshot({ path: "artifacts/ondolpass-receipt-ui-browser/mixed.png", fullPage: true });

  await page.evaluate(() => window.setFixtureMode("unobserved"));
  await page.getByRole("heading", { name: /확인이 필요한 품목 · 5개/ }).waitFor();
  assert.equal(await page.getByRole("heading", { name: /입고 감지완료 품목/ }).count(), 0);
  await page.getByText("아직 확인하지 않음", { exact: true }).first().waitFor();

  await page.evaluate(() => window.setFixtureMode("complete"));
  await page.getByRole("heading", { name: /입고 감지완료 품목 · 2개/ }).waitFor();
  assert.equal(await page.getByRole("heading", { name: /확인이 필요한 품목/ }).count(), 0);
  assert.deepEqual(errors, []);
  await writeFile("artifacts/ondolpass-receipt-ui-browser/result.json", JSON.stringify({
    ok: true,
    scenarios: ["mixed", "unobserved", "complete"],
    nestedScrollbars: nestedScroll,
    externalRequests: 0,
    pageErrors: errors,
  }, null, 2));
  console.log("PASS browser: compact receipt groups render three states without nested scrollbars");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
