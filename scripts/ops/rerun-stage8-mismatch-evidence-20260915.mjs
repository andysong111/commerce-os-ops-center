import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const ORIGIN = 'https://commerce-os-ops-center.vercel.app';
const PAGE = '/stage8-sales-events';
const SALES = '/api/product-master/shopling-sales-events';
const PARITY = '/api/stage8/candidate-demand-parity';
const EVIDENCE = '/api/stage8/candidate-mismatch-evidence';
const GET_APIS = new Set([SALES, PARITY, EVIDENCE]);
const SIMPLE_ACTIONS = new Map([
  [SALES, new Set(['start', 'run-next'])],
  [PARITY, new Set(['start', 'run-next'])],
  [EVIDENCE, new Set(['start', 'run-next'])],
]);

function exactKeys(body, keys) {
  return body && typeof body === 'object' && !Array.isArray(body) &&
    Object.keys(body).sort().join('|') === [...keys].sort().join('|');
}

function allow(url, method, topFrame, body, armed) {
  const u = new URL(url);
  if (u.origin !== ORIGIN || !topFrame) return false;
  if (method === 'GET') {
    return u.pathname === PAGE || u.pathname.startsWith('/_next/static/') || (GET_APIS.has(u.pathname) && !u.search);
  }
  if (method !== 'POST' || u.search || !armed || armed.path !== u.pathname || body?.action !== armed.action) return false;
  if (u.pathname === SALES && body?.action === 'refresh') {
    return exactKeys(body, ['action', 'expectedRequestId', 'expectedPlanFingerprint', 'confirmation']) &&
      body.confirmation === 'REFRESH_CANDIDATE';
  }
  return SIMPLE_ACTIONS.get(u.pathname)?.has(body?.action) === true && exactKeys(body, ['action']);
}

const fakeRefresh = {
  action: 'refresh',
  expectedRequestId: '00000000-0000-4000-8000-000000000000',
  expectedPlanFingerprint: `sha256:${'0'.repeat(64)}`,
  confirmation: 'REFRESH_CANDIDATE',
};
assert.ok(allow(ORIGIN + SALES, 'POST', true, fakeRefresh, { path: SALES, action: 'refresh' }));
for (const path of [SALES, PARITY, EVIDENCE]) {
  for (const action of ['canary', 'full', 'approve', 'publish']) {
    assert.equal(allow(ORIGIN + path, 'POST', true, { action }, { path, action }), false);
  }
}
assert.equal(allow(ORIGIN + SALES, 'POST', true, { action: 'refresh' }, { path: SALES, action: 'refresh' }), false);
for (const path of [SALES, PARITY, EVIDENCE]) {
  for (const action of ['start', 'run-next']) {
    assert.ok(allow(ORIGIN + path, 'POST', true, { action }, { path, action }));
  }
}
assert.equal(allow(ORIGIN + SALES, 'POST', false, { action: 'start' }, { path: SALES, action: 'start' }), false);
console.log('STAGE8_SOURCE_PARITY_EVIDENCE_READ_ONLY_BOUNDARY_PASS');
if (process.argv.includes('--self-test')) process.exit(0);

assert.equal(process.env.GITHUB_REF_NAME, 'ops/rerun-stage8-evidence-20260915');
assert.equal(process.env.EVIDENCE_RERUN_AUTHORIZATION, 'OWNER_AUTHORIZED_READ_ONLY_EVIDENCE_RERUN');

const tools = createRequire(`${process.env.SALES_BROWSER_TOOLS}/package.json`);
const { chromium } = tools('playwright');
const dir = 'artifacts/stage8-evidence-rerun-20260915';
await mkdir(dir, { recursive: true });
const log = {
  mode: 'REAL_PRODUCTION_READ_ONLY_FRESH_SOURCE_PARITY_EVIDENCE',
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
    let data = null;
    try { data = await response.json(); } catch { data = {}; }
    return { http: response.status, data };
  }, { path, body });
}

