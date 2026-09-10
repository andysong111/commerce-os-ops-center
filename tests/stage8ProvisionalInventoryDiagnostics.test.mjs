import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(
  new URL("../src/lib/stage8ProvisionalInventoryDiagnostics.ts", import.meta.url),
  "utf8",
);
const salesSnapshotSource = fs.readFileSync(
  new URL("../src/lib/stage8CanonicalSalesEventSnapshot.ts", import.meta.url),
  "utf8",
);
const pageSource = fs.readFileSync(
  new URL("../src/app/stage8-provisional-inventory-diagnostics/page.tsx", import.meta.url),
  "utf8",
);

test("diagnostics only create a low/high band when exact latest evidence and canonical coverage are sufficient", () => {
  assert.match(source, /latestOrderScenarioEligible/);
  assert.match(source, /latestSafeOrderQuantity !== null/);
  assert.match(source, /latestStartMs >= coverageStartMs/);
  assert.match(source, /LATEST_COVERAGE_GAP/);
  assert.match(source, /LATEST_ORDER_EVIDENCE_MISSING/);
  assert.match(source, /Math\.min\(\s*cumulativeResidualCandidate,\s*latestResidualCandidate/);
  assert.match(source, /Math\.max\(\s*cumulativeResidualCandidate,\s*latestResidualCandidate/);
});

test("purchase sensitivity reuses the existing net-requirement and decision-envelope engines", () => {
  assert.match(source, /calculateNetRequirement/);
  assert.match(source, /buildProvisionalDecisionEnvelope/);
  assert.match(source, /INVENTORY_SENSITIVE/);
  assert.match(source, /ORDER_DIRECTION_STABLE/);
  assert.match(source, /HOLD_DIRECTION_STABLE/);
  assert.match(source, /actualDraftCreationEnabled: false/);
});

test("canonical sales snapshot is read-only and only accepts explicit completed-report states", () => {
  assert.match(salesSnapshotSource, /SALES_EVENT_CHUNK/);
  assert.match(salesSnapshotSource, /loadProductMasterShoplingSalesEventSyncStatus/);
  assert.match(salesSnapshotSource, /CANONICAL_REPORT_READY_STATES/);
  assert.match(
    salesSnapshotSource,
    /new Set\(\["READY_CANARY", "READY_FULL", "COMPLETED"\]\)/,
  );
  assert.match(
    salesSnapshotSource,
    /!isStage8CanonicalSalesReportReadyState\(status\.state\)/,
  );
  assert.match(salesSnapshotSource, /writesEnabled: false/);
  assert.doesNotMatch(salesSnapshotSource, /\.from\([^\n]+\)[\s\S]{0,200}\.insert\(/);
  assert.doesNotMatch(salesSnapshotSource, /\.from\([^\n]+\)[\s\S]{0,200}\.update\(/);
  assert.doesNotMatch(salesSnapshotSource, /\.from\([^\n]+\)[\s\S]{0,200}\.upsert\(/);
});

test("no provisional diagnostic path can promote inventory or create a real purchase draft", () => {
  assert.match(source, /inventoryUseAllowed: false/);
  assert.match(source, /inventoryPromotionAllowed: false/);
  assert.match(source, /purchaseWritesEnabled: false/);
  assert.match(source, /inventoryWritesEnabled: false/);
  assert.doesNotMatch(source, /\.from\([^\n]+\)[\s\S]{0,200}\.insert\(/);
  assert.doesNotMatch(source, /\.from\([^\n]+\)[\s\S]{0,200}\.update\(/);
  assert.doesNotMatch(source, /\.from\([^\n]+\)[\s\S]{0,200}\.upsert\(/);
  assert.doesNotMatch(source, /fetch\([^)]*method:\s*["'](?:POST|PUT|PATCH|DELETE)/i);
});

test("operator page states diagnostic-only semantics and draft creation remains off", () => {
  assert.match(pageSource, /DIAGNOSTIC ONLY · INVENTORY PROMOTION OFF · DRAFT CREATION OFF/);
  assert.match(pageSource, /Actual write/);
  assert.match(pageSource, /0 · READ ONLY/);
  assert.match(pageSource, /LATEST_COVERAGE_GAP/);
});
