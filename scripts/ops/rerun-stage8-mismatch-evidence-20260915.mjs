import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const ORIGIN = 'https://commerce-os-ops-center.vercel.app';
const PAGE = '/stage8-sales-events';
const SALES = '/api/product-master/shopling-sales-events';
const PARITY = '/api/stage8/candidate-demand-parity';
const EVIDENCE = '/api/stage8/candidate-mismatch-evidence';
const EXPECTED_SOURCE_REQUEST = '83a71972-4d53-4b4a-b599-7a6f76667e09';
const EXPECTED_PARITY_REQUEST = '80227668-508b-4fa9-8f1d-d1c8025eaf61';
const EXPECTED_ASOF = '2026-09-15T01:09:10.473Z';
const EXPECTED_PLAN = 'sha256:6918e783e02feb644d188843c83b3130116b906738e5c4f5a58cdb99bfd2f390';
const EXPECTED_PARITY = 'sha256:4fe61e7d1ae1be54ca46847cac590ed67d21d078f70665f365cfc6d1fb687157';
const GET_APIS = new Set([SALES, PARITY, EVIDENCE]);

function allow(url, method, topFrame, body, armed) {
  const u = new URL(url);
  if (u.origin !== ORIGIN || !topFrame) return false;
  if (method === 'GET') {
    return u.pathname === PAGE || u.pathname.startsWith('/_next/static/') || (GET_APIS.has(u.pathname) && !u.search);
  }
  return method === 'POST' && !u.search && u.pathname === EVIDENCE && armed?.path === EVIDENCE &&
    ['start', 'run-next'].includes(armed?.action) && body && Object.keys(body).length === 1 && body.action === armed.action;
}

for (const path of [SALES, PARITY, '/api/china-order-manager', '/api/inventory-stock-control']) {
  assert.equal(allow(ORIGIN + path, 'POST', true, { action: 'start' }, { path, action: 'start' }), false);
}
for (const action of ['canary', 'full', 'approve', 'refresh', 'publish']) {
  assert.equal(allow(ORIGIN + EVIDENCE, 'POST', true, { action }, { path: EVIDENCE, action }), false);
}
assert.ok(allow(ORIGIN + EVIDENCE, 'POST', true, { action: 'start' }, { path: EVIDENCE, action: 'start' }));
assert.ok(allow(ORIGIN + EVIDENCE, 'POST', true, { action: 'run-next' }, { path: EVIDENCE, action: 'run-next' }));
assert.equal(allow(ORIGIN + EVIDENCE, 'POST', false, { action: 'start' }, { path: EVIDENCE, action: 'start' }), false);
console.log('STAGE8_EVIDENCE_RERUN_READ_ONLY_BOUNDARY_PASS');
if (process.argv.includes('--self-test')) process.exit(0);

assert.equal(process.env.GITHUB_REF_NAME, 'ops/rerun-stage8-evidence-20260915');
assert.equal(process.env.EVIDENCE_RERUN_AUTHORIZATION, 'OWNER_AUTHORIZED_READ_ONLY_EVIDENCE_RERUN');

const tools = createRequire(`${process.env.SALES_BROWSER_TOOLS}/package.json`);
const { chromium } = tools('playwright');
const dir = 'artifacts/stage8-evidence-rerun-20260915';
await mkdir(dir, { recursive: true });
const log = {
  mode: 'REAL_PRODUCTION_READ_ONLY_MISMATCH_EVIDENCE_RERUN',
  startedAt: new Date().toISOString(),
  expectedSourceRequestId: EXPECTED_SOURCE_REQUEST,
  expectedParityRequestId: EXPECTED_PARITY_REQUEST,
  analysisAsOf: EXPECTED_ASOF,
  productMasterWrites: 0,
  inventoryWrites: 0,
  purchaseWrites: 0,
  paymentWrites: 0,
  blockedRequests: 0,
  steps: [],
  outcome: 'STARTING',
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: 'block' });
const page = await context.newPage();
let armed = null;
await context.routeWebSocket('**/*', socket => socket.close());
await context.route('**/*', async route => {
  const req = route.request();
  let top = false;
  let body = null;
  try { top = req.frame() === page.mainFrame(); } catch {}
  if (req.method() === 'POST') {
    try { body = req.postDataJSON(); } catch {}
  }
  if (!allow(req.url(), req.method(), top, body, armed)) {
    log.blockedRequests += 1;
    return route.abort('blockedbyclient');
  }
  if (req.method() === 'POST') armed = null;
  return route.continue();
});
page.on('dialog', dialog => dialog.dismiss());