async function status(path) {
  const response = await request(path);
  assert.equal(response.http, 200, `${path}:STATUS_HTTP_${response.http}`);
  assert.equal(response.data.ok, true, `${path}:STATUS_NOT_OK`);
  assert.equal(response.data.status?.configured, true, `${path}:NOT_CONFIGURED`);
  return response.data.status;
}

function summarizeSource(value) {
  return {
    requestId: value?.requestId ?? null,
    state: value?.state ?? null,
    analysisAsOf: value?.analysisAsOf ?? null,
    completedRanges: value?.completedRanges ?? null,
    totalRanges: value?.totalRanges ?? null,
    report: value?.report ? {
      fetchedRows: value.report.fetchedRows,
      sourceEventCount: value.report.sourceEventCount,
      validEventCount: value.report.validEventCount,
      tombstoneCount: value.report.tombstoneCount,
      unmappedRows: value.report.unmappedRows,
      identityConflictCount: value.report.identityConflictCount,
      totalBaseUnits: value.report.totalBaseUnits,
      totalRevenue: value.report.totalRevenue,
      eventFingerprint: value.report.eventFingerprint,
      planFingerprint: value.report.planFingerprint,
    } : null,
  };
}

function summarizeParity(value) {
  const report = value?.report ?? null;
  return {
    requestId: value?.requestId ?? null,
    state: value?.state ?? null,
    completedRanges: value?.completedRanges ?? null,
    totalRanges: value?.totalRanges ?? null,
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

function summarizeEvidence(value) {
  const report = value?.report ?? null;
  return {
    requestId: value?.requestId ?? null,
    state: value?.state ?? null,
    completedRanges: value?.completedRanges ?? null,
    totalRanges: value?.totalRanges ?? null,
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

function sumRecord(record) {
  return Object.values(record ?? {}).reduce((sum, value) => sum + (Number(value) || 0), 0);
}

async function runFreshSource(before) {
  assert.ok(['READY_CANARY', 'READY_FULL', 'COMPLETED', 'BLOCKED', 'STORAGE_NOT_READY'].includes(before.state), `SOURCE_REFRESH_STATE_BLOCKED:${before.state}`);
  assert.ok(before.requestId, 'SOURCE_REFRESH_REQUEST_REQUIRED');
  assert.ok(/^sha256:[a-f0-9]{64}$/.test(before.report?.planFingerprint ?? ''), 'SOURCE_REFRESH_PLAN_REQUIRED');
  const refresh = await request(SALES, {
    action: 'refresh',
    expectedRequestId: before.requestId,
    expectedPlanFingerprint: before.report.planFingerprint,
    confirmation: 'REFRESH_CANDIDATE',
  });
  log.sourceRefresh = refresh;
  await save();
  assert.equal(refresh.http, 202, `SOURCE_REFRESH_HTTP_${refresh.http}:${refresh.data?.code ?? ''}:${refresh.data?.message ?? ''}`);
  assert.equal(refresh.data?.ok, true, 'SOURCE_REFRESH_NOT_OK');
  assert.equal(refresh.data?.accepted, true, 'SOURCE_REFRESH_NOT_ACCEPTED');
  let requestId = refresh.data.requestId;
  const analysisAsOf = refresh.data.analysisAsOf;
  assert.ok(requestId && analysisAsOf, 'SOURCE_REFRESH_IDENTITY_MISSING');
  assert.ok(Date.parse(analysisAsOf) > Date.parse(before.analysisAsOf ?? ''), 'SOURCE_REFRESH_NOT_NEWER');

  const deadline = Date.now() + 14 * 60_000;
  for (let i = 0; i < 120 && Date.now() < deadline; i += 1) {
    const current = await status(SALES);
    assert.equal(current.requestId, requestId, 'SOURCE_REQUEST_CHANGED_EXTERNALLY');
    assert.equal(current.analysisAsOf, analysisAsOf, 'SOURCE_ANALYSIS_TIME_CHANGED');
    if (['READY_CANARY', 'READY_FULL'].includes(current.state)) {
      assert.equal(current.report?.unmappedRows ?? -1, 0, 'SOURCE_UNMAPPED_ROWS_PRESENT');
      assert.equal(current.report?.identityConflictCount ?? -1, 0, 'SOURCE_IDENTITY_CONFLICT_PRESENT');
      assert.ok(/^sha256:[a-f0-9]{64}$/.test(current.report?.planFingerprint ?? ''), 'SOURCE_PLAN_FINGERPRINT_INVALID');
      assert.ok(/^sha256:[a-f0-9]{64}$/.test(current.report?.eventFingerprint ?? ''), 'SOURCE_EVENT_FINGERPRINT_INVALID');
      return current;
    }
    if (current.state === 'FAILED') {
      const recovery = await request(SALES, { action: 'start' });
      log.sourceRecoveries.push({ fromRequestId: requestId, response: recovery });
      await save();
      assert.equal(recovery.http, 202, `SOURCE_RECOVERY_HTTP_${recovery.http}:${recovery.data?.code ?? ''}:${recovery.data?.message ?? ''}`);
      assert.equal(recovery.data?.ok, true, 'SOURCE_RECOVERY_NOT_OK');
      assert.equal(recovery.data?.accepted, true, 'SOURCE_RECOVERY_NOT_ACCEPTED');
      assert.equal(recovery.data?.analysisAsOf, analysisAsOf, 'SOURCE_RECOVERY_TIME_CHANGED');
      requestId = recovery.data.requestId;
      continue;
    }
    assert.ok(['QUEUED', 'RUNNING'].includes(current.state), `SOURCE_UNEXPECTED_STATE:${current.state}`);
    const step = await request(SALES, { action: 'run-next' });
    assert.equal(step.http, 200, `SOURCE_STEP_HTTP_${step.http}`);
    assert.equal(step.data?.ok, true, 'SOURCE_STEP_NOT_OK');
    if (step.data?.result?.requestId) assert.equal(step.data.result.requestId, requestId, 'SOURCE_STEP_REQUEST_CHANGED');
    log.sourceSteps.push({ index: i + 1, requestId, state: step.data?.result?.state ?? null, range: step.data?.result?.range ?? null });
    if ((i + 1) % 10 === 0) console.log(JSON.stringify({ kind: 'source', step: i + 1, requestId, state: step.data?.result?.state ?? null }));
  }
  throw new Error('SOURCE_COLLECTION_TIMEOUT');
}

function sourcePin(source) {
  return {
    requestId: source.requestId,
    analysisAsOf: source.analysisAsOf,
    planFingerprint: source.report.planFingerprint,
    eventFingerprint: source.report.eventFingerprint,
  };
}

async function verifyPinnedSource(pin) {
  const current = await status(SALES);
  assert.equal(current.requestId, pin.requestId, 'PINNED_SOURCE_REQUEST_CHANGED');
  assert.equal(current.analysisAsOf, pin.analysisAsOf, 'PINNED_SOURCE_TIME_CHANGED');
  assert.equal(current.report?.planFingerprint, pin.planFingerprint, 'PINNED_SOURCE_PLAN_CHANGED');
  assert.equal(current.report?.eventFingerprint, pin.eventFingerprint, 'PINNED_SOURCE_EVENT_CHANGED');
  assert.equal(current.report?.unmappedRows ?? -1, 0, 'PINNED_SOURCE_UNMAPPED');
  assert.equal(current.report?.identityConflictCount ?? -1, 0, 'PINNED_SOURCE_IDENTITY_CONFLICT');
  return current;
}

async function runStage(path, requestId, kind, terminalStates, pin, maxSteps, maxMs) {
  const deadline = Date.now() + maxMs;
  let current = await status(path);
  for (let i = 0; i < maxSteps && Date.now() < deadline && ['QUEUED', 'RUNNING'].includes(current.state); i += 1) {
    assert.equal(current.requestId, requestId, `${kind.toUpperCase()}_REQUEST_CHANGED_DURING_RUN`);
    if ((i + 1) % 8 === 1) await verifyPinnedSource(pin);
    const step = await request(path, { action: 'run-next' });
    assert.equal(step.http, 200, `${kind.toUpperCase()}_STEP_HTTP_${step.http}`);
    assert.equal(step.data?.ok, true, `${kind.toUpperCase()}_STEP_NOT_OK`);
    if (step.data?.result?.requestId) assert.equal(step.data.result.requestId, requestId, `${kind.toUpperCase()}_STEP_REQUEST_CHANGED`);
    log[`${kind}Steps`].push({ index: i + 1, state: step.data?.result?.state ?? null, processed: step.data?.result?.processed ?? null });
    current = await status(path);
    if ((i + 1) % 10 === 0) console.log(JSON.stringify({ kind, step: i + 1, state: current.state, completedRanges: current.completedRanges, totalRanges: current.totalRanges }));
  }
  current = await status(path);
  assert.equal(current.requestId, requestId, `${kind.toUpperCase()}_FINAL_REQUEST_CHANGED`);
  assert.ok(terminalStates.includes(current.state), `${kind.toUpperCase()}_NOT_TERMINAL:${current.state}`);
  await verifyPinnedSource(pin);
  return current;
}

try {
  const nav = await page.goto(ORIGIN + PAGE, { waitUntil: 'domcontentloaded', timeout: 120000 });
  assert.equal(nav?.status(), 200, 'PRODUCTION_PAGE_HTTP_FAILED');
  assert.equal(new URL(page.url()).pathname, PAGE, 'LOGIN_REQUIRED');

  const beforeSource = await status(SALES);
  log.beforeSource = summarizeSource(beforeSource);
  assert.equal(beforeSource.report?.unmappedRows ?? 0, 0, 'PREVIOUS_SOURCE_UNMAPPED');
  assert.equal(beforeSource.report?.identityConflictCount ?? 0, 0, 'PREVIOUS_SOURCE_IDENTITY_CONFLICT');

  const freshSource = await runFreshSource(beforeSource);
  log.freshSource = summarizeSource(freshSource);
  const pin = sourcePin(freshSource);
  await save();
  console.log(JSON.stringify({ freshSource: log.freshSource, recoveries: log.sourceRecoveries.length }));

  const priorParity = await status(PARITY);
  assert.ok(!['QUEUED', 'RUNNING'].includes(priorParity.state), 'OTHER_PARITY_RUN_ACTIVE');
  log.beforeParity = summarizeParity(priorParity);

  const parityStart = await request(PARITY, { action: 'start' });
  log.parityStart = parityStart;
  await save();
  assert.equal(parityStart.http, 202, `PARITY_START_HTTP_${parityStart.http}:${parityStart.data?.code ?? ''}:${parityStart.data?.message ?? ''}`);
  assert.equal(parityStart.data?.ok, true, 'PARITY_START_NOT_OK');
  assert.equal(parityStart.data?.accepted, true, 'PARITY_START_NOT_ACCEPTED');
  assert.equal(parityStart.data?.candidateSalesRequestId, pin.requestId, 'PARITY_SOURCE_CHANGED');
  assert.equal(parityStart.data?.analysisAsOf, pin.analysisAsOf, 'PARITY_TIME_CHANGED');
  assert.equal(parityStart.data?.candidatePlanFingerprint, pin.planFingerprint, 'PARITY_PLAN_CHANGED');
  const parityRequestId = parityStart.data.requestId;

  const parity = await runStage(PARITY, parityRequestId, 'parity', ['MATCH', 'MISMATCH', 'FAILED'], pin, 80, 10 * 60_000);
  log.afterParity = summarizeParity(parity);
  await save();
  assert.notEqual(parity.state, 'FAILED', `PARITY_FAILED:${parity.error ?? parity.message ?? ''}`);

  if (parity.state === 'MATCH') {
    log.outcome = 'FRESH_SOURCE_PARITY_MATCH';
    console.log('STAGE8_FRESH_SOURCE_PARITY_MATCH');
  } else {
    assert.equal(parity.report?.candidateSalesRequestId, pin.requestId, 'FINAL_PARITY_SOURCE_CHANGED');
    assert.equal(parity.report?.analysisAsOf, pin.analysisAsOf, 'FINAL_PARITY_TIME_CHANGED');
    assert.equal(parity.report?.candidatePlanFingerprint, pin.planFingerprint, 'FINAL_PARITY_PLAN_CHANGED');
    assert.ok(/^sha256:[a-f0-9]{64}$/.test(parity.report?.parityFingerprint ?? ''), 'FINAL_PARITY_FINGERPRINT_INVALID');

    const priorEvidence = await status(EVIDENCE);
    assert.ok(!['QUEUED', 'RUNNING'].includes(priorEvidence.state), 'OTHER_EVIDENCE_RUN_ACTIVE');
    log.beforeEvidence = summarizeEvidence(priorEvidence);

    const evidenceStart = await request(EVIDENCE, { action: 'start' });
    log.evidenceStart = evidenceStart;
    await save();
    assert.equal(evidenceStart.http, 202, `EVIDENCE_START_HTTP_${evidenceStart.http}:${evidenceStart.data?.code ?? ''}:${evidenceStart.data?.message ?? ''}`);
    assert.equal(evidenceStart.data?.ok, true, 'EVIDENCE_START_NOT_OK');
    assert.equal(evidenceStart.data?.accepted, true, 'EVIDENCE_START_NOT_ACCEPTED');
    assert.equal(evidenceStart.data?.candidateSalesRequestId, pin.requestId, 'EVIDENCE_SOURCE_CHANGED');
    assert.equal(evidenceStart.data?.candidateParityRequestId, parityRequestId, 'EVIDENCE_PARITY_REQUEST_CHANGED');
    assert.equal(evidenceStart.data?.analysisAsOf, pin.analysisAsOf, 'EVIDENCE_TIME_CHANGED');
    assert.equal(evidenceStart.data?.candidateParityFingerprint, parity.report.parityFingerprint, 'EVIDENCE_PARITY_FINGERPRINT_CHANGED');
    const evidenceRequestId = evidenceStart.data.requestId;

    const evidence = await runStage(EVIDENCE, evidenceRequestId, 'evidence', ['COMPLETE', 'FAILED'], pin, 80, 12 * 60_000);
    log.afterEvidence = summarizeEvidence(evidence);
    await save();
    assert.notEqual(evidence.state, 'FAILED', `EVIDENCE_FAILED:${evidence.error ?? evidence.message ?? ''}`);
    assert.equal(evidence.report?.candidateSalesRequestId, pin.requestId, 'FINAL_EVIDENCE_SOURCE_CHANGED');
    assert.equal(evidence.report?.candidateParityRequestId, parityRequestId, 'FINAL_EVIDENCE_PARITY_CHANGED');
    assert.equal(evidence.report?.analysisAsOf, pin.analysisAsOf, 'FINAL_EVIDENCE_TIME_CHANGED');
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
    log.outcome = 'FRESH_SOURCE_MISMATCH_FULLY_EVIDENCED';
    console.log('STAGE8_FRESH_SOURCE_MISMATCH_FULLY_EVIDENCED');
  }

  console.log(JSON.stringify({ outcome: log.outcome, source: log.freshSource, parity: log.afterParity, evidence: log.afterEvidence ?? null, reconciliation: log.reconciliation ?? null }));
} catch (error) {
  if (log.outcome === 'STARTING') log.outcome = 'STOPPED_FOR_INSPECTION';
  log.failure = String(error?.message ?? error).split('\n')[0].slice(0, 500);
  console.error('STAGE8_FRESH_SOURCE_VERIFY_STOPPED', log.failure);
  process.exitCode = 1;
} finally {
  log.finishedAt = new Date().toISOString();
  await save();
  await browser.close();
}
