import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.INVENTORY_UI_BASE_URL || 'https://commerce-os-ops-center.vercel.app';
const origin = new URL(base).origin;
const output = 'artifacts/inventory-ui-hidden';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, locale: 'ko-KR' });
const page = await context.newPage();
const requests = [];
const errors = [];
const row = { barcode: 'BAB3-1', productName: '브라우저 검증용 상품 (모의 데이터)', productKind: 'SINGLE', modelNo: 'AAA231', goodsKeys: [], exactInventoryQuantity: 0, desiredStatus: 'SOLD_OUT', desiredSince: '2026-09-10T00:34:21.643Z', resetAt: '2026-09-10T00:34:21.643Z', latestSyncOutcome: null, latestSyncAt: null, salesCoverageReady: true, syncNeeded: true, syncBlocked: false, syncBlockReason: null };
const report = { state: 'READY', pendingSyncCount: 1, uncertainSyncCount: 0, soldOutCount: 1, onSaleCount: 0, rows: [row] };
const queuePayload = { ok: true, report, jobs: [{ ...row, jobId: 'fixture-stock-job', route: [] }] };
await context.addInitScript(() => {
  // Deliberately exercise the application's hidden-tab scheduling guard while
  // allowing the explicit user-triggered R/Q promise to complete normally.
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  window.addEventListener('message', event => {
    if (event.source === window && event.origin === location.origin && event.data?.type === 'COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_PING_HF27') {
      window.postMessage({ type: 'COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_READY_HF27' }, location.origin);
    }
  });
});
await context.route('**/*', async route => {
  const request = route.request();
  const url = new URL(request.url());
  if (url.origin !== origin) return route.abort();
  if (!['GET', 'HEAD'].includes(request.method())) return route.fulfill({ status: 403, json: { ok: false, code: 'TEST_WRITES_BLOCKED' } });
  if (url.pathname === '/api/inventory-stock-control' || url.pathname === '/api/inventory-stock-control/sync') {
    requests.push(url.pathname);
    return route.fulfill({ json: url.pathname.endsWith('/sync') ? queuePayload : { ok: true, report } });
  }
  if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { ok: true, jobs: [], tasks: [], items: [] } });
  return route.continue();
});
page.on('pageerror', error => errors.push(error.message.slice(0, 300)));
let evidence;
try {
  await page.goto(`${origin}/china-order-manager/stock-control`, { waitUntil: 'domcontentloaded' });
  const summary = page.locator('summary').filter({ hasText: '자동 처리 실행 · 현재는 승인 1회 필요' });
  await summary.click();
  await page.waitForFunction(() => [...document.querySelectorAll('[role=status]')].some(node => node.textContent?.includes('확인 완료')), { timeout: 20000 });
  await page.waitForTimeout(1000);
  evidence = await page.evaluate(() => {
    const queue = [...document.querySelectorAll('h2')].find(node => node.textContent?.includes('실제 운영 재고상태 자동 큐'))?.closest('section');
    return { visibility: document.visibilityState, queueText: queue?.innerText, status: [...document.querySelectorAll('[role=status]')].map(node => node.textContent), detailsOpen: queue?.closest('details')?.open };
  });
  await page.screenshot({ path: `${output}/screen.png`, fullPage: true });
  assert.match(evidence.queueText || '', /원장 READY/, 'An accepted explicit response must render even when passive polling is gated');
  assert.match(evidence.queueText || '', /BAB3-1/, 'The exact response row must reach the rendered queue');
  assert.equal(errors.length, 0);
  console.log('HIDDEN_TAB_RENDER_PASSED', JSON.stringify({ evidence, requests }));
} catch (error) {
  console.log('HIDDEN_TAB_RENDER_FAILED', JSON.stringify({ message: error.message, evidence, requests, errors }));
  process.exitCode = 1;
} finally {
  await writeFile(`${output}/result.json`, JSON.stringify({ evidence, requests, errors }, null, 2));
  await browser.close();
}
