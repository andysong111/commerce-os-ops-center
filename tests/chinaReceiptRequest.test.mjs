import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeReceiptRequestLines,
  receiptRequestFingerprint,
  receiptRequestStorageKey,
  summarizeStoredReceiptReplay,
  validReceiptRequestId,
} from "../src/domain/china-receipt-request.ts";

const requestId = "11111111-1111-4111-8111-111111111111";
const draftId = "fast-purchase-draft:0123456789abcdefabcd";
const cycleMonth = "2026-09";
const lines = [
  { barcode: "BBA8-3", quantity: 3 },
  { barcode: "BBA8-2", quantity: 2 },
];

test("receipt request identity accepts only version-4 UUIDs", () => {
  assert.equal(validReceiptRequestId(requestId), requestId);
  assert.equal(validReceiptRequestId(""), null);
  assert.throws(
    () => validReceiptRequestId("22222222-2222-5222-8222-222222222222"),
    /CHINA_RECEIPT_REQUEST_ID_INVALID/,
  );
});

test("receipt fingerprint is stable across UI line ordering", () => {
  const first = receiptRequestFingerprint(draftId, cycleMonth, lines);
  const second = receiptRequestFingerprint(draftId, cycleMonth, [...lines].reverse());
  assert.equal(first, second);
  assert.notEqual(
    first,
    receiptRequestFingerprint(draftId, cycleMonth, [
      { barcode: "BBA8-3", quantity: 4 },
      { barcode: "BBA8-2", quantity: 2 },
    ]),
  );
  assert.match(receiptRequestStorageKey(draftId, cycleMonth), /china-receipt-request:v1/);
});

test("receipt line normalization rejects duplicate or invalid quantities", () => {
  assert.deepEqual(normalizeReceiptRequestLines(lines), [
    { barcode: "BBA8-2", quantity: 2 },
    { barcode: "BBA8-3", quantity: 3 },
  ]);
  assert.throws(
    () => normalizeReceiptRequestLines([
      { barcode: "BBA8-2", quantity: 1 },
      { barcode: "BBA8-2", quantity: 1 },
    ]),
    /CHINA_RECEIPT_DUPLICATE_BARCODE/,
  );
  assert.throws(
    () => normalizeReceiptRequestLines([{ barcode: "BBA8-2", quantity: 0 }]),
    /CHINA_RECEIPT_REQUEST_LINES_INVALID/,
  );
});

test("stored exact request replays receipt totals without adding quantity", () => {
  const replay = summarizeStoredReceiptReplay({
    requestId,
    draftId,
    cycleMonth,
    lines,
    snapshots: [
      {
        receiptId: requestId,
        draftId,
        cycleMonth,
        barcode: "BBA8-3",
        receivedNow: 3,
        fullyReceived: false,
        sourcing: { intakeId: "intake-1" },
      },
      {
        receiptId: requestId,
        draftId,
        cycleMonth,
        barcode: "BBA8-2",
        receivedNow: 2,
        fullyReceived: true,
        sourcing: null,
      },
    ],
  });
  assert.equal(replay?.receivedNow, 5);
  assert.equal(replay?.lineCount, 2);
  assert.equal(replay?.fullyReceivedCount, 1);
  assert.equal(replay?.partiallyReceivedCount, 1);
  assert.equal(replay?.sourcedCount, 1);
});

test("same request id with changed draft, quantity or line set fails closed", () => {
  const base = [
    {
      receiptId: requestId,
      draftId,
      cycleMonth,
      barcode: "BBA8-3",
      receivedNow: 3,
      fullyReceived: false,
    },
    {
      receiptId: requestId,
      draftId,
      cycleMonth,
      barcode: "BBA8-2",
      receivedNow: 2,
      fullyReceived: true,
    },
  ];
  assert.throws(
    () => summarizeStoredReceiptReplay({
      requestId,
      draftId,
      cycleMonth,
      lines: [{ barcode: "BBA8-3", quantity: 4 }, { barcode: "BBA8-2", quantity: 2 }],
      snapshots: base,
    }),
    /CHINA_RECEIPT_REQUEST_REPLAY_CONFLICT/,
  );
  assert.throws(
    () => summarizeStoredReceiptReplay({
      requestId,
      draftId: "fast-purchase-draft:fedcba9876543210fedc",
      cycleMonth,
      lines,
      snapshots: base,
    }),
    /CHINA_RECEIPT_REQUEST_REPLAY_CONFLICT/,
  );
  assert.throws(
    () => summarizeStoredReceiptReplay({
      requestId,
      draftId,
      cycleMonth,
      lines,
      snapshots: base.slice(0, 1),
    }),
    /CHINA_RECEIPT_REQUEST_REPLAY_CONFLICT/,
  );
});
