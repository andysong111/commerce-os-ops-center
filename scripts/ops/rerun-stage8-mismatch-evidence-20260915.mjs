import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const ORIGIN = 'https://commerce-os-ops-center.vercel.app';
const PAGE = '/stage8-sales-events';
const SALES = '/api/product-master/shopling-sales-events';
const PARITY = '/api/stage8/candidate-demand-parity';
const EVIDENCE = '/api/stage8/candidate-mismatch-evidence';
const EXPECTED_SOURCE_REQUEST = '83a71972-4d53-4b4a-b599-7a6f76667e09';
const EXPECTED_ASOF = '2026-09-15T01:09:10.473Z';
const EXPECTED_PLAN = 'sha256:6918e783e02feb644d188843c83b3130116b906738e5c4f5a58cdb99bfd2f390';
const GET_APIS = new Set([SALES, PARITY, EVIDENCE]);
const WRITE_APIS = new Set([PARITY, EVIDENCE]);

function allow(url, method, topFrame, body, armed) {
  const u = new URL(url);
  if (u.origin !== ORIGIN || !topFrame) return false;
  if (method === 'GET') {
    return u.pathname === PAGE || u.pathname.startsWith('/_next/static/') || (GET_APIS.has(u.pathname) && !u.search);
  }
  return method === 'POST' && !u.search && WRITE_APIS.has(u.pathname) && armed?.path === u.pathname &&
    ['start', 'run-next'].includes(armed?.action) && body && Object.keys(body).length === 1 && body.action === armed.action;
}

for (const path of [SALES, '/api/china-order-manager', '/api/inventory-stock-control']) {
  assert.equal(allow(ORIGIN + path, 'POST', true, { action: 'start' }, { path, action: 'start' }), false);
}
for (const path of [PARITY, EVIDENCE]) {
  for (const action of ['canary', 'full', 'approve', 'refresh', 'publish']) {
    assert.equal(allow(ORIGIN + path, 'POST', true, { action }, { path, action }), false);
  }
  assert.ok(allow(ORIGIN + path, 'POST', true, { action: 'start' }, { path, action: 'start' }));
  assert.ok(allow(ORIGIN + path, 'POST', true, { action: 'run-next' }, { path, action: 'run-next' }));
}
assert.equal(allow(ORIGIN + PARITY, 'POST', false, { action: 'start' }, { path: PARITY, action: 'start' }), false);
console.log('STAGE8_PARITY_EVIDENCE_READ_ONLY_BOUNDARY_PASS');
if (process.argv.includes('--self-test')) process.exit(0);

assert.equal(process.env.GITHUB_REF_NAME, 'ops/rerun-stage8-evidence-20260915');
assert.equal(process.env.EVIDENCE_RERUN_AUTHORIZATION, 'OWNER_AUTHORIZED_READ_ONLY_EVIDENCE_RERUN');

