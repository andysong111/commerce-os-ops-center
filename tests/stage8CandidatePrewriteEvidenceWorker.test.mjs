import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [worker, parity, evidence, salesCron, dispatcher, migration] =
  await Promise.all([
    read("src/app/api/cron/stage8-candidate-prewrite-evidence/route.ts"),
    read("src/lib/stage8CandidateDemandParity.ts"),
    read("src/lib/stage8CandidateMismatchEvidence.ts"),
    read("src/app/api/cron/product-master-shopling-sales-events/route.ts"),
    read("src/lib/opsAdaptiveDispatcher.ts"),
    read("supabase/migrations/20260918094000_stage8_candidate_prewrite_evidence_worker.sql"),
  ]);

test("prewrite worker is current-candidate pinned and never writes Product Master", () => {
  assert.match(worker, /loadLatestCandidateSalesSnapshot/);
  assert.match(worker, /parityMatchesCandidate/);
  assert.match(worker, /evidenceMatchesCandidate/);
  assert.match(worker, /candidateSalesRequestId === candidate\.salesRequestId/);
  assert.match(worker, /candidateParityFingerprint === parity\.report\.parityFingerprint/);
  assert.match(worker, /writesEnabled: false/);
  assert.match(worker, /approvalEnabled: false/);
  assert.doesNotMatch(worker, /applyProductMasterShoplingSalesEvents|postProductMasterEvents|sku_sales_events/);
});

test("incomplete sales waits instead of creating stale parity evidence", () => {
  assert.match(worker, /CANDIDATE_SALES_COLLECTION_INCOMPLETE/);
  assert.match(worker, /CANDIDATE_SALES_REPORT_REQUIRED/);
  assert.match(worker, /state: "WAITING_SALES"/);
  assert.match(worker, /createCandidateDemandParityRequest/);
  assert.ok(
    worker.indexOf('state: "WAITING_SALES"') <
      worker.indexOf("let parity = await loadCandidateDemandParityStatus"),
  );
});

test("parity and mismatch evidence expose their immutable request context", () => {
  for (const source of [parity, evidence]) {
    assert.match(source, /candidateSalesRequestId/);
    assert.match(source, /analysisAsOf/);
    assert.match(source, /planningContentFingerprint/);
    assert.match(source, /candidateEventFingerprint/);
    assert.match(source, /candidatePlanFingerprint/);
  }
  assert.match(evidence, /candidateParityRequestId/);
  assert.match(evidence, /candidateParityFingerprint/);
});

test("worker drains only bounded read-only steps and promotion remains a gate", () => {
  assert.match(worker, /MAX_STEPS_PER_INVOCATION = 3/);
  assert.match(worker, /EXTRA_STEP_START_BUDGET_MS = 12_000/);
  assert.match(worker, /runCandidateDemandParityStep/);
  assert.match(worker, /runCandidateMismatchEvidenceStep/);
  assert.match(worker, /loadCandidatePromotionGate/);
  assert.match(worker, /state: gate\.safeToApply \? "READY_CANARY" : "BLOCKED"/);
});

test("dispatcher schedules the worker behind operational work with one-minute busy cadence", () => {
  assert.match(dispatcher, /"stage8-candidate-prewrite-evidence"/);
  assert.match(
    dispatcher,
    /import\("@\/app\/api\/cron\/stage8-candidate-prewrite-evidence\/route"\)/,
  );
  assert.match(migration, /'stage8-candidate-prewrite-evidence'/);
  assert.match(migration, /'diagnostic'/);
  assert.match(migration, /\n  205,/);
  assert.match(migration, /\n  300,\n  60,/);
});

test("completed sales candidate wakes the downstream prewrite worker without approving writes", () => {
  assert.match(salesCron, /wakeOpsDispatchTask/);
  assert.match(salesCron, /"stage8-candidate-prewrite-evidence"/);
  assert.match(salesCron, /\["READY_CANARY", "READY_FULL"\]/);
  assert.doesNotMatch(salesCron, /confirmation: "CANARY"|confirmation: "FULL"/);
});
