import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const ORIGIN = 'https://commerce-os-ops-center.vercel.app';
const PAGE = '/stage8-sales-events';
const SALES = '/api/product-master/shopling-sales-events';
const PARITY = '/api/stage8/candidate-demand-parity';
const EVIDENCE = '/api/stage8/candidate-mismatch-evidence';
const GET_APIS = new Set([SALES, PARITY, EVIDENCE]);
const POST_ACTIONS = new Map([
  [SALES, new Set(['start', 'run-next'])],
  [PARITY, new Set(['start', 'run-next'])],
  [EVIDENCE, new Set(['start', 'run-next'])],
]);

function exactAction(body) {
  return body && typeof body === 'object' && !Array.isArray(body) &&
    Object.keys(body).length === 1 && typeof body.action === 'string';
}

function allowed(url, method, topFrame, body, armed) {
  const u = new URL(url);
  if (u.origin !== ORIGIN || !topFrame) return false;
  if (method === 'GET') {
    return u.pathname === PAGE || u.pathname.startsWith('/_next/static/') || (GET_APIS.has(u.pathname) && !u.search);
  }
  if (method !== 'POST' || u.search || !armed || armed.path !== u.pathname || body?.action !== armed.action) return false;
  return exactAction(body) && POST_ACTIONS.get(u.pathname)?.has(body.action) === true;
}

for (const path of [SALES, PARITY, EVIDENCE]) {
  for (const action of ['canary', 'full', 'refresh', 'approve', 'publish', 'execute', 'order', 'pay']) {
    assert.equal(allowed(ORIGIN + path, 'POST', true, { action }, { path, action }), false);
  }
  for (const action of ['start', 'run-next']) {
    assert.ok(allowed(ORIGIN + path, 'POST', true, { action }, { path, action }));
  }
}
console.log('STAGE8_RESUME_READ_ONLY_BOUNDARY_PASS');
if (process.argv.includes('--self-test')) process.exit(0);

assert.equal(process.env.GITHUB_REF_NAME, 'ops/rerun-stage8-evidence-20260915');
assert.equal(process.env.EVIDENCE_RERUN_AUTHORIZATION, 'OWNER_AUTHORIZED_READ_ONLY_EVIDENCE_RERUN');

const tools = createRequire(`${process.env.SALES_BROWSER_TOOLS}/package.json`);
const { chromium } = tools('playwright');
const dir = 'artifacts/stage8-evidence-resume-20260915';
await mkdir(dir, { recursive: true });
const log = {
  mode: 'REAL_PRODUCTION_RESUME_SOURCE_PARITY_EVIDENCE_READ_ONLY',
  startedAt: new Date().toISOString(),
  productMasterWrites: 0,
  inventoryWrites: 0,
  purchaseWrites: 0,
  paymentWrites: 0,
  blockedRequests: 0,
  sourceSteps: [],
  sourceRecoveries: [],
  paritySteps: [],
  evidenceSteps: [],
  outcome: 'STARTING',
};
const save = () => writeFile(`${dir}/result.json`, JSON.stringify(log, null, 2));

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
  if (req.method() === 'POST') { try { body = req.postDataJSON(); } catch {} }
  if (!allowed(req.url(), req.method(), top, body, armed)) {
    log.blockedRequests += 1;
    return route.abort('blockedbyclient');
  }
  if (req.method() === 'POST') armed = null;
  return route.continue();
});
page.on('dialog', dialog => dialog.dismiss());

async function request(path, body = null) {
  assert.equal(armed, null);
  if (body) armed = { path, action: body.action };
  return page.evaluate(async ({ path, body }) => {
    const response = await fetch(path, {
      method: body ? 'POST' : 'GET',
      ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
      cache: 'no-store',
      signal: AbortSignal.timeout(290000),
    });
    let data = {};
    try { data = await response.json(); } catch {}
    return { http: response.status, data };
  }, { path, body });
}

async function status(path) {
  const r = await request(path);
  assert.equal(r.http, 200, `${path}:STATUS_HTTP_${r.http}`);
  assert.equal(r.data.ok, true, `${path}:STATUS_NOT_OK`);
  assert.equal(r.data.status?.configured, true, `${path}:NOT_CONFIGURED`);
  return r.data.status;
}