async function request(path, action = null) {
  assert.equal(armed, null);
  if (action) armed = { path, action };
  return page.evaluate(async ({ path, action }) => {
    const response = await fetch(path, {
      method: action ? 'POST' : 'GET',
      ...(action ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) } : {}),
      cache: 'no-store',
      signal: AbortSignal.timeout(290000),
    });
    let data = null;
    try { data = await response.json(); } catch { data = {}; }
    return { http: response.status, data };
  }, { path, action });
}

async function status(path) {
  const response = await request(path);
  assert.equal(response.http, 200, `${path}: status HTTP ${response.http}`);
  assert.equal(response.data.ok, true, `${path}: status not ok`);
  assert.equal(response.data.status?.configured, true, `${path}: not configured`);
  return response.data.status;
}

function summarizeEvidence(statusValue) {
  const report = statusValue?.report ?? null;
  if (!report) return null;
  return {
    requestId: statusValue.requestId,
    state: statusValue.state,
    candidateSalesRequestId: report.candidateSalesRequestId,
    candidateParityRequestId: report.candidateParityRequestId,
    analysisAsOf: report.analysisAsOf,
    evidenceRows: report.evidenceRows,
    candidateRows: report.candidateRows,
    truncatedEvidenceRows: report.truncatedEvidenceRows,
    affectedBarcodes: report.affectedBarcodes,
    categoryCounts: report.categoryCounts,
    categoryUnitDelta: report.categoryUnitDelta,
    categoryRevenueDelta: report.categoryRevenueDelta,
    reasonCounts: report.reasonCounts,
    reasonUnitDelta: report.reasonUnitDelta,
    reasonRevenueDelta: report.reasonRevenueDelta,
    evidenceFingerprint: report.evidenceFingerprint,
    topEvidence: report.topEvidence,
  };
}

