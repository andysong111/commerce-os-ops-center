import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMonthlySalesEventReusePlan,
  trimReusedSalesEventChunk,
} from "../src/lib/monthlySalesEventRefreshCore.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

function dateOnly(value) {
  return value.toISOString().slice(0, 10);
}

function ranges(start, end, days = 7) {
  const output = [];
  const endMs = Date.parse(`${end}T00:00:00.000Z`);
  for (
    let cursor = Date.parse(`${start}T00:00:00.000Z`);
    cursor <= endMs;
    cursor += days * DAY_MS
  ) {
    output.push({
      start: dateOnly(new Date(cursor)),
      end: dateOnly(new Date(Math.min(endMs, cursor + (days - 1) * DAY_MS))),
    });
  }
  return output;
}

function coveredDates(inputRanges) {
  const output = [];
  for (const range of inputRanges) {
    const endMs = Date.parse(`${range.end}T00:00:00.000Z`);
    for (
      let cursor = Date.parse(`${range.start}T00:00:00.000Z`);
      cursor <= endMs;
      cursor += DAY_MS
    ) {
      output.push(dateOnly(new Date(cursor)));
    }
  }
  return output;
}

test("monthly refresh reuses stable 360-day ranges and rereads only the recent correction window", () => {
  const plan = buildMonthlySalesEventReusePlan({
    analysisStartDate: "2025-11-06",
    analysisEndDate: "2026-11-01",
    parentRanges: ranges("2025-10-17", "2026-10-12"),
    correctionDays: 45,
    chunkDays: 7,
  });

  assert.equal(plan.correctionStartDate, "2026-09-18");
  assert.ok(plan.reusableRangeKeys.length >= 40);
  assert.ok(plan.sourceReadRangeCount <= 8);
  assert.ok(plan.sourceReadRangeCount > 0);
  assert.equal(plan.ranges[0].start, "2025-11-06");
  assert.equal(plan.ranges.at(-1).end, "2026-11-01");
  const expectedDates = coveredDates([
    { start: "2025-11-06", end: "2026-11-01" },
  ]);
  assert.deepEqual(coveredDates(plan.ranges), expectedDates);
});

test("mapping drift or missing parent evidence can safely fall back to an ordinary full range plan", () => {
  const plan = buildMonthlySalesEventReusePlan({
    analysisStartDate: "2025-11-06",
    analysisEndDate: "2026-11-01",
    parentRanges: [],
    correctionDays: 45,
    chunkDays: 7,
  });
  assert.equal(plan.reusableRangeKeys.length, 0);
  assert.equal(plan.sourceReadRangeCount, 52);
  assert.equal(plan.ranges.length, 52);
});

test("reused chunks are trimmed to the new exact 360-day analysis window", () => {
  const chunk = {
    range: { start: "2025-11-01", end: "2025-11-07" },
    fetchedRows: 3,
    eventRows: 3,
    validRows: 2,
    tombstoneRows: 1,
    ignoredRows: 0,
    unmappedRows: 0,
    duplicateRows: 0,
    totalBaseUnits: 5,
    totalRevenue: 500,
    events: [
      { externalId: "old", barcode: "BAA1-1", occurredAt: "2025-11-05T23:59:59.000Z", quantity: 2, revenue: 200, validSale: true, syncedAt: "2026-10-01T00:00:00.000Z" },
      { externalId: "kept", barcode: "BAA1-1", occurredAt: "2025-11-06T12:00:00.000Z", quantity: 3, revenue: 300, validSale: true, syncedAt: "2026-10-01T00:00:00.000Z" },
      { externalId: "void", barcode: "BAA1-1", occurredAt: "2025-11-07T12:00:00.000Z", quantity: 1, revenue: 100, validSale: false, syncedAt: "2026-10-01T00:00:00.000Z" },
    ],
    unmappedSamples: [],
  };
  const trimmed = trimReusedSalesEventChunk(
    chunk,
    "2026-11-01T00:00:00.000Z",
  );
  assert.deepEqual(trimmed.events.map((row) => row.externalId), ["kept", "void"]);
  assert.equal(trimmed.eventRows, 2);
  assert.equal(trimmed.validRows, 1);
  assert.equal(trimmed.tombstoneRows, 1);
  assert.equal(trimmed.totalBaseUnits, 3);
  assert.equal(trimmed.totalRevenue, 300);
  assert.equal(trimmed.ignoredRows, 1);
});
