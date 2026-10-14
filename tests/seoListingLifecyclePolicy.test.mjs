import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateSeoMarketCapacity,
  calculateSeoPortfolioCapacity,
  evaluateSeoListingLifecycle,
} from "../src/lib/seoListingLifecyclePolicy.ts";

const NOW = new Date("2026-10-15T00:00:00.000Z");

function live(overrides = {}) {
  return {
    state: "LIVE",
    attemptCount: 1,
    liveStartedAt: "2026-08-16T00:00:00.000Z",
    lastVerifiedLiveAt: "2026-10-15T00:00:00.000Z",
    salesCountDuringAttempt: 0,
    exposureVerified: true,
    ...overrides,
  };
}

function market(overrides = {}) {
  return {
    marketAccountKey: "smartstore-primary",
    marketName: "스마트스토어",
    maximumListingCount: 10_000,
    activeListingCount: 8_000,
    inFlightCount: 100,
    safetyBuffer: 200,
    observationStatus: "verified",
    observedAt: "2026-10-15T00:00:00.000Z",
    requiredForAutoBatch: true,
    ...overrides,
  };
}

test("new READY product is planned for its first registration", () => {
  const decision = evaluateSeoListingLifecycle(
    { state: "READY", attemptCount: 0 },
    NOW,
  );
  assert.equal(decision.state, "READY");
  assert.equal(decision.action, "REGISTER");
  assert.equal(decision.attemptCount, 0);
});

test("a sale protects the listing at any attempt", () => {
  const decision = evaluateSeoListingLifecycle(
    live({ attemptCount: 2, salesCountDuringAttempt: 1 }),
    NOW,
  );
  assert.equal(decision.state, "PROTECTED");
  assert.equal(decision.action, "KEEP");
  assert.equal(decision.requiresReview, false);
});

test("59 verified exposure days remain LIVE", () => {
  const decision = evaluateSeoListingLifecycle(
    live({
      liveStartedAt: "2026-08-17T00:00:00.000Z",
      lastVerifiedLiveAt: "2026-10-15T00:00:00.000Z",
    }),
    NOW,
  );
  assert.equal(decision.exposureDays, 59);
  assert.equal(decision.state, "LIVE");
  assert.equal(decision.action, "NONE");
});

test("exactly 60 verified unsold exposure days start a 90 day cooldown", () => {
  const decision = evaluateSeoListingLifecycle(live(), NOW);
  assert.equal(decision.exposureDays, 60);
  assert.equal(decision.state, "COOLDOWN");
  assert.equal(decision.action, "SOLD_OUT_AND_DELETE");
  assert.equal(decision.nextEligibleAt, "2027-01-13T00:00:00.000Z");
});

test("calendar time without verified LIVE readback does not consume exposure", () => {
  const decision = evaluateSeoListingLifecycle(
    live({ lastVerifiedLiveAt: "2026-10-13T00:00:00.000Z" }),
    NOW,
  );
  assert.equal(decision.exposureDays, 58);
  assert.equal(decision.state, "LIVE");
  assert.equal(decision.action, "NONE");
});

test("third verified unsold window becomes a retire candidate", () => {
  const decision = evaluateSeoListingLifecycle(live({ attemptCount: 3 }), NOW);
  assert.equal(decision.state, "RETIRE_CANDIDATE");
  assert.equal(decision.action, "SOLD_OUT_AND_DELETE");
  assert.equal(decision.reasonCode, "THIRD_UNSOLD_WINDOW_COMPLETE");
});

test("cooldown stays closed immediately before the 90 day boundary", () => {
  const decision = evaluateSeoListingLifecycle(
    {
      state: "COOLDOWN",
      attemptCount: 1,
      nextEligibleAt: "2026-10-15T00:00:00.001Z",
    },
    NOW,
  );
  assert.equal(decision.state, "COOLDOWN");
  assert.equal(decision.action, "NONE");
});

test("cooldown becomes RELIST-ready exactly at its boundary", () => {
  const decision = evaluateSeoListingLifecycle(
    {
      state: "COOLDOWN",
      attemptCount: 1,
      nextEligibleAt: "2026-10-15T00:00:00.000Z",
    },
    NOW,
  );
  assert.equal(decision.state, "READY");
  assert.equal(decision.action, "RELIST");
});

test("technical failure is reviewable and does not increase attempt count", () => {
  const decision = evaluateSeoListingLifecycle(
    live({ attemptCount: 2, technicalFailure: true }),
    NOW,
  );
  assert.equal(decision.state, "EXCEPTION");
  assert.equal(decision.action, "REVIEW");
  assert.equal(decision.attemptCount, 2);
  assert.equal(decision.reasonCode, "TECHNICAL_FAILURE_ATTEMPT_NOT_CONSUMED");
});