try {
  const nav = await page.goto(ORIGIN + PAGE, { waitUntil: 'domcontentloaded', timeout: 120000 });
  assert.equal(nav?.status(), 200, 'PRODUCTION_PAGE_HTTP_FAILED');
  assert.equal(new URL(page.url()).pathname, PAGE, 'LOGIN_REQUIRED');

  const source = await status(SALES);
  assert.equal(source.requestId, EXPECTED_SOURCE_REQUEST, 'SALES_SOURCE_CHANGED');
  assert.equal(source.analysisAsOf, EXPECTED_ASOF, 'SALES_SOURCE_TIME_CHANGED');
  assert.equal(source.report?.planFingerprint, EXPECTED_PLAN, 'SALES_PLAN_CHANGED');
  assert.equal(source.report?.unmappedRows, 0, 'SALES_UNMAPPED_ROWS_PRESENT');
  assert.equal(source.report?.identityConflictCount, 0, 'SALES_IDENTITY_CONFLICT_PRESENT');

  const parity = await status(PARITY);
  assert.equal(parity.requestId, EXPECTED_PARITY_REQUEST, 'PARITY_REQUEST_CHANGED');
  assert.equal(parity.state, 'MISMATCH', 'PARITY_NO_LONGER_MISMATCH');
  assert.equal(parity.report?.candidateSalesRequestId, EXPECTED_SOURCE_REQUEST, 'PARITY_SOURCE_CHANGED');
  assert.equal(parity.report?.analysisAsOf, EXPECTED_ASOF, 'PARITY_TIME_CHANGED');
  assert.equal(parity.report?.candidatePlanFingerprint, EXPECTED_PLAN, 'PARITY_PLAN_CHANGED');
  assert.equal(parity.report?.parityFingerprint, EXPECTED_PARITY, 'PARITY_FINGERPRINT_CHANGED');

  const before = await status(EVIDENCE);
  assert.ok(!['QUEUED', 'RUNNING'].includes(before.state), 'OTHER_EVIDENCE_RUN_ACTIVE');
  log.before = summarizeEvidence(before);

  const created = await request(EVIDENCE, 'start');
  assert.equal(created.http, 202, 'EVIDENCE_START_NOT_ACCEPTED');
  assert.equal(created.data.ok, true, 'EVIDENCE_START_NOT_OK');
  assert.equal(created.data.accepted, true, 'EVIDENCE_START_REJECTED');
  assert.notEqual(created.data.requestId, before.requestId, 'EVIDENCE_REQUEST_NOT_RECREATED');
  assert.equal(created.data.candidateSalesRequestId, EXPECTED_SOURCE_REQUEST, 'EVIDENCE_SOURCE_CHANGED');
  assert.equal(created.data.candidateParityRequestId, EXPECTED_PARITY_REQUEST, 'EVIDENCE_PARITY_REQUEST_CHANGED');
  assert.equal(created.data.analysisAsOf, EXPECTED_ASOF, 'EVIDENCE_TIME_CHANGED');
  assert.equal(created.data.candidateParityFingerprint, EXPECTED_PARITY, 'EVIDENCE_PARITY_FINGERPRINT_CHANGED');
  log.requestId = created.data.requestId;
  log.targetBarcodes = created.data.targetBarcodes;
  log.totalRanges = created.data.totalRanges;

  const deadline = Date.now() + 12 * 60_000;
  let current = await status(EVIDENCE);
  for (let i = 0; i < 80 && Date.now() < deadline && ['QUEUED', 'RUNNING'].includes(current.state); i += 1) {
    assert.equal(current.requestId, log.requestId, 'EVIDENCE_REQUEST_CHANGED_DURING_RUN');
    const step = await request(EVIDENCE, 'run-next');
    assert.equal(step.http, 200, 'EVIDENCE_STEP_HTTP_FAILED');
    assert.equal(step.data.ok, true, 'EVIDENCE_STEP_NOT_OK');
    if (step.data.result?.requestId) assert.equal(step.data.result.requestId, log.requestId, 'EVIDENCE_STEP_REQUEST_CHANGED');
    log.steps.push({
      index: i + 1,
      state: step.data.result?.state ?? null,
      processed: step.data.result?.processed ?? null,
      completedRanges: step.data.result?.completedRanges ?? null,
    });
    current = await status(EVIDENCE);
    if ((i + 1) % 10 === 0) console.log(JSON.stringify({ step: i + 1, state: current.state, completedRanges: current.completedRanges, totalRanges: current.totalRanges }));
  }

  current = await status(EVIDENCE);
  assert.equal(current.requestId, log.requestId, 'FINAL_EVIDENCE_REQUEST_CHANGED');
  assert.equal(current.state, 'COMPLETE', `EVIDENCE_NOT_COMPLETE:${current.state}`);
  assert.equal(current.report?.candidateSalesRequestId, EXPECTED_SOURCE_REQUEST, 'FINAL_EVIDENCE_SOURCE_CHANGED');
  assert.equal(current.report?.candidateParityRequestId, EXPECTED_PARITY_REQUEST, 'FINAL_EVIDENCE_PARITY_CHANGED');
  assert.equal(current.report?.analysisAsOf, EXPECTED_ASOF, 'FINAL_EVIDENCE_TIME_CHANGED');
  assert.equal(current.report?.candidateParityFingerprint, EXPECTED_PARITY, 'FINAL_EVIDENCE_FINGERPRINT_CHANGED');
  log.after = summarizeEvidence(current);
  log.outcome = 'COMPLETE_READ_ONLY_EVIDENCE_RERUN';
  console.log('STAGE8_EVIDENCE_RERUN_COMPLETE');
  console.log(JSON.stringify(log.after));
} catch (error) {
  log.outcome = 'STOPPED_FOR_INSPECTION';
  log.failure = String(error?.message ?? error).split('\n')[0].slice(0, 300);
  console.error('STAGE8_EVIDENCE_RERUN_STOPPED', log.failure);
  process.exitCode = 1;
} finally {
  log.finishedAt = new Date().toISOString();
  await writeFile(`${dir}/result.json`, JSON.stringify(log, null, 2));
  await browser.close();
}
