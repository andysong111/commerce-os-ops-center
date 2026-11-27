import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import path from "node:path";
const tools = createRequire(
  path.join(
    process.env.MONTHLY_PRICE_BROWSER_TOOLS || "/tmp/monthly-price-browser",
    "package.json",
  ),
);
const { build } = tools("esbuild"),
  { chromium } = tools("playwright");
const draftId = "fast-purchase-draft:5cabcbeeffd1b884a074";
const bundle = await build({
  stdin: {
    contents: `
import React from 'react';import {createRoot} from 'react-dom/client';
import {ReceiptSeoPanel} from './src/components/china-order-manager/ReceiptSeoPanel';
createRoot(document.querySelector('main')).render(<ReceiptSeoPanel draftId="${draftId}"/>);
`,
    resolveDir: process.cwd(),
    loader: "tsx",
  },
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  alias: { "@": path.join(process.cwd(), "src") },
});
const server = createServer((req, res) => {
  if (req.url === "/ui.js") {
    res.setHeader("content-type", "application/javascript");
    res.end(bundle.outputFiles[0].text);
  } else {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end('<main></main><script src="/ui.js"></script>');
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.MONTHLY_PRICE_BROWSER_EXECUTABLE
      ? { executablePath: process.env.MONTHLY_PRICE_BROWSER_EXECUTABLE }
      : {}),
  });
  const page = await browser.newPage();
  const runId = "seo-run-receipt-testabcdef",
    itemId = "card-a";
  const row = (barcode, state, reason, overrides = {}) => ({
    barcode,
    state,
    reason,
    quantity: 10,
    itemId,
    runId,
    draftId,
    model: "테스트",
    rotation: "입고 목록 편입",
    markets: 0,
    ...overrides,
  });
  let phase = "empty",
    created = 0,
    generations = 0,
    handoffs = 0,
    terminal = false,
    acceptedToken = "";
  const rows = () =>
    phase === "empty"
      ? []
      : [
          row("BCE6-1", phase, "같은 상품의 첫 옵션"),
          row("BCE6-2", phase, "같은 상품의 둘째 옵션"),
          row("BBA1-3", "HOLD", "다른 상품 판매중 전송 접수 대기", {
            itemId: "other",
            runId: "",
          }),
          ...(generations
            ? [
                row("BBA9-1", "READY", "나중에 추가된 상품", {
                  itemId: "later-card",
                  runId: "later-run",
                }),
              ]
            : []),
        ];
  await page.route("**/api/china-order-manager/receipt-seo?*", (r) => {
    assert.equal(
      new URL(r.request().url()).searchParams.get("draftId"),
      draftId,
    );
    return r.fulfill({ json: { ok: true, rows: rows() } });
  });
  await page.route("**/api/seo-run-jobs", (r) => {
    const d = r.request().postDataJSON();
    assert.equal(d.receiptDraftId, draftId);
    assert.equal(d.runs.length, 1);
    assert.equal(d.runs[0].id, itemId);
    assert.equal(d.runs[0].runId, runId);
    assert.equal(d.runs[0].autoQueueShoplingRegistration, false);
    generations++;
    phase = "ACTIVE";
    return r.fulfill({ json: { ok: true, jobs: [{ run_id: runId }] } });
  });
  await page.route("**/api/shopling-market-auto-orchestration", (r) => {
    const d = r.request().postDataJSON();
    assert.deepEqual(d.runIds, [runId]);
    assert.equal(d.receiptDraftId, draftId);
    if (d.action === "receipt_handoff_status")
      return r.fulfill({
        json: {
          ok: true,
          handoff: created
            ? {
                orchestrationId: "original",
                activeAgent: false,
                terminal,
                state: terminal ? "completed" : "market_ready",
              }
            : null,
        },
      });
    assert.equal(d.action, "create");
    created++;
    acceptedToken = d.handoffToken;
    return r.fulfill({
      json: {
        ok: true,
        orchestrationId: "original",
        handoffToken: acceptedToken,
      },
    });
  });
  await page.exposeFunction("originalHandoff", (token) => {
    handoffs++;
    assert.equal(token, acceptedToken);
  });
  await page.addInitScript(() => {
    window.addEventListener("message", (event) => {
      const { type, requestId, token } = event.data || {};
      if (type === "commerce-os-shopling-market-auto-probe-v0330")
        window.postMessage(
          {
            type: "commerce-os-shopling-market-auto-probe-ack-v0330",
            requestId,
            version: "0.3.30",
            ok: true,
          },
          location.origin,
        );
      if (type === "commerce-os-shopling-market-auto-handoff-v0330") {
        window.originalHandoff(token);
        window.postMessage(
          {
            type: "commerce-os-shopling-market-auto-handoff-ack-v0330",
            requestId,
            ok: true,
          },
          location.origin,
        );
      }
    });
  });
  await page.goto("http://127.0.0.1:" + server.address().port);
  const newButton = page.getByRole("button", { name: "입고건 SEO 대량등록" });
  await page.getByText("입고확정 후 대상 B코드가 여기에 표시됩니다.").waitFor();
  assert.ok(await newButton.isDisabled());
  phase = "NEW";
  await page.getByRole("button", { name: "결과 새로고침" }).click();
  await page.getByText(/등록 가능 상품 1개/).waitFor();
  await page.getByText("B코드별 등록 결과와 물갈이 이력").click();
  await page.getByText(/다른 상품 판매중 전송 접수 대기/).waitFor();
  await newButton.click();
  await page.getByText(/대기열에서 상품 자료를 준비/).waitFor();
  assert.equal(generations, 1);
  assert.equal(created, 0);
  phase = "READY";
  await page.reload();
  await page
    .getByText("입고 상품을 기존 마켓전송 대기열에 전달했습니다.")
    .waitFor();
  assert.equal(created, 1);
  assert.equal(handoffs, 1);
  await page.reload();
  await page.getByText(/원래 마켓전송 결과 확인 중/).waitFor();
  assert.equal(handoffs, 1);
  assert.equal(created, 1);
  await page.getByRole("button", { name: "기존 등록 작업 이어가기" }).click();
  await page.getByText(/원래 마켓전송 결과 확인 중/).waitFor();
  assert.equal(handoffs, 1);
  terminal = true;
  phase = "DONE";
  await page.getByRole("button", { name: "결과 새로고침" }).click();
  await page.getByText("선택한 입고 상품의 마켓전송 완료").waitFor();
  assert.equal(generations, 1);
  assert.equal(created, 1);
  assert.equal(handoffs, 1);
  console.log(
    "PASS receipt SEO actual UI: empty intake, two sibling options, held row, stable queue, reload recovery, exact original handoff, later card excluded",
  );
} finally {
  await browser?.close();
  server.close();
}
