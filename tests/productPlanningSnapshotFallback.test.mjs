import assert from "node:assert/strict";
import test from "node:test";

const { selectRecentStoredPlanningSnapshot } = await import(
  new URL("../src/lib/productPlanningSnapshotFallbackCore.ts", import.meta.url)
);

const fingerprint = `sha256:${"a".repeat(64)}`;
const row = ({ generatedAt, createdAt = generatedAt, count = 1, snapshotFingerprint = fingerprint }) => ({
  status: "SUCCEEDED",
  started_at: createdAt,
  input_snapshot: {
    planningGeneratedAt: generatedAt,
    planningContentFingerprint: fingerprint,
    planningProductCount: count,
    createdAt,
    planningSnapshot: {
      generatedAt,
      contentFingerprint: snapshotFingerprint,
      products: Array.from({ length: count }, (_, index) => ({ barcode: `B-${index}` })),
    },
  },
});

test("uses the newest fully verified Product Master snapshot within 72 hours", () => {
  const selected = selectRecentStoredPlanningSnapshot([
    row({ generatedAt: "2026-10-23T02:00:00.000Z" }),
    row({ generatedAt: "2026-10-24T01:00:00.000Z" }),
  ], {
    now: new Date("2026-10-25T00:00:00.000Z"),
    maxAgeMs: 72 * 60 * 60 * 1000,
  });
  assert.equal(selected?.generatedAt, "2026-10-24T01:00:00.000Z");
  assert.equal(selected?.products.length, 1);
});

test("rejects stale, future-dated, incomplete, and fingerprint-mismatched snapshots", () => {
  const now = new Date("2026-10-25T00:00:00.000Z");
  const maxAgeMs = 72 * 60 * 60 * 1000;
  for (const candidate of [
    row({ generatedAt: "2026-10-20T00:00:00.000Z" }),
    row({ generatedAt: "2026-10-25T00:00:01.000Z" }),
    row({ generatedAt: "2026-10-24T00:00:00.000Z", count: 0 }),
    row({ generatedAt: "2026-10-24T00:00:00.000Z", snapshotFingerprint: `sha256:${"b".repeat(64)}` }),
  ]) {
    assert.equal(
      selectRecentStoredPlanningSnapshot([candidate], { now, maxAgeMs }),
      null,
    );
  }
});

test("never uses a snapshot from a failed request row", () => {
  const failed = row({ generatedAt: "2026-10-24T00:00:00.000Z" });
  failed.status = "FAILED";
  assert.equal(
    selectRecentStoredPlanningSnapshot([failed], {
      now: new Date("2026-10-25T00:00:00.000Z"),
      maxAgeMs: 72 * 60 * 60 * 1000,
    }),
    null,
  );
});
