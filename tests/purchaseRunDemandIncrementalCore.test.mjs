import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPurchaseRunDemandCollectionPlan,
  demandMappingIdentitiesCompatible,
  latestPriorPurchaseRunStartDate,
} from "../src/lib/purchaseRunDemandIncrementalCore.ts";

test("new purchase run reads only orders since the prior run and refreshes 31 claim days", () => {
  const plan = buildPurchaseRunDemandCollectionPlan({
    targetDate: "2026-11-04",
    previousPurchaseRunStartDate: "2026-11-01",
    reusableLedgerAvailable: true,
  });

  assert.equal(plan.mode, "INCREMENTAL");
  assert.deepEqual(plan.orderRanges, [
    { start: "2026-11-01", end: "2026-11-04" },
  ]);
  assert.deepEqual(plan.claimRanges, [
    { start: "2026-10-05", end: "2026-11-04" },
  ]);
});

test("prior purchase run date is the newest distinct run before the new start date", () => {
  assert.equal(
    latestPriorPurchaseRunStartDate([
      { cycleStartDate: "2026-10-31" },
      { cycleStartDate: "2026-11-01" },
      { cycleStartDate: "2026-11-01" },
      { cycleStartDate: "2026-11-04" },
    ], "2026-11-04"),
    "2026-11-01",
  );
});

test("missing exact ledger fails over to a one-time bounded baseline", () => {
  const plan = buildPurchaseRunDemandCollectionPlan({
    targetDate: "2026-11-04",
    previousPurchaseRunStartDate: "2026-11-01",
    reusableLedgerAvailable: false,
  });

  assert.equal(plan.mode, "FULL_BASELINE");
  assert.equal(plan.orderRanges[0].start, "2025-11-09");
  assert.equal(plan.orderRanges.at(-1).end, "2026-11-04");
  assert.equal(plan.claimRanges[0].start, "2025-11-09");
  assert.equal(plan.claimRanges.at(-1).end, "2026-11-04");
});

test("ledger reuse rejects a changed mapping for an existing Shopling identity", () => {
  const previous = [
    { key: "option:10", barcode: "BAA1-1", unitsPerOrder: 1 },
  ];
  assert.equal(
    demandMappingIdentitiesCompatible(previous, [
      ...previous,
      { key: "option:20", barcode: "BAA1-2", unitsPerOrder: 1 },
    ]),
    true,
  );
  assert.equal(
    demandMappingIdentitiesCompatible(previous, [
      { key: "option:10", barcode: "BAA1-2", unitsPerOrder: 1 },
    ]),
    false,
  );
  assert.equal(
    demandMappingIdentitiesCompatible(previous, [
      { key: "option:10", barcode: "BAA1-1", unitsPerOrder: 2 },
    ]),
    false,
  );
});
