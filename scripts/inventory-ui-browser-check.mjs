import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.INVENTORY_UI_BASE_URL || 'https://commerce-os-ops-center.vercel.app';
const origin = new URL(base).origin;
const output = 'artifacts/inventory-ui';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, locale: 'ko-KR' });
const page = await context.newPage();
const network = [];
const errors = [];
const observed = [];
const starts = new Map();
let passed = false;
const safe = value => String(value).replace(/https?:\/\/\S+/g, '[url]').replace(/[A-Za-z0-9+/_=-]{48,}/g, '[redacted]').slice(0, 500);

// This browser can only READ the stock screen. Never touch a stock reset,
// Shopling execution, order, payment, or any unrelated background writer.
await context.route('**/*', route => {
  const request = route.request();
  const url = new URL(request.url());
  if (!['GET', 'HEAD'].includes(request.method())) {
    network.push({ method: request.method(), path: url.pathname, blockedWrite: true });
    return route.fulfill({ status: 403, contentType: 'application/json', body: '{"ok":false,"code":"BROWSER_CHECK_WRITES_BLOCKED"}' });
  }
  if (url.origin !== origin) return route.abort('blockedbyclient');
  if (url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/inventory-stock-control')) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[],"tasks":[],"jobs":[]}' });
  }
  return route.continue();
});
await context.addInitScript(() => {
  // Simulate ONLY the extension presence handshake. Never simulate execution.
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.type === 'COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_PING_HF27') {
      window.postMessage({ type: 'COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_READY_HF27' }, location.origin);
    }
  });
});
page.on('pageerror', error => errors.push(safe(error.message)));
page.on('request', request => {
  if (new URL(request.url()).pathname.startsWith('/api/inventory-stock-control')) starts.set(request, Date.now());
});
page.on('response', async response => {
  const request = response.request();
  if (!starts.has(request)) return;
  const entry = { method: request.method(), path: new URL(request.url()).pathname, status: response.status(), durationMs: Date.now() - starts.get(request) };
  try {
    const payload = await response.json();
    entry.ok = payload.ok;
    entry.reportState = payload.report?.state;
    entry.rows = payload.report?.rows?.length;
    entry.jobs = payload.jobs?.length;
    entry.target = payload.report?.rows?.filter(row => row.barcode === 'BAB3-1').map(row => ({ barcode: row.barcode, salesCoverageReady: row.salesCoverageReady, syncNeeded: row.syncNeeded, syncBlocked: row.syncBlocked }));
  } catch { entry.notJson = true; }
  network.push(entry);
  console.log('INVENTORY_BROWSER_RESPONSE', JSON.stringify(entry));
});
page.on('requestfailed', request => {
  if (starts.has(request)) network.push({ path: new URL(request.url()).pathname, failure: safe(request.failure()?.errorText) });
});
async function inspect() {
  return page.evaluate(() => {
    const heading = [...document.querySelectorAll('h2')].find(node => node.textContent?.includes('실제 운영 재고상태 자동 큐'));
    const queue = heading?.closest('section');
    return {
      title: document.title,
      visibility: document.visibilityState,
      online: navigator.onLine,
      details: [...document.querySelectorAll('details')].map(node => ({ open: node.open, summary: node.querySelector('summary')?.textContent?.trim(), containsQueue: Boolean(queue && node.contains(queue)) })),
      queueText: queue?.innerText || null,
      queueConnected: queue?.isConnected ?? false,
      queueClosestDetailsOpen: queue?.closest('details')?.open ?? null,
      status: [...document.querySelectorAll('[role=status],[role=alert]')].map(node => node.textContent?.trim()).filter(Boolean),
    };
  });
}
try {
  await page.goto(`${origin}/china-order-manager/stock-control`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const summary = page.locator('summary').filter({ hasText: '자동 처리 실행 · 현재는 승인 1회 필요' });
  await summary.waitFor({ state: 'visible', timeout: 30000 });
  await summary.click();
  const start = Date.now();
  while (Date.now() - start < 125000) {
    await page.waitForTimeout(5000);
    const state = await inspect();
    observed.push({ elapsedMs: Date.now() - start, ...state });
    if (state.queueText?.includes('원장 READY')) {
      passed = true;
      // Do not stop at a fleeting paint: wait past a normal polling interval.
      await page.waitForTimeout(35000);
      const after = await inspect();
      observed.push({ elapsedMs: Date.now() - start, ...after });
      passed = after.queueText?.includes('원장 READY') === true;
      break;
    }
  }
  await page.screenshot({ path: `${output}/screen.png`, fullPage: true });
} catch (error) {
  errors.push(safe(error.message));
  await page.screenshot({ path: `${output}/screen.png`, fullPage: true }).catch(() => {});
} finally {
  await writeFile(`${output}/result.json`, JSON.stringify({ passed, origin, observed, network, errors }, null, 2));
  console.log('INVENTORY_BROWSER_RESULT', JSON.stringify({ passed, lastState: observed.at(-1), network, errors }));
  await browser.close();
}
if (!passed) process.exitCode = 1;
