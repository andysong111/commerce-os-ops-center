import assert from "node:assert/strict";
import test from "node:test";

import {
  prepareSeoMarketCapacitySnapshot,
  SEO_MARKET_CAPACITY_ACCOUNTS,
  SEO_MARKET_CAPACITY_READBACK_SOURCE,
  verifySeoMarketCapacitySnapshotReadback,
} from "../src/lib/seoMarketCapacityReadback.ts";

const NOW = new Date("2026-10-15T00:00:00.000Z");
const SNAPSHOT_ID = "1b069f8d-f9f8-4ddb-b2e8-fc0c59e1be20";

function observation(account, overrides = {}) {
  return {
    marketAccountKey: account.marketAccountKey,
    status: "verified",
    maximumListingCount: 10_000,
    activeListingCount: 8_000,
    inFlightCount: 10,
    ...overrides,
  };
}

function payload(overrides = {}) {
  return {
    snapshotId: SNAPSHOT_ID,
    observedAt: NOW.toISOString(),
    source: SEO_MARKET_CAPACITY_READBACK_SOURCE,
    observations: SEO_MARKET_CAPACITY_ACCOUNTS.map((account) =>
      observation(account),
    ),
    ...overrides,
  };
}

function storedRows(snapshot) {
  return snapshot.rows.map((row) => ({
    snapshot_id: snapshot.snapshotId,
    market_account_key: row.market_account_key,
    market_code: row.market_code,
    market_name: row.market_name,
    account_label: row.account_label,
    maximum_listing_count: row.maximum_listing_count,
    active_listing_count: row.active_listing_count,
    in_flight_count: row.in_flight_count,
    observation_status: row.observation_status,
    observed_at: snapshot.observedAt,
    source: snapshot.source,
  }));
}

function rejectsCode(callback, code) {
  assert.throws(callback, (error) => error?.code === code);
}

test("the Commerce OS registry resolves to 29 unique market accounts", () => {
  assert.equal(SEO_MARKET_CAPACITY_ACCOUNTS.length, 29);
  assert.equal(
    new Set(
      SEO_MARKET_CAPACITY_ACCOUNTS.map((account) => account.marketAccountKey),
    ).size,
    29,
  );
});

test("a full verified snapshot prepares all 29 rows", () => {
  const snapshot = prepareSeoMarketCapacitySnapshot(payload(), NOW);
  assert.equal(snapshot.rows.length, 29);
  assert.equal(snapshot.suppliedCount, 29);
  assert.equal(snapshot.missingCount, 0);
  assert.ok(snapshot.rows.every((row) => row.observation_status === "verified"));
});

test("a partial collector result fills every missing account as unknown", () => {
  const supplied = SEO_MARKET_CAPACITY_ACCOUNTS.slice(0, 2).map((account) =>
    observation(account),
  );
  const snapshot = prepareSeoMarketCapacitySnapshot(
    payload({ observations: supplied }),
    NOW,
  );
  assert.equal(snapshot.rows.length, 29);
  assert.equal(snapshot.suppliedCount, 2);
  assert.equal(snapshot.missingCount, 27);
  assert.equal(
    snapshot.rows.filter((row) => row.observation_status === "unknown").length,
    27,
  );
});

test("unknown and duplicate account identities are rejected", () => {
  rejectsCode(
    () =>
      prepareSeoMarketCapacitySnapshot(
        payload({
          observations: [
            {
              ...observation(SEO_MARKET_CAPACITY_ACCOUNTS[0]),
              marketAccountKey: "UNKNOWN:account",
            },
          ],
        }),
        NOW,
      ),
    "CAPACITY_READBACK_ACCOUNT_UNKNOWN",
  );
  rejectsCode(
    () =>
      prepareSeoMarketCapacitySnapshot(
        payload({
          observations: [
            observation(SEO_MARKET_CAPACITY_ACCOUNTS[0]),
            observation(SEO_MARKET_CAPACITY_ACCOUNTS[0]),
          ],
        }),
        NOW,
      ),
    "CAPACITY_READBACK_ACCOUNT_DUPLICATED",
  );
});

test("verified rows require real counts and valid in-flight values", () => {
  rejectsCode(
    () =>
      prepareSeoMarketCapacitySnapshot(
        payload({
          observations: [
            observation(SEO_MARKET_CAPACITY_ACCOUNTS[0], {
              maximumListingCount: null,
            }),
          ],
        }),
        NOW,
      ),
    "CAPACITY_READBACK_VERIFIED_COUNTS_REQUIRED",
  );
  rejectsCode(
    () =>
      prepareSeoMarketCapacitySnapshot(
        payload({
          observations: [
            observation(SEO_MARKET_CAPACITY_ACCOUNTS[0], {
              inFlightCount: -1,
            }),
          ],
        }),
        NOW,
      ),
    "CAPACITY_READBACK_IN_FLIGHT_INVALID",
  );
});

test("invalid observation statuses are rejected instead of coerced", () => {
  rejectsCode(
    () =>
      prepareSeoMarketCapacitySnapshot(
        payload({
          observations: [
            observation(SEO_MARKET_CAPACITY_ACCOUNTS[0], { status: "fresh" }),
          ],
        }),
        NOW,
      ),
    "CAPACITY_READBACK_STATUS_INVALID",
  );
});

test("snapshot freshness accepts the exact 24 hour and five minute boundaries", () => {
  const oldest = prepareSeoMarketCapacitySnapshot(
    payload({ observedAt: "2026-10-14T00:00:00.000Z" }),
    NOW,
  );
  const newest = prepareSeoMarketCapacitySnapshot(
    payload({ observedAt: "2026-10-15T00:05:00.000Z" }),
    NOW,
  );
  assert.equal(oldest.observedAt, "2026-10-14T00:00:00.000Z");
  assert.equal(newest.observedAt, "2026-10-15T00:05:00.000Z");
});

test("stale and materially future snapshots are rejected", () => {
  rejectsCode(
    () =>
      prepareSeoMarketCapacitySnapshot(
        payload({ observedAt: "2026-10-13T23:59:59.999Z" }),
        NOW,
      ),
    "CAPACITY_READBACK_STALE",
  );
  rejectsCode(
    () =>
      prepareSeoMarketCapacitySnapshot(
        payload({ observedAt: "2026-10-15T00:05:00.001Z" }),
        NOW,
      ),
    "CAPACITY_READBACK_TIME_IN_FUTURE",
  );
});

test("an active count over the maximum is preserved as blocking evidence", () => {
  const snapshot = prepareSeoMarketCapacitySnapshot(
    payload({
      observations: [
        observation(SEO_MARKET_CAPACITY_ACCOUNTS[0], {
          maximumListingCount: 100,
          activeListingCount: 101,
        }),
      ],
    }),
    NOW,
  );
  assert.equal(snapshot.rows[0].maximum_listing_count, 100);
  assert.equal(snapshot.rows[0].active_listing_count, 101);
});

test("exact readback verifies identity, values and snapshot time", () => {
  const snapshot = prepareSeoMarketCapacitySnapshot(payload(), NOW);
  const rows = storedRows(snapshot);
  assert.deepEqual(verifySeoMarketCapacitySnapshotReadback(snapshot, rows), {
    ok: true,
    matchedCount: 29,
    reasonCode: "CAPACITY_READBACK_VERIFIED",
  });

  rows[0] = { ...rows[0], active_listing_count: 8_001 };
  const mismatch = verifySeoMarketCapacitySnapshotReadback(snapshot, rows);
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.reasonCode, "CAPACITY_READBACK_VALUE_MISMATCH");
});
