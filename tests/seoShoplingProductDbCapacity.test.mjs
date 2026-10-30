import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateSeoShoplingProductDbCapacity,
  prepareSeoShoplingProductDbSnapshot,
  verifySeoShoplingProductDbSnapshotReadback,
} from "../src/lib/seoShoplingProductDbCapacity.ts";

const NOW = new Date("2026-10-30T02:00:00.000Z");

test("current Shopling 11,113 / 10,000 usage blocks every new product code", () => {
  const result = calculateSeoShoplingProductDbCapacity(
    {
      maximum_product_code_count: 10_000,
      used_product_code_count: 11_113,
      observation_status: "verified",
      observed_at: "2026-10-30T01:30:00.000Z",
    },
    NOW,
  );
  assert.equal(result.blocked, true);
  assert.equal(result.safeNewProductCount, 0);
  assert.equal(result.overLimitProductCodeCount, 1_113);
  assert.equal(result.reasonCode, "SHOPLING_PRODUCT_DB_AT_OR_OVER_LIMIT");
});

test("missing or stale Shopling quota evidence fails closed", () => {
  assert.equal(
    calculateSeoShoplingProductDbCapacity(null, NOW).reasonCode,
    "SHOPLING_PRODUCT_DB_READBACK_UNVERIFIED",
  );
  assert.equal(
    calculateSeoShoplingProductDbCapacity(
      {
        maximum_product_code_count: 10_000,
        used_product_code_count: 9_000,
        observation_status: "verified",
        observed_at: "2026-10-28T01:30:00.000Z",
      },
      NOW,
    ).reasonCode,
    "SHOPLING_PRODUCT_DB_READBACK_STALE",
  );
});

test("safe new product count reserves 12 codes and charges six per product", () => {
  const result = calculateSeoShoplingProductDbCapacity(
    {
      maximum_product_code_count: 10_000,
      used_product_code_count: 9_970,
      observation_status: "verified",
      observed_at: "2026-10-30T01:30:00.000Z",
    },
    NOW,
  );
  assert.equal(result.blocked, false);
  assert.equal(result.availableProductCodeCount, 30);
  assert.equal(result.safeNewProductCount, 3);
});

test("readback preparation rejects stale evidence and reconciles exact snapshot", () => {
  const snapshot = prepareSeoShoplingProductDbSnapshot(
    {
      snapshotId: "5d95e5f5-54be-44cb-b2a1-82b27962975d",
      source: "shopling-plan-dom-v1",
      observedAt: "2026-10-30T01:30:00.000Z",
      maximumProductCodeCount: 10_000,
      usedProductCodeCount: 9_970,
      evidence: { pathname: "/prod/prodLst.phtml", pageTitle: "Shopling" },
    },
    NOW,
  );
  assert.equal(
    verifySeoShoplingProductDbSnapshotReadback(snapshot, {
      snapshot_id: snapshot.snapshotId,
      maximum_product_code_count: 10_000,
      used_product_code_count: 9_970,
      observation_status: "verified",
      observed_at: snapshot.observedAt,
      source: snapshot.source,
    }).ok,
    true,
  );
  assert.throws(
    () =>
      prepareSeoShoplingProductDbSnapshot(
        {
          ...snapshot,
          observedAt: "2026-10-28T01:30:00.000Z",
        },
        NOW,
      ),
    /24시간/,
  );
});
