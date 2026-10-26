import assert from "node:assert/strict";
import test from "node:test";
import { importTranspiledTypeScript } from "./transpileTypeScript.mjs";

const {
  PRODUCT_DECISION_ACTIVE_RESUME_MAX_AGE_MS,
  shouldReuseProductDecisionLiveStatus,
} = await importTranspiledTypeScript(
  new URL("../src/lib/productDecisionLiveResumePolicy.ts", import.meta.url),
);

const NOW = Date.parse("2026-10-26T22:55:33.000Z");

test("concurrent progress a few seconds after the caller clock keeps the active request", () => {
  assert.equal(
    shouldReuseProductDecisionLiveStatus(
      {
        state: "RUNNING",
        lastActivityAt: "2026-10-26T22:55:35.000Z",
        analysisAsOf: "2026-10-26T22:45:12.000Z",
      },
      { nowMs: NOW, completedMaxAgeMs: 60 * 60 * 1000 },
    ),
    true,
  );
});

test("stale active, materially future, failed and idle requests are not reused", () => {
  const base = { nowMs: NOW, completedMaxAgeMs: 60 * 60 * 1000 };
  assert.equal(
    shouldReuseProductDecisionLiveStatus(
      {
        state: "RUNNING",
        lastActivityAt: new Date(
          NOW - PRODUCT_DECISION_ACTIVE_RESUME_MAX_AGE_MS - 1,
        ).toISOString(),
      },
      base,
    ),
    false,
  );
  assert.equal(
    shouldReuseProductDecisionLiveStatus(
      {
        state: "RUNNING",
        lastActivityAt: new Date(NOW + 5 * 60 * 1000 + 1).toISOString(),
      },
      base,
    ),
    false,
  );
  assert.equal(
    shouldReuseProductDecisionLiveStatus(
      { state: "FAILED", lastActivityAt: new Date(NOW).toISOString() },
      base,
    ),
    false,
  );
  assert.equal(
    shouldReuseProductDecisionLiveStatus(
      { state: "IDLE", lastActivityAt: null },
      base,
    ),
    false,
  );
});

test("completed requests only reuse the caller freshness window", () => {
  const status = {
    state: "COMPLETED",
    lastActivityAt: new Date(NOW - 10 * 60 * 1000).toISOString(),
  };
  assert.equal(
    shouldReuseProductDecisionLiveStatus(status, {
      nowMs: NOW,
      completedMaxAgeMs: 60 * 60 * 1000,
    }),
    true,
  );
  assert.equal(
    shouldReuseProductDecisionLiveStatus(status, {
      nowMs: NOW,
      completedMaxAgeMs: 5 * 60 * 1000,
    }),
    false,
  );
});
