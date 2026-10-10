import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { combineCompletePurchaseCycleSpendScanPages, purchaseCycleSpendMonthFilter, verifiedPurchaseCycleSpend, verifiedPurchaseCycleSpendPages } from "../src/lib/purchaseCyclePreflightSpendCore.ts";
const month = "2026-10";
const time = "2026-10-01T01:00:00Z";
const row = (id = "d1", amount = 30000) => ({ source_event_id: id, result_snapshot: { cycleMonth: month, draftId: id, actualOrderPaidKrwAtInternalFx: amount } });
const build = (rows, count = rows.length) => verifiedPurchaseCycleSpend(month, rows, count, time);

test("explicit complete empty target-month read proves zero, unlike a missing recent summary", () => {
  assert.equal(build([], 0).recordedSpendKrw, 0);
  assert.throws(() => build([], 1), /SCAN_INCOMPLETE/);
});
for (const count of [null, undefined, 121, -1, NaN]) {
  test(`bounded/unknown scan cannot prove zero spend: ${String(count)}`, () => {
    assert.throws(() => verifiedPurchaseCycleSpend(month, [], count, time), /SCAN_INCOMPLETE/);
  });
}
test("all target-month drafts beyond the old global 120-row cutoff are counted", () => {
  const rows = Array.from({ length: 121 }, (_, i) => row(`d${i}`, 100));
  assert.equal(build(rows).recordedSpendKrw, 12100);
  assert.throws(() => build(rows.slice(0, 120), 121), /SCAN_INCOMPLETE/);
});
test("a server row limit never turns partial spend into full month funding", () => {
  assert.throws(() => build(Array.from({ length: 1000 }, (_, i) => row(`d${i}`, 1)), 1001), /SCAN_INCOMPLETE/);
});
for (const snapshot of [value => ({ result_snapshot: value }), value => ({ result_snapshot: { snapshot: value } }), value => ({ input_snapshot: value })]) {
  test("known historical storage shape has the same authoritative paid amount", () => {
    assert.equal(build([snapshot(row().result_snapshot)]).recordedSpendKrw, 30000);
  });
}
test("latest draft snapshot wins and the same draft is not counted twice", () => {
  assert.equal(build([row("d1", 50000), row("d1", 10000)]).recordedSpendKrw, 50000);
});
test("nested/current snapshot supersedes stale input that happened to match the query", () => {
  const value = row(); value.input_snapshot = { ...value.result_snapshot };
  value.result_snapshot = { snapshot: { cycleMonth: "2026-11", draftId: "d1", actualOrderPaidKrwAtInternalFx: 45000 } };
  assert.equal(build([value]).recordedSpendKrw, 0);
});
for (const amount of [undefined, "30000", -1, 0.5, Infinity]) {
  test(`missing/invalid recorded amount is never estimated: ${String(amount)}`, () => {
    const value = row(); value.result_snapshot.actualOrderPaidKrwAtInternalFx = amount;
    assert.throws(() => build([value]), /AMOUNT_UNVERIFIED/);
  });
}
test("explicit stored zero is valid only with a complete read", () => assert.equal(build([row("d1", 0)]).recordedSpendKrw, 0));
test("an explicitly unexecuted Draft contributes zero spend", () => {
  const value = row();
  delete value.result_snapshot.actualOrderPaidKrwAtInternalFx;
  value.result_snapshot.status = "DRAFT";
  value.result_snapshot.externalOrderExecuted = false;
  assert.equal(build([value]).recordedSpendKrw, 0);
});
test("missing paid amount still blocks ordered or ambiguously executed rows", () => {
  for (const snapshot of [
    { status: "ORDERED", externalOrderExecuted: false },
    { status: "DRAFT", externalOrderExecuted: true },
    { status: "DRAFT" },
  ]) {
    const value = row();
    value.result_snapshot = { cycleMonth: month, draftId: "d1", ...snapshot };
    assert.throws(() => build([value]), /AMOUNT_UNVERIFIED/);
  }
});
test("legacy rows without a cycle month are ignored only when both timestamps are outside the target month", () => {
  const legacy = { id: "legacy", source_event_id: "legacy-draft", started_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-02T00:00:00Z", result_snapshot: { snapshot: { draftId: "legacy-draft", status: "ORDERED", externalOrderExecuted: false } } };
  assert.equal(build([legacy]).recordedSpendKrw, 0);
  assert.throws(() => build([{ ...legacy, updated_at: "2026-10-01T00:00:00Z" }]), /ROW_MONTH_UNVERIFIED/);
});
test("overflow in sum fails closed", () => assert.throws(() => build([row("d1", Number.MAX_SAFE_INTEGER), row("d2", 1)]), /OVERFLOW/));
test("missing identity or malformed month fails closed", () => {
  const value = row(); delete value.source_event_id; delete value.result_snapshot.draftId;
  assert.throws(() => build([value]), /DRAFT_ID_MISSING/);
  assert.throws(() => build([{ result_snapshot: {} }]), /ROW_MONTH_UNVERIFIED/);
});
test("amount changes invalidate source fingerprint; read clock alone does not", () => {
  const first = build([row()]);
  assert.notEqual(first.contentFingerprint, build([row("d1", 30001)]).contentFingerprint);
  assert.equal(first.contentFingerprint, verifiedPurchaseCycleSpend(month, [row()], 1, "2026-10-01T01:01:00Z").contentFingerprint);
});
test("only validated month is placed in all three PostgREST target filters", () => {
  assert.deepEqual(purchaseCycleSpendMonthFilter(month).split(","), [
    "result_snapshot->snapshot->>cycleMonth.eq.2026-10", "result_snapshot->>cycleMonth.eq.2026-10", "input_snapshot->>cycleMonth.eq.2026-10",
  ]);
  for (const value of ["2026-13", "2026-10,other.eq.x", ""]) assert.throws(() => purchaseCycleSpendMonthFilter(value), /MONTH_INVALID/);
});
test("production adapter uses scoped exact-count read and never the global recent-summary null fallback", () => {
  const loader = readFileSync(new URL("../src/lib/purchaseCyclePreflightSpend.ts", import.meta.url), "utf8");
  const service = readFileSync(new URL("../src/lib/purchaseCyclePreflight.ts", import.meta.url), "utf8");
  assert.match(loader, /count: "exact"/); assert.match(loader, /\.range\(from, from \+ PAGE_SIZE - 1\)/);
  assert.match(loader, /combineCompletePurchaseCycleSpendScanPages\(pages, MAXIMUM_ROWS\)/);
  assert.doesNotMatch(loader, /\.eq\([^\n]*cycleMonth\)/);
  assert.doesNotMatch(loader, /\.or\(/);
  assert.match(service, /monthlySpend: \(cycleMonth\) => bounded\(/);
  assert.match(service, /loadVerifiedPurchaseCycleSpend\(cycleMonth\)/);
  assert.doesNotMatch(service, /loadInternalChinaMonthlyPurchaseSummary|summary\?\./);
  assert.doesNotMatch(loader, /\.insert\(|\.upsert\(|\.update\(|\.delete\(|\.rpc\(/);
});

test("complete paged scan accepts a stable exact count", () => {
  const values = [stored("r1"), stored("r2", "draft2")];
  assert.deepEqual(combineCompletePurchaseCycleSpendScanPages([
    { rows: values.slice(0, 1), matchedCount: 2 },
    { rows: values.slice(1), matchedCount: 2 },
  ]), values);
});
test("paged scan fails closed when count changes, rows overlap, or the scan is short", () => {
  assert.throws(() => combineCompletePurchaseCycleSpendScanPages([
    { rows: [stored("r1")], matchedCount: 2 },
    { rows: [stored("r2")], matchedCount: 3 },
  ]), /CHANGED_DURING_READ/);
  assert.throws(() => combineCompletePurchaseCycleSpendScanPages([
    { rows: [stored("r1")], matchedCount: 2 },
    { rows: [stored("r1")], matchedCount: 2 },
  ]), /CHANGED_DURING_READ/);
  assert.throws(() => combineCompletePurchaseCycleSpendScanPages([
    { rows: [stored("r1")], matchedCount: 2 },
  ]), /SCAN_INCOMPLETE/);
});
test("paged scan has a hard safety ceiling", () => {
  assert.throws(() => combineCompletePurchaseCycleSpendScanPages([
    { rows: [], matchedCount: 21 },
  ], 20), /SCAN_INCOMPLETE/);
});

const stored = (id = "row1", draft = "draft1", paid = 20000, date = time) => ({ ...row(draft, paid), id, started_at: date });
const page = (rows = []) => ({ rows, matchedCount: rows.length });
const pages = (values) => verifiedPurchaseCycleSpendPages(month, values, time);
test("three complete shape queries prove a zero-spend month", () => assert.equal(pages([page(), page(), page()]).recordedSpendKrw, 0));
test("overlapping shape results count each record only once", () => {
  const value = stored();
  assert.equal(pages([page([value]), page([value]), page([value])]).recordedSpendKrw, 20000);
});
test("different snapshots of one record across shape reads block", () => {
  assert.throws(() => pages([page([stored()]), page([stored("row1", "draft1", 21000)]), page()]), /CHANGED_DURING_READ/);
});
test("all shape queries must prove completeness individually", () => {
  assert.throws(() => pages([page(), page()]), /SHAPE_MISSING/);
  assert.throws(() => pages([page(), { rows: [], matchedCount: 1 }, page()]), /SCAN_INCOMPLETE/);
});
test("missing record identity or sort timestamp blocks", () => {
  assert.throws(() => pages([page([row()]), page(), page()]), /ROW_IDENTITY_UNVERIFIED/);
});
test("query merge preserves latest-per-draft order without mutating inputs", () => {
  const input = [page([stored("r1", "d1", 10000, "2026-09-30T23:00:00Z")]), page([stored("r2", "d1", 22000)]), page()];
  const previous = structuredClone(input);
  assert.equal(pages(input).recordedSpendKrw, 22000);
  assert.deepEqual(input, previous);
  assert.equal(pages([input[1], input[2], input[0]]).contentFingerprint, pages(input).contentFingerprint);
});
