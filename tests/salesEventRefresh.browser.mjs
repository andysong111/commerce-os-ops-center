import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
const require = createRequire(`${process.env.SALES_EVENT_TEST_TOOLS_DIR}/package.json`);
const { build } = require("esbuild"), { chromium } = require("playwright");
const dir = "artifacts/sales-event-refresh-ui";
await mkdir(dir, { recursive: true });
const compiled = await build({ stdin: { contents: 'import React from "react"; import { createRoot } from "react-dom/client"; import { SalesEventSyncControls } from "./src/app/stage8-sales-events/SalesEventSyncControls"; const root=createRoot(document.getElementById("root")); window.renderState=(state)=>root.render(<SalesEventSyncControls state={state} requestId="95c910a4-88ff-4c05-b181-9d57ab497bc0" planFingerprint={"sha256:"+"a".repeat(64)} />); window.renderState("READY_CANARY");', resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic" });
const server = createServer((req, res) => {
  res.setHeader("content-type", req.url === "/app.js" ? "application/javascript" : "text/html; charset=utf-8");
  res.end(req.url === "/app.js" ? compiled.outputFiles[0].text : '<html lang="ko"><meta charset="utf-8"><body><h1>판매 후보 재수집 검증</h1><div id="root"></div><script src="/app.js"></script></body></html>');
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch(); const page = await browser.newPage();
const bodies = [], errors = []; let accept = false, succeed = false, hold;
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (dialog) => accept ? dialog.accept() : dialog.dismiss());
await page.route("**/api/**", async (route) => {
  const request = route.request(); assert.equal(request.method(), "POST");
  const body = request.postDataJSON(); assert.equal(body.action, "refresh", "no canonical, purchase, inventory or source writes"); bodies.push(body);
  if (hold) await hold;
  await route.fulfill({ status: succeed ? 202 : 409, contentType: "application/json", body: JSON.stringify(succeed ? { ok: true, accepted: true, message: "후보 접수 · 공식 반영 아님" } : { ok: false, message: "후보가 변경됐습니다" }) });
});
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const button = page.getByRole("button", { name: "최신 판매 후보 다시 수집", exact: true });
  await button.click(); assert.equal(bodies.length, 0, "cancel must not send any request");
  accept = true; await button.click(); await page.getByRole("status").filter({ hasText: "후보가 변경됐습니다" }).waitFor();
  assert.equal(bodies.length, 1); assert.equal(await button.isEnabled(), true);
  for (const state of ["QUEUED", "RUNNING", "FAILED", "IDLE"]) {
    await page.evaluate((value) => window.renderState(value), state); await button.waitFor({ state: "hidden" });
  }
  await page.evaluate(() => window.renderState("READY_CANARY")); await button.waitFor();
  let release; hold = new Promise((resolve) => { release = resolve; }); succeed = true;
  await button.evaluate((node) => { node.click(); node.click(); });
  await page.waitForFunction(() => document.querySelector("button").disabled);
  assert.equal(await button.isDisabled(), true);
  await page.waitForTimeout(100); assert.equal(bodies.length, 2, "synchronous double click must enqueue once");
  release(); await page.getByRole("status").filter({ hasText: "후보 접수 · 공식 반영 아님" }).waitFor();
  assert.equal(bodies[1].expectedRequestId, "95c910a4-88ff-4c05-b181-9d57ab497bc0");
  assert.equal(bodies[1].expectedPlanFingerprint, `sha256:${"a".repeat(64)}`);
  assert.equal(bodies[1].confirmation, "REFRESH_CANDIDATE"); assert.deepEqual(errors, []);
  await page.screenshot({ path: `${dir}/accepted.png`, fullPage: true });
  await writeFile(`${dir}/result.json`, JSON.stringify({ source: "REAL_COMPONENT_MOCK_API", cancelledWithoutRequest: true, conflictVisible: true, activeStatesHidden: true, doubleClickSingleRequest: true, confirmationPinned: true, canonicalWrites: 0, purchaseWrites: 0, pageErrors: errors }, null, 2));
  console.log("SALES_EVENT_REFRESH_BROWSER_PASS: cancel, conflict, eligibility, double click, pinned confirmation, zero canonical/purchase writes");
} finally { await browser.close(); server.close(); }
