import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { unzipSync } from "fflate";

const EXTENSION_URL =
  process.env.COMMERCE_OS_EXTENSION_URL ||
  "http://127.0.0.1:3105/api/shopling-stock-state-sync/download-hf95";
const EXPECTED_VERSION = process.env.COMMERCE_OS_EXTENSION_VERSION || "0.6.57";
const PAGE_URL =
  "https://commerce-os-ops-center.vercel.app/china-order-manager/stock-control";
const CHROME_PATH = process.env.COMMERCE_OS_CHROME_PATH || undefined;

const root = await mkdtemp(path.join(os.tmpdir(), "commerce-os-hf95-channel-"));
const extensionDir = path.join(root, "extension");
const profileDir = path.join(root, "profile");
let context;

try {
  const response = await fetch(EXTENSION_URL, { cache: "no-store" });
  assert.equal(
    response.ok,
    true,
    `extension download failed: HTTP ${response.status}`,
  );
  const entries = unzipSync(new Uint8Array(await response.arrayBuffer()));
  for (const [name, bytes] of Object.entries(entries)) {
    const target = path.join(extensionDir, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }

  context = await chromium.launchPersistentContext(profileDir, {
    ...(CHROME_PATH ? { executablePath: CHROME_PATH } : {}),
    headless: false,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--window-position=-32000,-32000",
    ],
  });
  await context.addInitScript(() => {
    window.__commerceOsStockMessages = [];
    window.addEventListener(
      "message",
      (event) => {
        if (event.source === window && event.data?.type) {
          window.__commerceOsStockMessages.push({ ...event.data });
        }
      },
      true,
    );
  });

  const page = await context.newPage();
  await page.route(PAGE_URL, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html><html><body><main>Commerce OS stock channel fixture</main><script>
        (() => {
          const mark = "__commerceOsStockSyncBridgeHF27";
          const outbound = new Map([
            ["COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_PING", "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_PING_HF27"],
            ["COMMERCE_OS_SHOPLING_STOCK_SYNC_START", "COMMERCE_OS_SHOPLING_STOCK_SYNC_START_HF27"],
          ]);
          const inbound = new Map([
            ["COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_READY_HF27", "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_READY"],
            ["COMMERCE_OS_SHOPLING_STOCK_SYNC_STATUS_HF27", "COMMERCE_OS_SHOPLING_STOCK_SYNC_STATUS"],
            ["COMMERCE_OS_SHOPLING_STOCK_SYNC_PROGRESS_HF27", "COMMERCE_OS_SHOPLING_STOCK_SYNC_PROGRESS"],
            ["COMMERCE_OS_SHOPLING_STOCK_SYNC_RESULT_HF27", "COMMERCE_OS_SHOPLING_STOCK_SYNC_RESULT"],
          ]);
          const nativePostMessage = window.postMessage.bind(window);
          window.postMessage = (...args) => {
            const message = args[0];
            const mapped = outbound.get(String(message?.type || ""));
            nativePostMessage(
              mapped ? { ...message, type: mapped, [mark]: true } : message,
              typeof args[1] === "string" ? args[1] : location.origin,
            );
          };
          window.addEventListener("message", (event) => {
            if (event.source !== window || event.origin !== location.origin) return;
            const mapped = inbound.get(String(event.data?.type || ""));
            if (!mapped) return;
            event.stopImmediatePropagation();
            queueMicrotask(() => nativePostMessage(
              { ...event.data, type: mapped, [mark]: true },
              location.origin,
            ));
          }, true);
        })();
      </script></body></html>`,
    });
  });
  await page.goto(PAGE_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.evaluate(() => {
    window.postMessage(
      { type: "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_PING" },
      window.location.origin,
    );
  });
  await page.waitForFunction(
    () =>
      window.__commerceOsStockMessages.some(
        (message) =>
          message.type === "COMMERCE_OS_SHOPLING_STOCK_SYNC_STATUS" &&
          message.statusProbeOk === true &&
          message.idleConfirmed === true,
      ),
    undefined,
    { timeout: 10_000 },
  );

  const messages = await page.evaluate(() => window.__commerceOsStockMessages);
  const receipt = messages.find(
    (message) =>
      message.type === "COMMERCE_OS_SHOPLING_STOCK_SYNC_STATUS" &&
      message.statusProbeOk === true &&
      message.idleConfirmed === true,
  );
  assert.equal(receipt?.extensionVersion, EXPECTED_VERSION);
  assert.equal(
    messages.some((message) => /_START(?:_|$)/.test(String(message.type))),
    false,
    "idle-channel verification must not start a Shopling write",
  );
  const workers = context.serviceWorkers();
  assert.ok(workers.length > 0, "extension service worker must be active");
  const workerVersion = await workers[0].evaluate(
    () => chrome.runtime.getManifest().version,
  );
  assert.equal(workerVersion, EXPECTED_VERSION);

  console.log(
    JSON.stringify(
      {
        ok: true,
        extensionVersion: EXPECTED_VERSION,
        statusProbeOk: receipt.statusProbeOk,
        idleConfirmed: receipt.idleConfirmed,
        stockIdleProbe: receipt.stockIdleProbe,
        externalWrites: [],
      },
      null,
      2,
    ),
  );
} finally {
  await context?.close().catch(() => undefined);
  const resolvedRoot = path.resolve(root);
  if (resolvedRoot.startsWith(path.resolve(os.tmpdir()) + path.sep)) {
    await rm(resolvedRoot, { recursive: true, force: true });
  }
}
