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
const writes = [];
const errors = [];
const checks = [];
let mode = 'READY';
const R = '/api/inventory-stock-control';
const Q = `${R}/sync`;
const row = { barcode: 'BAB3-1', productName: '브라우저 검증용 상품 (모의 데이터)', productKind: 'SINGLE', modelNo: 'AAA231', goodsKeys: [], exactInventoryQuantity: 0, desiredStatus: 'SOLD_OUT', desiredSince: '2026-09-10T00:34:21.643Z', resetAt: '2026-09-10T00:34:21.643Z', latestSyncOutcome: null, latestSyncAt: null, salesCoverageReady: true, syncNeeded: true, syncBlocked: false, syncBlockReason: null };
const report = { state: 'READY', pendingSyncCount: 1, uncertainSyncCount: 0, soldOutCount: 1, onSaleCount: 0, rows: [row] };
const queuePayload = { ok: true, report, jobs: [{ ...row, jobId: 'fixture-stock-job', route: [] }] };
await context.addInitScript(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  window.__inventoryTestStartMessages = [];
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const type = event.data?.type || '';
    if (type === 'COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_PING_HF27') {
      window.postMessage({ type: 'COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_READY_HF27' }, location.origin);
    }
    if (/STOCK_SYNC_(?:PARALLEL_)?START/.test(type)) window.__inventoryTestStartMessages.push(type);
  });
});
await context.route('**/*', async route => {
  const request = route.request();
  const url = new URL(request.url());
  if (url.origin !== origin) return route.abort();
  if (!['GET', 'HEAD'].includes(request.method())) {
    if (url.pathname.startsWith(R)) writes.push({ path: url.pathname, method: request.method() });
    return route.fulfill({ status: 403, json: { ok: false, code: 'TEST_WRITES_BLOCKED' } });
  }
  if (url.pathname === R || url.pathname === Q) {
    requests.push(url.pathname);
    if (mode === 'FAIL' && url.pathname === Q) return route.fulfill({ status: 503, json: { ok: false, code: 'TEST_READ_FAILURE', message: '모의 연결 실패' } });
    const payload = mode === 'EMPTY' ? { ok: true, report: { ...report, pendingSyncCount: 0, rows: [] }, jobs: [] } : queuePayload;
    return route.fulfill({ json: url.pathname === Q ? payload : { ok: true, report } });
  }
  if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { ok: true, jobs: [], tasks: [], items: [] } });
  return route.continue();
});
page.on('pageerror', error => errors.push(error.message.slice(0, 300)));
let evidence;
async function inspect() {
  return page.evaluate(() => {
    const queue = [...document.querySelectorAll('h2')].find(node => node.textContent?.includes('실제 운영 재고상태 자동 큐'))?.closest('section');
    return { visibility: document.visibilityState, queueText: queue?.innerText, status: [...document.querySelectorAll('[role=status]')].map(node => node.textContent), detailsOpen: queue?.closest('details')?.open };
  });
}
async function waitQueueText(text) {
  await page.waitForFunction(value => {
    const queue = [...document.querySelectorAll('h2')].find(node => node.textContent?.includes('실제 운영 재고상태 자동 큐'))?.closest('section');
    return queue?.innerText.includes(value);
  }, text, { timeout: 20000 });
}
try {
  await page.clock.install();
  await page.goto(`${origin}/china-order-manager/stock-control`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const summary = page.locator('summary').filter({ hasText: '자동 처리 실행 · 현재는 승인 1회 필요' });
  await summary.click();
  await page.waitForFunction(() => [...document.querySelectorAll('[role=status]')].some(node => node.textContent?.includes('확인 완료')), null, { timeout: 20000 });
  evidence = await inspect();
  await page.screenshot({ path: `${output}/screen.png`, fullPage: true });
  assert.match(evidence.queueText || '', /원장 READY/, 'An accepted explicit response must render even when passive polling is gated');
  assert.match(evidence.queueText || '', /BAB3-1/, 'The exact response row must reach the rendered queue');
  assert.deepEqual(requests, [R, Q], 'Hidden passive polling must not add an initial read');
  checks.push('hidden initial response paints immediately with R then Q only');

  await page.clock.fastForward(6000);
  assert.match((await inspect()).queueText || '', /BAB3-1/, 'Render must survive the old five-second handoff expiry');
  checks.push('accepted display survives the temporary handoff expiry');

  // Show why render state is NOT execution authority. The server removes the job
  // before a click. The click must re-read Q and must never POST or start HF28.
  mode = 'EMPTY';
  const queue = page.locator('section').filter({ has: page.getByRole('heading', { name: '실제 운영 재고상태 자동 큐', exact: true }) });
  await queue.getByRole('button', { name: '현재 대기건 2-Lane 자동처리', exact: true }).click();
  await waitQueueText('운영 재고상태 큐 처리 완료');
  assert.equal(requests.filter(path => path === Q).length, 2);
  assert.deepEqual(writes, []);
  assert.deepEqual(await page.evaluate(() => window.__inventoryTestStartMessages), []);
  checks.push('execution re-reads the server and cannot launch a removed display job');

  mode = 'FAIL';
  await queue.getByRole('button', { name: '큐 새로고침', exact: true }).click();
  await waitQueueText('TEST_READ_FAILURE');
  assert.equal(await queue.getByRole('button', { name: '현재 대기건 2-Lane 자동처리', exact: true }).isDisabled(), true);
  assert.doesNotMatch((await inspect()).queueText || '', /BAB3-1/);
  checks.push('read failure clears actionable rows and disables execution');

  mode = 'READY';
  await page.clock.fastForward(31000);
  await queue.getByRole('button', { name: '큐 새로고침', exact: true }).click();
  await waitQueueText('BAB3-1');
  assert.match((await inspect()).queueText || '', /원장 READY/);
  assert.deepEqual(writes, []);
  checks.push('manual read recovers after cooldown without any write');
  assert.equal(errors.length, 0);
  console.log('HIDDEN_TAB_RENDER_PASSED', JSON.stringify({ evidence, checks, requests, writes }));
} catch (error) {
  console.log('HIDDEN_TAB_RENDER_FAILED', JSON.stringify({ message: error.message, evidence, checks, requests, writes, errors }));
  process.exitCode = 1;
} finally {
  await writeFile(`${output}/result.json`, JSON.stringify({ evidence, checks, requests, writes, errors, passed: !process.exitCode }, null, 2));
  await browser.close();
}