function sourcePin(s) {
  return {
    requestId: s.requestId,
    analysisAsOf: s.analysisAsOf,
    planFingerprint: s.report?.planFingerprint,
    eventFingerprint: s.report?.eventFingerprint,
  };
}

async function verifySource(pin) {
  const s = await status(SALES);
  assert.equal(s.requestId, pin.requestId, 'PINNED_SOURCE_REQUEST_CHANGED');
  assert.equal(s.analysisAsOf, pin.analysisAsOf, 'PINNED_SOURCE_TIME_CHANGED');
  assert.equal(s.report?.planFingerprint, pin.planFingerprint, 'PINNED_SOURCE_PLAN_CHANGED');
  assert.equal(s.report?.eventFingerprint, pin.eventFingerprint, 'PINNED_SOURCE_EVENT_CHANGED');
  assert.equal(s.report?.unmappedRows ?? -1, 0, 'PINNED_SOURCE_UNMAPPED');
  assert.equal(s.report?.identityConflictCount ?? -1, 0, 'PINNED_SOURCE_IDENTITY_CONFLICT');
}

async function finishSource() {
  let current = await status(SALES);
  const originalAnalysisAsOf = current.analysisAsOf;
  assert.ok(originalAnalysisAsOf && Date.parse(originalAnalysisAsOf) >= Date.parse('2026-09-15T09:38:00Z'), 'SOURCE_NOT_CURRENT_RERUN_CONTEXT');
  let requestId = current.requestId;
  const deadline = Date.now() + 32 * 60_000;
  for (let i = 0; i < 420 && Date.now() < deadline; i += 1) {
    current = await status(SALES);
    assert.equal(current.analysisAsOf, originalAnalysisAsOf, 'SOURCE_ANALYSIS_TIME_CHANGED');
    if (['READY_CANARY', 'READY_FULL'].includes(current.state)) {
      assert.equal(current.report?.unmappedRows ?? -1, 0, 'SOURCE_UNMAPPED_ROWS_PRESENT');
      assert.equal(current.report?.identityConflictCount ?? -1, 0, 'SOURCE_IDENTITY_CONFLICT_PRESENT');
      assert.ok(/^sha256:[a-f0-9]{64}$/.test(current.report?.planFingerprint ?? ''), 'SOURCE_PLAN_INVALID');
      assert.ok(/^sha256:[a-f0-9]{64}$/.test(current.report?.eventFingerprint ?? ''), 'SOURCE_EVENT_INVALID');
      return current;
    }
    if (current.state === 'FAILED') {
      const recovery = await request(SALES, { action: 'start' });
      log.sourceRecoveries.push({ fromRequestId: requestId, response: recovery });
      await save();
      assert.equal(recovery.http, 202, `SOURCE_RECOVERY_HTTP_${recovery.http}`);
      assert.equal(recovery.data?.ok, true, 'SOURCE_RECOVERY_NOT_OK');
      assert.equal(recovery.data?.accepted, true, 'SOURCE_RECOVERY_NOT_ACCEPTED');
      assert.equal(recovery.data?.analysisAsOf, originalAnalysisAsOf, 'SOURCE_RECOVERY_TIME_CHANGED');
      requestId = recovery.data.requestId;
      continue;
    }
    assert.ok(['QUEUED', 'RUNNING'].includes(current.state), `SOURCE_UNEXPECTED_STATE:${current.state}`);
    assert.equal(current.requestId, requestId, 'SOURCE_REQUEST_CHANGED_EXTERNALLY');
    const step = await request(SALES, { action: 'run-next' });
    assert.equal(step.http, 200, `SOURCE_STEP_HTTP_${step.http}`);
    assert.equal(step.data?.ok, true, 'SOURCE_STEP_NOT_OK');
    log.sourceSteps.push({ index: i + 1, requestId, state: step.data?.result?.state ?? null, range: step.data?.result?.range ?? null });
    if ((i + 1) % 20 === 0) console.log(JSON.stringify({ kind: 'source-resume', step: i + 1, requestId, state: step.data?.result?.state ?? null }));
    if ((i + 1) % 20 === 0) await save();
  }
  throw new Error('SOURCE_RESUME_TIMEOUT');
}

