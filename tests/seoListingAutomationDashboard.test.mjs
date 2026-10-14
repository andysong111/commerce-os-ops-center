import assert from "node:assert/strict";
import test from "node:test";

import {
  selectLatestSeoReadyProducts,
  summarizeSeoListingLifecycle,
} from "../src/lib/seoListingAutomationDashboard.ts";

function job(overrides = {}) {
  return {
    run_id: "seo-run-00000001",
    launch_item_id: "launch-1",
    model_number: "AAA001",
    product_name: "테스트 상품",
    status: "ready",
    registration_status: "idle",
    run_created_at: "2026-10-15T00:00:00.000Z",
    created_at: "2026-10-15T00:00:00.000Z",
    ...overrides,
  };
}

test("only the latest RUN per canonical product can enter the ready pool", () => {
  const ready = selectLatestSeoReadyProducts([
    job({ run_id: "seo-run-old00001", run_created_at: "2026-10-14T00:00:00.000Z" }),
    job({ run_id: "seo-run-new00001", run_created_at: "2026-10-15T00:00:00.000Z" }),
  ]);
  assert.equal(ready.length, 1);
  assert.equal(ready[0].runId, "seo-run-new00001");
});

test("a newer active or completed RUN prevents an older idle RUN from being auto-selected", () => {
  for (const registrationStatus of ["queued", "running", "success"]) {
    const ready = selectLatestSeoReadyProducts([
      job({ run_id: `seo-run-old-${registrationStatus}`, run_created_at: "2026-10-14T00:00:00.000Z" }),
      job({
        run_id: `seo-run-new-${registrationStatus}`,
        run_created_at: "2026-10-15T00:00:00.000Z",
        registration_status: registrationStatus,
      }),
    ]);
    assert.deepEqual(ready, []);
  }
});

test("lifecycle summary ignores malformed states but retains review count", () => {
  const summary = summarizeSeoListingLifecycle([
    { state: "LIVE", requires_review: false },
    { state: "LIVE", requires_review: true },
    { state: "UNKNOWN", requires_review: true },
  ]);
  assert.equal(summary.counts.LIVE, 2);
  assert.equal(summary.counts.EXCEPTION, 0);
  assert.equal(summary.requiresReviewCount, 2);
});