test("LIVE record without exposure readback fails closed", () => {
  const decision = evaluateSeoListingLifecycle(
    live({ exposureVerified: false }),
    NOW,
  );
  assert.equal(decision.state, "EXCEPTION");
  assert.equal(decision.action, "REVIEW");
  assert.equal(decision.reasonCode, "LIVE_EXPOSURE_NOT_VERIFIED");
});

test("LIVE and COOLDOWN states cannot exist before a verified attempt", () => {
  for (const state of ["LIVE", "COOLDOWN", "PROTECTED"]) {
    const decision = evaluateSeoListingLifecycle(
      { ...live(), state, attemptCount: 0 },
      NOW,
    );
    assert.equal(decision.state, "EXCEPTION");
    assert.equal(decision.reasonCode, "VERIFIED_ATTEMPT_REQUIRED_FOR_STATE");
  }
});

test("retire candidate requires all three verified attempts", () => {
  const decision = evaluateSeoListingLifecycle(
    { state: "RETIRE_CANDIDATE", attemptCount: 2 },
    NOW,
  );
  assert.equal(decision.state, "EXCEPTION");
  assert.equal(decision.reasonCode, "RETIRE_CANDIDATE_ATTEMPTS_INCOMPLETE");
});

test("future-dated LIVE evidence fails closed instead of accruing time", () => {
  const decision = evaluateSeoListingLifecycle(
    live({
      liveStartedAt: "2026-10-15T00:06:00.000Z",
      lastVerifiedLiveAt: "2026-10-15T00:06:00.000Z",
    }),
    NOW,
  );
  assert.equal(decision.state, "EXCEPTION");
  assert.equal(decision.reasonCode, "LIVE_EXPOSURE_NOT_VERIFIED");
});

test("verified market capacity subtracts active, in-flight and safety buffer", () => {
  const capacity = calculateSeoMarketCapacity(market(), NOW);
  assert.equal(capacity.blocked, false);
  assert.equal(capacity.availableListingCount, 1_700);
});

test("capacity readback is accepted at exactly the 24 hour freshness boundary", () => {
  const capacity = calculateSeoMarketCapacity(
    market({ observedAt: "2026-10-14T00:00:00.000Z" }),
    NOW,
  );
  assert.equal(capacity.stale, false);
  assert.equal(capacity.blocked, false);
});

test("capacity readback older than 24 hours blocks automatic selection", () => {
  const capacity = calculateSeoMarketCapacity(
    market({ observedAt: "2026-10-13T23:59:59.999Z" }),
    NOW,
  );
  assert.equal(capacity.stale, true);
  assert.equal(capacity.blocked, true);
  assert.equal(capacity.availableListingCount, 0);
  assert.equal(capacity.reasonCode, "CAPACITY_STALE");
});

test("portfolio capacity uses the required-market bottleneck instead of adding slots", () => {
  const portfolio = calculateSeoPortfolioCapacity(
    [
      market({ marketAccountKey: "a", maximumListingCount: 100, activeListingCount: 80, inFlightCount: 0, safetyBuffer: 0 }),
      market({ marketAccountKey: "b", maximumListingCount: 100, activeListingCount: 93, inFlightCount: 0, safetyBuffer: 2 }),
    ],
    NOW,
  );
  assert.equal(portfolio.blocked, false);
  assert.equal(portfolio.safeBatchCount, 5);
});

test("one stale required market blocks the full multi-market batch", () => {
  const portfolio = calculateSeoPortfolioCapacity(
    [
      market({ marketAccountKey: "fresh" }),
      market({ marketAccountKey: "stale", observedAt: "2026-10-13T00:00:00.000Z" }),
    ],
    NOW,
  );
  assert.equal(portfolio.blocked, true);
  assert.equal(portfolio.safeBatchCount, 0);
  assert.deepEqual(portfolio.reasonCodes, ["CAPACITY_STALE"]);
});

test("a stale optional market does not block required accounts", () => {
  const portfolio = calculateSeoPortfolioCapacity(
    [
      market({ marketAccountKey: "required", maximumListingCount: 100, activeListingCount: 90, inFlightCount: 0, safetyBuffer: 0 }),
      market({ marketAccountKey: "optional", requiredForAutoBatch: false, observedAt: null }),
    ],
    NOW,
  );
  assert.equal(portfolio.blocked, false);
  assert.equal(portfolio.safeBatchCount, 10);
});

test("missing required market observations fail closed", () => {
  const portfolio = calculateSeoPortfolioCapacity([], NOW);
  assert.equal(portfolio.blocked, true);
  assert.equal(portfolio.safeBatchCount, 0);
  assert.deepEqual(portfolio.reasonCodes, ["REQUIRED_MARKET_CAPACITY_MISSING"]);
});
