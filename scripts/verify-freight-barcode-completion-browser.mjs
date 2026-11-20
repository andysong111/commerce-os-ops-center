import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { chromium } from "playwright";

const draftId = "fast-purchase-draft:1234567890abcdef1234";
const cycleMonth = "2026-11";
const records = [
  freightRecord("history-older", "673842", "2026-11-19T02:17:00.000Z"),
  freightRecord(
    "history-delivered",
    "673626, 673624",
    "2026-11-19T02:34:00.000Z",
  ),
];

function freightRecord(id, applicationNo, updatedAt) {
  const parsedItems = [
    {
      id: `${id}-item`,
      rowNo: 1,
      itemName: "브라우저 검증 상품",
      optionText: "검정",
      quantity: 2,
    },
  ];
  return {
    id,
    applicationNo,
    title: "온돌패스 전달 최종본",
    rawText: `신청번호 ${applicationNo}`,
    parsedItems,
    productMasterMatches: [
      {
        itemId: `${id}-item`,
        matchedModelNo: "TEST-1",
        matchedBarcode: "880000000001",
      },
    ],
    memo: "직원 전달 완료",
    createdAt: updatedAt,
    updatedAt,
    source: "manual-paste",
    pdfVersion: 1,
    itemCount: 1,
    matchedItemCount: 1,
    items: parsedItems,
    version: 1,
  };
}

async function unusedPort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForServer(origin, processOutput) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(origin, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // The local Next.js server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Local Next.js server did not start.\n${processOutput.join("")}`);
}

const port = await unusedPort();
const origin = `http://127.0.0.1:${port}`;
const nextBin = path.join(
  process.cwd(),
  "node_modules",
  "next",
  "dist",
  "bin",
  "next",
);
const processOutput = [];
const nextProcess = spawn(
  process.execPath,
  [nextBin, "dev", "--hostname", "127.0.0.1", "--port", String(port)],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      FREIGHT_BARCODE_HISTORY_STORAGE: "memory",
      NEXT_PUBLIC_SUPABASE_URL: "https://browser-fixture.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
        "sb_publishable_freight_barcode_browser_fixture",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
nextProcess.stdout.on("data", (chunk) => processOutput.push(String(chunk)));
nextProcess.stderr.on("data", (chunk) => processOutput.push(String(chunk)));

let browser;
try {
  await waitForServer(origin, processOutput);
  browser = await chromium.launch(
    process.platform === "win32" ? { headless: true, channel: "chrome" } : { headless: true },
  );
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const writes = [];
  const pageErrors = [];
  let completion = null;
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    assert.equal(url.origin, origin, "Browser fixture attempted external API access");
    if (url.pathname === "/api/freight-barcode-requests") {
      assert.equal(request.method(), "GET");
      return route.fulfill({ json: { records } });
    }
    if (
      url.pathname ===
      "/api/china-order-manager/freight-barcode-completion"
    ) {
      if (request.method() === "GET") {
        return route.fulfill({ json: { ok: true, completion } });
      }
      assert.equal(request.method(), "POST");
      const body = request.postDataJSON();
      assert.deepEqual(body, {
        draftId,
        cycleMonth,
        historyRecordId: "history-delivered",
      });
      writes.push(body);
      completion = {
        draftId,
        cycleMonth,
        historyRecordId: "history-delivered",
        applicationNo: "673626, 673624",
        itemCount: 1,
        matchedItemCount: 1,
        recordUpdatedAt: "2026-11-19T02:34:00.000Z",
        evidenceHash: `sha256:${"a".repeat(64)}`,
        completedAt: "2026-11-21T00:00:00.000Z",
      };
      return route.fulfill({
        status: 201,
        json: {
          ok: true,
          completion,
          alreadyCompleted: false,
          message: "선택한 서버 문서를 완료 근거로 확정했습니다.",
        },
      });
    }
    return route.fulfill({ status: 404, json: { error: "Unexpected fixture API" } });
  });

  const url = `${origin}/freight-barcode-request?month=${cycleMonth}&source=purchase-run&draft=${encodeURIComponent(draftId)}`;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "서버 문서 보관함" }).waitFor();
  const finalize = page.getByRole("button", {
    name: "선택 파일로 바코드 업무 종결",
  });
  assert.equal(await finalize.isDisabled(), true);
  const checkboxes = page.getByRole("checkbox", {
    name: /서버 문서를 종결 근거로 선택/,
  });
  assert.equal(await checkboxes.count(), 2);
  await page
    .getByRole("checkbox", {
      name: "673626, 673624 서버 문서를 종결 근거로 선택",
    })
    .check();
  assert.equal(await finalize.isEnabled(), true);
  page.once("dialog", (dialog) => dialog.accept());
  await finalize.click();
  await page
    .getByRole("button", { name: "바코드 업무 종결 완료" })
    .waitFor();
  assert.equal(writes.length, 1);
  assert.equal(
    await page.getByRole("link", { name: "4단계 입고로 이동" }).getAttribute("href"),
    `/china-order-manager?run=${encodeURIComponent(draftId)}`,
  );
  assert.match(await page.getByText(/완료 근거: 신청번호/).innerText(), /673626, 673624/);

  await page.reload({ waitUntil: "domcontentloaded" });
  const selected = page.getByRole("checkbox", {
    name: "673626, 673624 서버 문서를 종결 근거로 선택",
  });
  await selected.waitFor();
  assert.equal(await selected.isChecked(), true);
  assert.equal(await selected.isDisabled(), true);
  assert.equal(
    await page.getByRole("button", { name: "바코드 업무 종결 완료" }).isDisabled(),
    true,
  );
  assert.equal(
    await page.getByRole("button", { name: "완료 근거 보존" }).isDisabled(),
    true,
  );
  assert.equal(writes.length, 1, "Reload repeated the completion mutation");
  assert.deepEqual(pageErrors, []);

  await mkdir("artifacts/freight-barcode-completion-browser", {
    recursive: true,
  });
  await page.screenshot({
    path: "artifacts/freight-barcode-completion-browser/completed.png",
    fullPage: true,
  });
  await writeFile(
    "artifacts/freight-barcode-completion-browser/result.json",
    JSON.stringify(
      {
        ok: true,
        scenarios: 2,
        writeRequests: writes,
        externalRequests: 0,
        pageErrors,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS browser: one selected server file completes stage 3 and reload preserves its evidence",
  );
} finally {
  if (browser) await browser.close();
  nextProcess.kill("SIGTERM");
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 5_000);
    nextProcess.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}
