import assert from "node:assert/strict";
import test from "node:test";
import {
  buildShipmentManifest,
  extractTrackingCandidates,
  normalizeTrackingNumber,
  reconcileUnshippedLabels,
} from "../local-agent/src/shopling-unshipped-reconciliation.mjs";

const baseRows = [
  { shoplingOrderNo: "350001", invoiceNo: "5876-2537-5225", bCode: "BAF3-3", quantity: 1 },
  { shoplingOrderNo: "350002", invoiceNo: "5876-2537-5225", bCode: "BAF3-4", quantity: 2 },
  { shoplingOrderNo: "350003", invoiceNo: "587625375226", bCode: "BAC1-1", quantity: 1 },
];

test("tracking numbers normalize only verified CJ 12-digit shapes", () => {
  assert.equal(normalizeTrackingNumber("5876-2537-5225"), "587625375225");
  assert.equal(normalizeTrackingNumber("010-1234-5678"), "");
  assert.deepEqual(extractTrackingCandidates({
    recognizedText: "CJ 5876 2537 5225 order 20260930",
    barcodes: ["587625375226"],
  }), ["587625375226", "587625375225"]);
});
test("shipment manifest groups auto-packaged orders by invoice", () => {
  const manifest = buildShipmentManifest(baseRows);
  assert.equal(manifest.packageCount, 2);
  assert.equal(manifest.orderCount, 3);
  assert.equal(manifest.packages.get("587625375225").orders.length, 2);
  assert.deepEqual(manifest.packages.get("587625375225").bCodes, ["BAF3-3", "BAF3-4"]);
});

test("exact photo match proposes one invoice deletion for a combined package", () => {
  const result = reconcileUnshippedLabels({
    manifestRows: baseRows,
    observations: [{ imageId: "photo-1", recognizedText: "5876-2537-5225" }],
  });
  assert.equal(result.summary.matchedPackages, 1);
  assert.deepEqual(result.proposedActions.invoiceDeletionCandidates[0].shoplingOrderNos, ["350001", "350002"]);
  assert.equal(result.executionGate.readyForReview, true);
  assert.equal(result.executionGate.externalWritesAllowed, false);
});

test("duplicate photos are deduplicated and require review", () => {
  const result = reconcileUnshippedLabels({
    manifestRows: baseRows,
    observations: [
      { imageId: "photo-1", trackingCandidates: ["587625375226"] },
      { imageId: "photo-2", trackingCandidates: ["587625375226"] },
    ],
  });
  assert.equal(result.proposedActions.invoiceDeletionCandidates.length, 1);
  assert.deepEqual(result.proposedActions.invoiceDeletionCandidates[0].sourceImageIds, ["photo-1", "photo-2"]);
  assert.equal(result.executionGate.readyForReview, false);
  assert.equal(result.blockedActions.filter((item) => item.code === "DUPLICATE_LABEL_PHOTO").length, 2);
});

test("missing or unknown tracking evidence blocks the batch", () => {
  const result = reconcileUnshippedLabels({
    manifestRows: baseRows,
    observations: [
      { imageId: "blurred", recognizedText: "unreadable" },
      { imageId: "unknown", recognizedText: "9999-9999-9999" },
    ],
  });
  assert.equal(result.executionGate.readyForReview, false);
  assert.deepEqual(result.imageResults.map((item) => item.status), ["REVIEW_REQUIRED", "REVIEW_REQUIRED"]);
  assert.equal(result.summary.matchedPackages, 0);
});

test("expected photo label count prevents partial photo matches", () => {
  const result = reconcileUnshippedLabels({
    manifestRows: baseRows,
    observations: [{
      imageId: "two-label-photo",
      expectedLabelCount: 2,
      recognizedText: "first label 5876-2537-5225",
    }],
  });
  assert.equal(result.executionGate.readyForReview, false);
  assert.ok(result.blockedActions.some((item) => item.code === "LABEL_COUNT_MISMATCH"));
});

test("single-B-code stockout is proposed but multi-B-code stockout requires an explicit choice", () => {
  const single = reconcileUnshippedLabels({
    manifestRows: baseRows,
    observations: [{
      imageId: "single-stockout",
      trackingCandidates: ["587625375226"],
      reason: "STOCKOUT",
    }],
  });
  assert.deepEqual(single.proposedActions.stockoutCandidates.map((item) => item.bCode), ["BAC1-1"]);
  assert.equal(single.executionGate.readyForReview, true);

  const combined = reconcileUnshippedLabels({
    manifestRows: baseRows,
    observations: [{
      imageId: "combined-stockout",
      trackingCandidates: ["587625375225"],
      reason: "STOCKOUT",
    }],
  });
  assert.equal(combined.proposedActions.stockoutCandidates.length, 0);
  assert.ok(combined.blockedActions.some((item) => item.code === "STOCKOUT_BCODE_REQUIRED"));
});

test("explicit stockout B-code must belong to the matched package", () => {
  const result = reconcileUnshippedLabels({
    manifestRows: baseRows,
    observations: [{
      imageId: "wrong-bcode",
      trackingCandidates: ["587625375225"],
      reason: "STOCKOUT",
      stockoutBCodes: ["OTHER-1"],
    }],
  });
  assert.equal(result.proposedActions.stockoutCandidates.length, 0);
  assert.ok(result.blockedActions.some((item) => item.code === "STOCKOUT_BCODE_NOT_IN_MATCHED_PACKAGE"));
});
