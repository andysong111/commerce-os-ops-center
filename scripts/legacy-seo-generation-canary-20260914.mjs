import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const ORIGIN = 'https://commerce-os-ops-center.vercel.app';
const IDS = ['legacy-seo-run-c03c6c24-b227-4586-a085-c236f8d0eaba', 'legacy-seo-run-60ad4ff9-5e39-432d-98f0-254f902026cc'];
const MODELS = ['AAA106', 'AAA109'];
const REPORT = 'artifacts/legacy-seo-canary/summary.json';
const report = { expectedProductionCommit: '98628c1bd20d39e82d92508c063620e0e5638b36', startedAt: new Date().toISOString(), generationPosts: 0, shoplingWrites: 0, observations: [] };
await mkdir('artifacts/legacy-seo-canary', { recursive: true });
const browser = await chromium.launch({ headless: true });
let mutationSent = false;
let authorizedPost = false;
let networkPosts = 0;
let postError = '';
const compact = row => ({ model: row.model_number, status: row.status, stage: row.stage, registrationStatus: row.registration_status, hasUploadJob: Boolean(row.registration_job_id), error: String(row.error_message || '').slice(0, 500) });
const archiveSignature = rows => JSON.stringify(rows.map(row => [row.run_id, row.status, row.registration_status, row.archived_at, row.updated_at]).sort((a,b) => a[0].localeCompare(b[0])));
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', async route => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin !== ORIGIN) return route.abort('blockedbyclient');
    if (req.method() === 'GET') {
      if (url.pathname === '/' || url.pathname.startsWith('/_next/') || url.pathname === '/favicon.ico' || url.pathname === '/api/legacy-seo-run-jobs-lite') return route.continue();
      return route.abort('blockedbyclient');
    }
    if (authorizedPost && networkPosts === 0 && req.method() === 'POST' && url.pathname === '/api/legacy-seo-run-jobs') {
      let body;
      try { body = req.postDataJSON(); } catch { return route.abort('blockedbyclient'); }
      if (Object.keys(body).sort().join(',') === 'action,runIds' && body.action === 'retry' && JSON.stringify(body.runIds) === JSON.stringify(IDS)) {
        networkPosts += 1;
        authorizedPost = false;
        return route.continue();
      }
    }
    return route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  assert.equal(new URL(page.url()).origin, ORIGIN);
  const api = async (path, body) => page.evaluate(async ({ path, body }) => {
    try {
      const response = await fetch(path, { method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(body ? 45000 : 15000) });
      const result = await response.json().catch(() => ({}));
      return { status: response.status, ok: response.ok && result.ok === true, jobsAvailable: result.jobsAvailable, jobs: Array.isArray(result.jobs) ? result.jobs.map(row => ({ run_id: row.run_id, launch_item_id: row.launch_item_id, model_number: row.model_number, status: row.status, stage: row.stage, registration_status: row.registration_status, registration_job_id: row.registration_job_id, archived_at: row.archived_at, updated_at: row.updated_at, error_message: String(row.error_message || '').slice(0,500) })) : [] };
    } catch (error) { return { ok: false, status: 0, error: error.name, jobs: [] }; }
  }, { path, body });
  const read = async archived => {
    const result = await api(`/api/legacy-seo-run-jobs-lite?items=false&scope=${archived ? 'archived' : 'active'}`);
    assert.ok(result.ok && result.jobsAvailable === true, `Normal browser authorization/read unavailable (HTTP ${result.status}); no authentication changes are permitted.`);
    assert.ok(result.jobs.length < 1000, 'Refuse incomplete ledger');
    return result.jobs;
  };
  const activeBefore = await read(false);
  const archivedBefore = await read(true);
  assert.equal(archivedBefore.length, 83, 'Archive drift: stop before any write');
  assert.ok(archivedBefore.every(row => row.status === 'ready' && row.registration_status === 'success'));
  assert.ok(!activeBefore.some(row => ['queued', 'running'].includes(row.status)), 'Another generation is active');
  const targets = IDS.map((id, i) => {
    const row = activeBefore.find(job => job.run_id === id);
    assert.ok(row && row.model_number === MODELS[i]);
    assert.equal(row.status, 'failed');
    assert.equal(row.stage, 'filter_keywords');
    assert.equal(row.registration_status, 'idle');
    assert.ok(!row.registration_job_id && !row.archived_at && row.launch_item_id);
    assert.equal(activeBefore.filter(job => job.launch_item_id === row.launch_item_id).length, 1, 'Duplicate source RUN');
    assert.ok(!archivedBefore.some(job => job.launch_item_id === row.launch_item_id));
    return row;
  });
  assert.equal(new Set(targets.map(row => row.launch_item_id)).size, 2);
  report.before = targets.map(compact);
  report.archivedBefore = archivedBefore.length;
  authorizedPost = true;
  mutationSent = true;
  // Exactly one request through the existing same-origin generation retry API.
  // An uncertain response is NEVER retried. No enqueue or registration action exists here.
  const started = await api('/api/legacy-seo-run-jobs', { action: 'retry', runIds: IDS });
  report.generationPosts = networkPosts;
  if (!started.ok) postError = `Generation retry response uncertain/unavailable (HTTP ${started.status}); not retried`;
  else {
    assert.equal(started.jobs.length, 2);
    assert.ok(started.jobs.every(row => IDS.includes(row.run_id) && row.registration_status === 'idle' && !row.registration_job_id));
  }
  const end = Date.now() + 9 * 60 * 1000;
  let terminal = false;
  while (Date.now() < end) {
    await page.waitForTimeout(15000);
    const active = await read(false);
    const selected = IDS.map(id => active.find(row => row.run_id === id));
    assert.ok(selected.every(Boolean), 'Target missing from active ledger');
    assert.ok(selected.every(row => row.registration_status === 'idle' && !row.registration_job_id), 'Unexpected registration state');
    report.observations.push({ at: new Date().toISOString(), targets: selected.map(compact) });
    report.after = selected.map(compact);
    console.log(JSON.stringify(report.observations.at(-1)));
    if (selected.every(row => ['ready', 'failed'].includes(row.status))) { terminal = true; break; }
  }
  const archivedAfter = await read(true);
  report.archivedAfter = archivedAfter.length;
  report.archivedUnchanged = archiveSignature(archivedBefore) === archiveSignature(archivedAfter);
  assert.ok(report.archivedUnchanged, 'Completed archive changed during generation-only canary');
  assert.equal(networkPosts, 1);
  report.terminal = terminal;
  report.generationSucceeded = terminal && report.after.every(row => row.status === 'ready');
  report.postWarning = postError;
  if (!report.generationSucceeded) throw new Error('Generation-only canary did not reach ready for both targets; inspect saved stages/errors, do not automatically retry');
} catch (error) {
  report.error = String(error.message || error).slice(0, 600);
  report.mutationAttempted = mutationSent;
  report.generationPosts = networkPosts;
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(REPORT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  await browser.close();
}
