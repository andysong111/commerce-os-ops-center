import assert from "node:assert/strict";
import test from "node:test";
import { loadPurchaseCycleModule as load } from "./helpers/purchaseCycleHarness.mjs";

const china = load("src/lib/chinaOrderLedger.ts", { "@/lib/supabase/admin": {} });
const commitments = load("src/lib/purchaseCycleReentryCommitments.ts", {
  "@/lib/chinaOrderLedger": china,
  "@/lib/supabase/admin": {},
});

const now = Date.parse("2026-09-14T01:00:00.000Z");
const unresolved = "UNASSIGNED-202609-001";

function stored({ id, occurredAt, status, requestedQuantity, orderedQuantity }) {
  return {
    source_event_id: `persisted-${id}`,
    started_at: occurredAt,
    input_snapshot: {
      sourceSystem: "EXTERNAL_ORDER_IMPORT",
      sourceLineId: "private-line",
      sourceEventId: id,
      barcode: unresolved,
      status,
      requestedQuantity,
      orderedQuantity,
      occurredAt,
    },
  };
}

function reconciliation(occurredAt) {
  return {
    source_event_id: `persisted-reconcile-${occurredAt}`,
    started_at: occurredAt,
    input_snapshot: {
      sourceSystem: "EXTERNAL_ORDER_IMPORT",
      sourceLineId: "private-line",
      sourceEventId: `reconcile-${occurredAt}`,
      barcode: "BGF1-3",
      status: "ORDERED",
      requestedQuantity: 200,
      orderedQuantity: 200,
      receivedQuantity: 0,
      cancelledQuantity: 0,
      occurredAt,
      payload: {
        identityReconciliation: {
          confirmed: true,
          confirmationMethod: "OWNER_EXPLICIT_CONFIRMATION",
          fromBarcode: unresolved,
          toBarcode: "BGF1-3",
          modelNo: "AAA309",
          confirmedAt: occurredAt,
        },
      },
    },
  };
}

function baseLifecycle() {
  return [
    stored({
      id: "reserved",
      occurredAt: "2026-09-14T00:00:00.000Z",
      status: "RESERVED",
      requestedQuantity: 200,
      orderedQuantity: undefined,
    }),
    stored({
      id: "ordered",
      occurredAt: "2026-09-14T00:02:00.000Z",
      status: "ORDERED",
      requestedQuantity: undefined,
      orderedQuantity: 200,
    }),
  ];
}

test("identity reconciliation must occur strictly after the existing source-line lifecycle", () => {
  for (const markerTime of ["2026-09-14T00:01:00.000Z", "2026-09-14T00:02:00.000Z"]) {
    assert.throws(
      () => commitments.validateReentryCommitmentRows([
        baseLifecycle()[0],
        reconciliation(markerTime),
        baseLifecycle()[1],
      ], now),
      (error) => error.message === "REENTRY_COMMITMENT_RECONCILIATION_STALE",
      markerTime,
    );
  }
});

test("a later lifecycle-parity reconciliation remains quantity neutral", () => {
  const result = commitments.validateReentryCommitmentRows([
    ...baseLifecycle(),
    reconciliation("2026-09-14T00:03:00.000Z"),
  ], now);
  assert.equal(result.invalidEventCount, 0);
  assert.equal(result.totalCommitments, 1);
  assert.equal(result.totalOpenQuantity, 200);
  assert.equal(result.commitments[0].barcode, "BGF1-3");
  assert.equal(result.commitments[0].orderedQuantity, 200);
});

test("opaque source identities use the ledger's trim-only semantics", () => {
  const base = stored({
    id: "fullwidth-source-line",
    occurredAt: "2026-09-14T00:02:00.000Z",
    status: "ORDERED",
    requestedQuantity: 200,
    orderedQuantity: 200,
  });
  base.input_snapshot.sourceLineId = "Ａ";
  const marker = reconciliation("2026-09-14T00:03:00.000Z");
  marker.input_snapshot.sourceLineId = "A";

  assert.throws(
    () => commitments.validateReentryCommitmentRows([base, marker], now),
    (error) => error.message === "REENTRY_COMMITMENT_RECONCILIATION_SOURCE_MISSING",
  );
});