const tools = createRequire(`${process.env.SALES_BROWSER_TOOLS}/package.json`);
const { chromium } = tools('playwright');
const dir = 'artifacts/stage8-evidence-rerun-20260915';
await mkdir(dir, { recursive: true });
const log = {
  mode: 'REAL_PRODUCTION_READ_ONLY_CURRENT_CONTEXT_PARITY_EVIDENCE',
  startedAt: new Date().toISOString(),
  expectedSourceRequestId: EXPECTED_SOURCE_REQUEST,
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

async function save() {
  await writeFile(`${dir}/result.json`, JSON.stringify(log, null, 2));
}

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

async function verifySource() {
  const source = await status(SALES);
  assert.equal(source.requestId, EXPECTED_SOURCE_REQUEST, 'SALES_SOURCE_CHANGED');
  assert.equal(source.analysisAsOf, EXPECTED_ASOF, 'SALES_SOURCE_TIME_CHANGED');
  assert.equal(source.report?.planFingerprint, EXPECTED_PLAN, 'SALES_PLAN_CHANGED');
  assert.equal(source.report?.unmappedRows, 0, 'SALES_UNMAPPED_ROWS_PRESENT');
  assert.equal(source.report?.identityConflictCount, 0, 'SALES_IDENTITY_CONFLICT_PRESENT');
  return source;
}

function summarizeParity(statusValue) {
  const report = statusValue?.report ?? null;
  return {
    requestId: statusValue?.requestId ?? null,
    state: statusValue?.state ?? null,
    completedRanges: statusValue?.completedRanges ?? null,
    totalRanges: statusValue?.totalRanges ?? null,
    ...(report ? {
      candidateSalesRequestId: report.candidateSalesRequestId,
      analysisAsOf: report.analysisAsOf,
      planningContentFingerprint: report.planningContentFingerprint,
      candidatePlanFingerprint: report.candidatePlanFingerprint,
      parityFingerprint: report.parityFingerprint,
      candidateRowCount: report.candidateRowCount,
      exactRowCount: report.exactRowCount,
      unitMismatchCount: report.unitMismatchCount,
      revenueMismatchCount: report.revenueMismatchCount,
      missingDirectCount: report.missingDirectCount,
      directOnlyManagedCount: report.directOnlyManagedCount,
      blockerCount: report.blockerCount,
      candidateMinusDirectUnits: report.candidateMinusDirectUnits,
      candidateMinusDirectRevenue: report.candidateMinusDirectRevenue,
      mismatchSamples: report.mismatchSamples,
      missingDirectBarcodes: report.missingDirectBarcodes,
      directOnlyManagedBarcodes: report.directOnlyManagedBarcodes,
    } : {}),
  };
}

function summarizeEvidence(statusValue) {
  const report = statusValue?.report ?? null;
  return {
    requestId: statusValue?.requestId ?? null,
    state: statusValue?.state ?? null,
    completedRanges: statusValue?.completedRanges ?? null,
    totalRanges: statusValue?.totalRanges ?? null,
    ...(report ? {
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
    } : {}),
  };
}

async function runUntilTerminal(path, requestId, kind, terminalStates, maxSteps, maxMs) {
  const deadline = Date.now() + maxMs;
  let current = await status(path);
  for (let i = 0; i < maxSteps && Date.now() < deadline && ['QUEUED', 'RUNNING'].includes(current.state); i += 1) {
    assert.equal(current.requestId, requestId, `${kind.toUpperCase()}_REQUEST_CHANGED_DURING_RUN`);
    if ((i + 1) % 8 === 1) await verifySource();
    const step = await request(path, 'run-next');
    assert.equal(step.http, 200, `${kind.toUpperCase()}_STEP_HTTP_FAILED:${step.http}`);
    assert.equal(step.data.ok, true, `${kind.toUpperCase()}_STEP_NOT_OK`);
    if (step.data.result?.requestId) assert.equal(step.data.result.requestId, requestId, `${kind.toUpperCase()}_STEP_REQUEST_CHANGED`);
    log.steps.push({ kind, index: i + 1, state: step.data.result?.state ?? null, processed: step.data.result?.processed ?? null });
    current = await status(path);
    if ((i + 1) % 10 === 0) console.log(JSON.stringify({ kind, step: i + 1, state: current.state, completedRanges: current.completedRanges, totalRanges: current.totalRanges }));
  }
  current = await status(path);
  assert.equal(current.requestId, requestId, `${kind.toUpperCase()}_FINAL_REQUEST_CHANGED`);
  assert.ok(terminalStates.includes(current.state), `${kind.toUpperCase()}_NOT_TERMINAL:${current.state}`);
  await verifySource();
  return current;
}

function sumRecord(record) {
  return Object.values(record ?? {}).reduce((sum, value) => sum + (Number(value) || 0), 0);
}

try {
  const nav = await page.goto(ORIGIN + PAGE, { waitUntil: 'domcontentloaded', timeout: 120000 });
  assert.equal(nav?.status(), 200, 'PRODUCTION_PAGE_HTTP_FAILED');
  assert.equal(new URL(page.url()).pathname, PAGE, 'LOGIN_REQUIRED');

  const source = await verifySource();
  log.source = {
    requestId: source.requestId,
    analysisAsOf: source.analysisAsOf,
    planFingerprint: source.report?.planFingerprint,
    eventFingerprint: source.report?.eventFingerprint,
    sourceEventCount: source.report?.sourceEventCount,
  };

  const priorParity = await status(PARITY);
  assert.ok(!['QUEUED', 'RUNNING'].includes(priorParity.state), 'OTHER_PARITY_RUN_ACTIVE');
  log.beforeParity = summarizeParity(priorParity);

  const parityStart = await request(PARITY, 'start');
  log.parityStart = parityStart;
  await save();
  if (parityStart.http !== 202 || parityStart.data?.ok !== true || parityStart.data?.accepted !== true) {
    log.outcome = 'PARITY_START_BLOCKED';
    throw new Error(`PARITY_START_BLOCKED:${parityStart.http}:${parityStart.data?.code ?? ''}:${parityStart.data?.message ?? ''}`);
  }
  assert.equal(parityStart.data.candidateSalesRequestId, EXPECTED_SOURCE_REQUEST, 'NEW_PARITY_SOURCE_CHANGED');
  assert.equal(parityStart.data.analysisAsOf, EXPECTED_ASOF, 'NEW_PARITY_TIME_CHANGED');
  assert.equal(parityStart.data.candidatePlanFingerprint, EXPECTED_PLAN, 'NEW_PARITY_PLAN_CHANGED');
  const parityRequestId = parityStart.data.requestId;
  log.parityRequestId = parityRequestId;

  const parity = await runUntilTerminal(PARITY, parityRequestId, 'parity', ['MATCH', 'MISMATCH', 'FAILED'], 80, 10 * 60_000);
  log.afterParity = summarizeParity(parity);
  await save();
  assert.notEqual(parity.state, 'FAILED', `PARITY_FAILED:${parity.error ?? parity.message ?? ''}`);

  if (parity.state === 'MATCH') {
    log.outcome = 'CURRENT_CONTEXT_PARITY_MATCH';
    console.log('STAGE8_CURRENT_CONTEXT_PARITY_MATCH');
  } else {
    assert.equal(parity.report?.candidateSalesRequestId, EXPECTED_SOURCE_REQUEST, 'FINAL_PARITY_SOURCE_CHANGED');
    assert.equal(parity.report?.analysisAsOf, EXPECTED_ASOF, 'FINAL_PARITY_TIME_CHANGED');
    assert.equal(parity.report?.candidatePlanFingerprint, EXPECTED_PLAN, 'FINAL_PARITY_PLAN_CHANGED');
    assert.ok(/^sha256:[a-f0-9]{64}$/.test(parity.report?.parityFingerprint ?? ''), 'FINAL_PARITY_FINGERPRINT_INVALID');

    const priorEvidence = await status(EVIDENCE);
    assert.ok(!['QUEUED', 'RUNNING'].includes(priorEvidence.state), 'OTHER_EVIDENCE_RUN_ACTIVE');
    log.beforeEvidence = summarizeEvidence(priorEvidence);

    const evidenceStart = await request(EVIDENCE, 'start');
    log.evidenceStart = evidenceStart;
    await save();
    if (evidenceStart.http !== 202 || evidenceStart.data?.ok !== true || evidenceStart.data?.accepted !== true) {
      log.outcome = 'EVIDENCE_START_BLOCKED';
      throw new Error(`EVIDENCE_START_BLOCKED:${evidenceStart.http}:${evidenceStart.data?.code ?? ''}:${evidenceStart.data?.message ?? ''}`);
    }
    assert.equal(evidenceStart.data.candidateSalesRequestId, EXPECTED_SOURCE_REQUEST, 'NEW_EVIDENCE_SOURCE_CHANGED');
    assert.equal(evidenceStart.data.candidateParityRequestId, parityRequestId, 'NEW_EVIDENCE_PARITY_REQUEST_CHANGED');
    assert.equal(evidenceStart.data.analysisAsOf, EXPECTED_ASOF, 'NEW_EVIDENCE_TIME_CHANGED');
    assert.equal(evidenceStart.data.candidateParityFingerprint, parity.report.parityFingerprint, 'NEW_EVIDENCE_PARITY_FINGERPRINT_CHANGED');
    const evidenceRequestId = evidenceStart.data.requestId;
    log.evidenceRequestId = evidenceRequestId;

    const evidence = await runUntilTerminal(EVIDENCE, evidenceRequestId, 'evidence', ['COMPLETE', 'FAILED'], 80, 12 * 60_000);
    log.afterEvidence = summarizeEvidence(evidence);
    await save();
    assert.notEqual(evidence.state, 'FAILED', `EVIDENCE_FAILED:${evidence.error ?? evidence.message ?? ''}`);
    assert.equal(evidence.report?.candidateSalesRequestId, EXPECTED_SOURCE_REQUEST, 'FINAL_EVIDENCE_SOURCE_CHANGED');
    assert.equal(evidence.report?.candidateParityRequestId, parityRequestId, 'FINAL_EVIDENCE_PARITY_CHANGED');
    assert.equal(evidence.report?.analysisAsOf, EXPECTED_ASOF, 'FINAL_EVIDENCE_TIME_CHANGED');
    assert.equal(evidence.report?.candidateParityFingerprint, parity.report.parityFingerprint, 'FINAL_EVIDENCE_FINGERPRINT_CHANGED');
    assert.equal(evidence.report?.truncatedEvidenceRows ?? 0, 0, 'EVIDENCE_TRUNCATED');

    const expectedTargets = new Set([
      ...(parity.report?.mismatchSamples ?? []).map(row => row.barcode),
      ...(parity.report?.missingDirectBarcodes ?? []),
      ...(parity.report?.directOnlyManagedBarcodes ?? []),
    ]);
    const affected = new Set(evidence.report?.affectedBarcodes ?? []);
    const missingEvidenceTargets = [...expectedTargets].filter(barcode => !affected.has(barcode));
    const evidenceUnits = sumRecord(evidence.report?.categoryUnitDelta);
    const evidenceRevenue = sumRecord(evidence.report?.categoryRevenueDelta);
    const parityUnits = Number(parity.report?.candidateMinusDirectUnits ?? 0);
    const parityRevenue = Number(parity.report?.candidateMinusDirectRevenue ?? 0);
    log.reconciliation = {
      parityCandidateMinusDirectUnits: parityUnits,
      parityCandidateMinusDirectRevenue: parityRevenue,
      evidenceLegacyMinusCanonicalUnits: evidenceUnits,
      evidenceLegacyMinusCanonicalRevenue: evidenceRevenue,
      missingEvidenceTargets,
      exactAggregateReconciliation: evidenceUnits === -parityUnits && evidenceRevenue === -parityRevenue && missingEvidenceTargets.length === 0,
    };
    assert.deepEqual(missingEvidenceTargets, [], `EVIDENCE_TARGETS_MISSING:${missingEvidenceTargets.join(',')}`);
    assert.equal(evidenceUnits, -parityUnits, 'EVIDENCE_UNIT_DELTA_DOES_NOT_RECONCILE');
    assert.equal(evidenceRevenue, -parityRevenue, 'EVIDENCE_REVENUE_DELTA_DOES_NOT_RECONCILE');
    log.outcome = 'CURRENT_CONTEXT_MISMATCH_FULLY_EVIDENCED';
    console.log('STAGE8_CURRENT_CONTEXT_MISMATCH_FULLY_EVIDENCED');
  }

  console.log(JSON.stringify({ outcome: log.outcome, parity: log.afterParity, evidence: log.afterEvidence ?? null, reconciliation: log.reconciliation ?? null }));
} catch (error) {
  if (log.outcome === 'STARTING') log.outcome = 'STOPPED_FOR_INSPECTION';
  log.failure = String(error?.message ?? error).split('\n')[0].slice(0, 500);
  console.error('STAGE8_CURRENT_CONTEXT_VERIFY_STOPPED', log.failure);
  process.exitCode = 1;
} finally {
  log.finishedAt = new Date().toISOString();
  await save();
  await browser.close();
}
