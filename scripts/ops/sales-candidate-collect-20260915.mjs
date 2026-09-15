import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

// One-shot operational continuation after PR #1201. No secrets and no manual
// Origin/Referer/cookies: navigate the real owner-authorized UI normally. If it
// requires a login, stop. All unrelated workers, APIs and sockets are blocked.
const ORIGIN = 'https://commerce-os-ops-center.vercel.app';
const PAGE = '/stage8-sales-events';
const API = '/api/product-master/shopling-sales-events';
const OLD_ID = '95c910a4-88ff-4c05-b181-9d57ab497bc0';
const OLD_PLAN = 'sha256:f44a8d962681b76be78f4033f420bbb82884d92537c9e18fce1cdf6b3548aa14';
const OLD_ASOF = '2026-09-07T14:32:29.432Z';
const MAX_STEPS = 24;
const BUDGET_MS = 10 * 60_000;
const REFRESH = { action: 'refresh', expectedRequestId: OLD_ID, expectedPlanFingerprint: OLD_PLAN, confirmation: 'REFRESH_CANDIDATE' };
const fingerprint = (value) => /^sha256:[a-f0-9]{64}$/.test(value ?? '');
function samePayload(actual, expected) {
  return !!actual && !!expected && typeof actual === 'object' && !Array.isArray(actual)
    && Object.keys(actual).length === Object.keys(expected).length
    && Object.keys(expected).every(key => actual[key] === expected[key]);
}
function allow(url, method, topFrame, body, armed) {
  const u = new URL(url);
  if (u.origin !== ORIGIN || !topFrame) return false;
  if (method === 'GET') return u.pathname === PAGE || u.pathname.startsWith('/_next/static/') || (u.pathname === API && !u.search);
  return method === 'POST' && u.pathname === API && !u.search && !!armed
    && ['refresh', 'run-next'].includes(armed.action) && samePayload(body, armed);
}
function verifyPolicy() {
  assert.ok(allow(ORIGIN + PAGE, 'GET', true, null, null));
  assert.ok(allow(ORIGIN + API, 'GET', true, null, null));
  assert.ok(allow(ORIGIN + API, 'POST', true, REFRESH, REFRESH));
  assert.ok(allow(ORIGIN + API, 'POST', true, { action: 'run-next' }, { action: 'run-next' }));
  for (const action of ['canary', 'full', 'start', 'reset', 'approve']) {
    assert.equal(allow(ORIGIN + API, 'POST', true, { action }, { action }), false);
  }
  for (const url of [ORIGIN + '/api/china-order-manager', ORIGIN + '/api/inventory-stock-control', ORIGIN + '/product-launch-tracker-app/index.html', 'http://127.0.0.1:8765', 'https://example.com' + API]) {
    assert.equal(allow(url, 'GET', true, null, null), false);
    assert.equal(allow(url, 'POST', true, REFRESH, REFRESH), false);
  }
  assert.equal(allow(ORIGIN + API, 'POST', false, REFRESH, REFRESH), false);
  assert.equal(allow(ORIGIN + API, 'POST', true, REFRESH, null), false);
  assert.equal(allow(ORIGIN + API, 'POST', true, { ...REFRESH, expectedRequestId: 'changed' }, REFRESH), false);
  assert.equal(allow(ORIGIN + API, 'POST', true, { ...REFRESH, force: true }, REFRESH), false);
  console.log('COLLECTION_BOUNDARY_SELF_TEST_PASS');
}
verifyPolicy();
if (process.argv.includes('--self-test')) process.exit(0);
assert.equal(process.env.SALES_COLLECTION_AUTHORIZATION, 'OWNER_AUTHORIZED_CURRENT_SALES_COLLECTION');
assert.equal(process.env.GITHUB_REF_NAME, 'ops/sales-candidate-collect-20260915');
const tools = createRequire(`${process.env.SALES_BROWSER_TOOLS}/package.json`);
const { chromium } = tools('playwright');
const dir = 'artifacts/sales-candidate-collect-20260915';
await mkdir(dir, { recursive: true });
const evidence = { mode: 'REAL_PRODUCTION_UI_COLLECTION_ONLY', startedAt: new Date().toISOString(), refreshRequests: 0, collectSteps: 0, purchaseWrites: 0, canonicalWrites: 0, snapshots: [], blockedRequestCount: 0, outcome: 'NOT_STARTED' };
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
let armed = null;
await context.routeWebSocket('**/*', socket => socket.close());
await context.route('**/*', async route => {
  const request = route.request();
  let top = false, body = null;
  try { top = request.frame() === page.mainFrame(); } catch {}
  if (request.method() === 'POST') { try { body = request.postDataJSON(); } catch {} }
  if (!allow(request.url(), request.method(), top, body, armed)) {
    evidence.blockedRequestCount++;
    await route.abort('blockedbyclient'); return;
  }
  if (request.method() === 'POST') {
    const action = armed.action; armed = null;
    if (action === 'refresh') evidence.refreshRequests++;
    if (action === 'run-next') evidence.collectSteps++;
  }
  // Never override auth headers, request URLs, payloads, or responses.
  await route.continue();
});
let refreshConfirmationArmed = false;
page.on('dialog', async dialog => {
  if (refreshConfirmationArmed && dialog.type() === 'confirm' && dialog.message() === '기존 후보와 검증 기록은 보존하고 현재 시점으로 새 후보를 수집합니다. 원장 반영·발주·결제는 실행하지 않습니다. 계속할까요?') {
    refreshConfirmationArmed = false; await dialog.accept();
  } else await dialog.dismiss();
});
function summary(status) {
  return { at: new Date().toISOString(), requestId: status.requestId, analysisAsOf: status.analysisAsOf,
    state: status.state, configured: status.configured, completedRanges: status.completedRanges,
    totalRanges: status.totalRanges, blockerCount: status.blockerCount,
    sourceEventCount: status.report?.sourceEventCount ?? null, unmappedRows: status.report?.unmappedRows ?? null,
    identityConflictCount: status.report?.identityConflictCount ?? null, planFingerprint: status.report?.planFingerprint ?? null };
}
async function readStatus() {
  const result = await page.evaluate(async api => {
    const response = await fetch(api, { cache: 'no-store', signal: AbortSignal.timeout(120000) });
    return { status: response.status, payload: await response.json() };
  }, API);
  assert.equal(result.status, 200, 'STATUS_HTTP_NOT_OK');
  assert.equal(result.payload.ok, true, 'STATUS_NOT_OK');
  const status = result.payload.status;
  assert.equal(status.configured, true, 'SOURCE_NOT_CONFIGURED');
  assert.ok(typeof status.requestId === 'string' && Number.isFinite(Date.parse(status.analysisAsOf)), 'INVALID_SOURCE_STATUS');
  const item = summary(status); evidence.snapshots.push(item); console.log(JSON.stringify(item));
  return status;
}
async function click(action, label) {
  assert.equal(armed, null); armed = action === 'refresh' ? REFRESH : { action };
  refreshConfirmationArmed = action === 'refresh';
  const responsePromise = page.waitForResponse(r => r.url() === ORIGIN + API && r.request().method() === 'POST', { timeout: 290000 });
  await page.getByRole('button', { name: label, exact: true }).click({ timeout: 30000 });
  const response = await responsePromise;
  const payload = await response.json();
  assert.ok(response.ok() && payload.ok === true, `ACTION_REJECTED_${response.status()}_${String(payload.code ?? '').replace(/[^A-Z0-9_]/g, '')}`);
  await page.waitForTimeout(2000);
  await page.waitForLoadState('domcontentloaded');
  return payload;
}
try {
  const nav = await page.goto(ORIGIN + PAGE, { waitUntil: 'domcontentloaded', timeout: 120000 });
  assert.equal(nav.status(), 200, 'PAGE_NOT_OK');
  assert.equal(new URL(page.url()).pathname, PAGE, 'LOGIN_OR_REDIRECT_REQUIRED');
  await page.getByRole('heading', { name: '정확한 30일 구간 판매 이벤트', exact: true }).waitFor();
  let status = await readStatus();
  assert.equal(status.requestId, OLD_ID, 'SOURCE_ALREADY_CHANGED_STOP_NO_REFRESH');
  assert.equal(status.analysisAsOf, OLD_ASOF, 'SOURCE_TIME_CHANGED');
  assert.equal(status.report?.planFingerprint, OLD_PLAN, 'SOURCE_PLAN_CHANGED');
  assert.equal(status.state, 'READY_CANARY', 'SOURCE_PHASE_CHANGED');
  const accepted = await click('refresh', '최신 판매 후보 다시 수집');
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.previousRequestId, OLD_ID);
  assert.equal(accepted.canonicalWritesEnabled, false); assert.equal(accepted.sourceWritesEnabled, false); assert.equal(accepted.approvalGranted, false);
  const newId = accepted.requestId, asof = accepted.analysisAsOf;
  assert.ok(newId && newId !== OLD_ID && Date.parse(asof) > Date.parse(OLD_ASOF));
  evidence.accepted = { requestId: newId, analysisAsOf: asof, totalRanges: accepted.totalRanges, wakeRequested: accepted.wakeRequested };
  evidence.outcome = 'DURABLY_ACCEPTED';
  await writeFile(`${dir}/result.json`, JSON.stringify(evidence, null, 2));
  const deadline = Date.now() + BUDGET_MS;
  while (evidence.collectSteps < MAX_STEPS && Date.now() < deadline) {
    status = await readStatus();
    if (status.requestId !== newId || status.analysisAsOf !== asof) { evidence.outcome = 'SOURCE_CHANGED_STOPPED'; break; }
    if (!['QUEUED', 'RUNNING'].includes(status.state)) { evidence.outcome = status.state; break; }
    const result = await click('run-next', '다음 구간 1회 처리');
    if (result.result?.requestId && result.result.requestId !== newId) { evidence.outcome = 'SOURCE_CHANGED_STOPPED'; break; }
  }
  status = await readStatus(); evidence.final = summary(status);
  if (['QUEUED', 'RUNNING'].includes(status.state)) evidence.outcome = 'BOUNDED_COLLECTION_PENDING';
  else if (status.requestId === newId && status.analysisAsOf === asof) evidence.outcome = status.state;
  assert.equal(evidence.refreshRequests, 1);
  console.log(`REAL_COLLECTION_OUTCOME=${evidence.outcome}`);
} catch (error) {
  evidence.failure = String(error.message).split('\n')[0].slice(0, 180);
  evidence.outcome = 'STOPPED_FOR_INSPECTION';
  console.error('COLLECTION_STOPPED_FOR_INSPECTION'); process.exitCode = 1;
} finally {
  evidence.finishedAt = new Date().toISOString();
  await writeFile(`${dir}/result.json`, JSON.stringify(evidence, null, 2));
  await browser.close();
}