async function startAndRun(path, kind, terminalStates, pin, maxSteps = 120) {
  let before = await status(path);
  const start = await request(path, { action: 'start' });
  assert.equal(start.http, 202, `${kind.toUpperCase()}_START_HTTP_${start.http}`);
  assert.equal(start.data?.ok, true, `${kind.toUpperCase()}_START_NOT_OK`);
  assert.equal(start.data?.accepted, true, `${kind.toUpperCase()}_START_NOT_ACCEPTED`);
  const requestId = start.data.requestId;
  assert.ok(requestId, `${kind.toUpperCase()}_REQUEST_ID_MISSING`);
  let current = await status(path);
  assert.equal(current.requestId, requestId, `${kind.toUpperCase()}_REQUEST_CHANGED_AFTER_START`);
  for (let i = 0; i < maxSteps && ['QUEUED', 'RUNNING'].includes(current.state); i += 1) {
    if ((i + 1) % 8 === 1) await verifySource(pin);
    const step = await request(path, { action: 'run-next' });
    assert.equal(step.http, 200, `${kind.toUpperCase()}_STEP_HTTP_${step.http}`);
    assert.equal(step.data?.ok, true, `${kind.toUpperCase()}_STEP_NOT_OK`);
    log[`${kind}Steps`].push({ index: i + 1, state: step.data?.result?.state ?? null, processed: step.data?.result?.processed ?? null });
    current = await status(path);
    if ((i + 1) % 10 === 0) console.log(JSON.stringify({ kind, step: i + 1, state: current.state, completedRanges: current.completedRanges, totalRanges: current.totalRanges }));
  }
  assert.ok(terminalStates.includes(current.state), `${kind.toUpperCase()}_NOT_TERMINAL:${current.state}`);
  await verifySource(pin);
  return current;
}

try {
  const nav = await page.goto(ORIGIN + PAGE, { waitUntil: 'domcontentloaded', timeout: 120000 });
  assert.equal(nav?.status(), 200, 'PRODUCTION_PAGE_NOT_200');
  const source = await finishSource();
  log.source = {
    requestId: source.requestId,
    state: source.state,
    analysisAsOf: source.analysisAsOf,
    report: source.report,
  };
  const pin = sourcePin(source);
  await save();

  const parity = await startAndRun(PARITY, 'parity', ['MATCH', 'MISMATCH', 'FAILED'], pin, 120);
  log.parity = { requestId: parity.requestId, state: parity.state, report: parity.report };
  await save();
  assert.equal(parity.state, 'MISMATCH', `PARITY_EXPECTED_MISMATCH:${parity.state}`);

  const evidence = await startAndRun(EVIDENCE, 'evidence', ['COMPLETE', 'FAILED'], pin, 120);
  log.evidence = { requestId: evidence.requestId, state: evidence.state, report: evidence.report };
  assert.equal(evidence.state, 'COMPLETE', `EVIDENCE_NOT_COMPLETE:${evidence.state}`);
  assert.equal(evidence.report?.candidateSalesRequestId, source.requestId, 'EVIDENCE_SOURCE_NOT_PINNED');
  assert.equal(evidence.report?.candidateParityRequestId, parity.requestId, 'EVIDENCE_PARITY_NOT_PINNED');
  log.outcome = 'COMPLETE';
  log.completedAt = new Date().toISOString();
  await save();
  console.log(JSON.stringify({
    outcome: log.outcome,
    sourceRequestId: source.requestId,
    sourceAnalysisAsOf: source.analysisAsOf,
    parityRequestId: parity.requestId,
    parityState: parity.state,
    parityBlockers: parity.report?.blockerCount ?? null,
    evidenceRequestId: evidence.requestId,
    evidenceRows: evidence.report?.evidenceRows ?? null,
    affectedBarcodes: evidence.report?.affectedBarcodes ?? null,
  }));
} catch (error) {
  log.outcome = 'FAILED';
  log.error = error instanceof Error ? error.message : String(error);
  log.completedAt = new Date().toISOString();
  await save();
  console.error('STAGE8_RESUME_VERIFY_STOPPED', log.error);
  process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
}
