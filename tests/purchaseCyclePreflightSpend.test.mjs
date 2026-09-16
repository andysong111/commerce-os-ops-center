import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { purchaseCycleSpendMonthFilter, verifiedPurchaseCycleSpend } from "../src/lib/purchaseCyclePreflightSpendCore.ts";
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
  assert.match(loader, /count: "exact"/); assert.match(loader, /\.or\(filter\)/);
  assert.match(loader, /verifiedPurchaseCycleSpend\(cycleMonth, result\.data, result\.count,/);
  assert.match(service, /monthlySpend: loadVerifiedPurchaseCycleSpend/);
  assert.doesNotMatch(service, /loadInternalChinaMonthlyPurchaseSummary|summary\?\./);
  assert.doesNotMatch(loader, /\.insert\(|\.upsert\(|\.update\(|\.delete\(|\.rpc\(/);
});
