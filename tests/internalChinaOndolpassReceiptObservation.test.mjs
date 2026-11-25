import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildInternalChinaOndolpassReceiptObservation,
  buildOndolpassReceiptSourceEventId,
  parseStoredInternalChinaOndolpassReceiptObservation,
} from "../src/lib/internalChinaOndolpassReceiptObservationCore.ts";
import { buildInternalChinaReceiptWorkspaceLines } from "../src/lib/internalChinaReceiptWorkspace.ts";

const draftId = "fast-purchase-draft:1234567890abcdef1234";
const evidence = {
  draftId,
  cycleMonth: "2026-11",
  historyRecordId: "history-final",
  applicationNo: "673842, 673626",
  itemCount: 3,
  matchedItemCount: 3,
  recordUpdatedAt: "2026-11-21T00:00:00.000Z",
  evidenceHash: `sha256:${"a".repeat(64)}`,
  completedAt: "2026-11-21T00:00:00.000Z",
  lines: [
    { sourceItemId: "a-1", applicationNo: "673842", rowNo: 1, orderNo: "3316598510069009453", barcode: "BBA1-1", quantity: 10, modelNo: "A", modelName: "A", saleOption: "검정", imageUrl: "" },
    { sourceItemId: "a-2", applicationNo: "673842", rowNo: 2, orderNo: "3316598510069009454", barcode: "BBA1-1", quantity: 5, modelNo: "A", modelName: "A", saleOption: "흰색", imageUrl: "" },
    { sourceItemId: "b-1", applicationNo: "673626", rowNo: 1, orderNo: "3317018629199027099", barcode: "BBB2-1", quantity: 8, modelNo: "B", modelName: "B", saleOption: "단품", imageUrl: "" },
  ],
};

function input(overrides = {}) {
  return {
    draftId,
    evidenceHash: evidence.evidenceHash,
    observedAt: "2026-11-21T03:00:00.000Z",
    applications: [
      {
        applicationNo: "673842",
        state: "부분입고",
        rows: [
          { rowNo: 1, quantity: 10, status: "RECEIVED", orderNo: "3316598510069009453", itemName: "A1" },
          { rowNo: 2, quantity: 5, status: "PENDING", orderNo: "3316598510069009454", itemName: "A2" },
        ],
      },
      {
        applicationNo: "673626",
        state: "무게측정",
        rows: [
          { rowNo: 1, quantity: 8, status: "RECEIVED", orderNo: "3317018629199027099", itemName: "B1" },
        ],
      },
    ],
    ...overrides,
  };
}

test("신청번호+행번호가 일치한 입고 표식만 B-code별 누적수량으로 준비한다", () => {
  const result = buildInternalChinaOndolpassReceiptObservation(input(), evidence);
  assert.equal(result.rowCount, 3);
  assert.equal(result.receivedRowCount, 2);
  assert.equal(result.pendingRowCount, 1);
  assert.equal(result.expectedQuantity, 23);
  assert.equal(result.observedReceivedQuantity, 18);
  assert.equal(result.complete, false);
  assert.deepEqual(result.byBarcode, [
    {
      barcode: "BBA1-1",
      expectedQuantity: 15,
      observedReceivedQuantity: 10,
      rowCount: 2,
      receivedRowCount: 1,
      pendingRowCount: 1,
      disposedRowCount: 0,
      mismatchCount: 0,
    },
    {
      barcode: "BBB2-1",
      expectedQuantity: 8,
      observedReceivedQuantity: 8,
      rowCount: 1,
      receivedRowCount: 1,
      pendingRowCount: 0,
      disposedRowCount: 0,
      mismatchCount: 0,
    },
  ]);
});

test("표시수량 불일치는 저장 근거에 남기되 입고 제안수량에서 제외한다", () => {
  const mismatch = input({
    applications: input().applications.map((application) =>
      application.applicationNo === "673842"
        ? {
            ...application,
            rows: application.rows.map((row) =>
              row.rowNo === 1 ? { ...row, quantity: 11 } : row,
            ),
          }
        : application,
    ),
  });
  const result = buildInternalChinaOndolpassReceiptObservation(mismatch, evidence);
  assert.equal(result.mismatchCount, 1);
  assert.equal(result.observedReceivedQuantity, 8);
  assert.match(result.issues.join("\n"), /QUANTITY_MISMATCH:673842:1:10:11/);
  assert.equal(result.complete, false);
});

test("모든 행에 일부 수량이라도 입고되면 부분입고 수량을 준비하고 완료로 판정한다", () => {
  const partial = input({
    applications: input().applications.map((application) => ({
      ...application,
      rows: application.rows.map((row) => ({
        ...row,
        status: "RECEIVED",
        quantity: row.rowNo === 1 ? Math.max(1, row.quantity - 2) : row.quantity,
      })),
    })),
  });
  const result = buildInternalChinaOndolpassReceiptObservation(partial, evidence);
  assert.equal(result.receivedRowCount, 3);
  assert.equal(result.pendingRowCount, 0);
  assert.equal(result.mismatchCount, 0);
  assert.equal(result.observedReceivedQuantity, 19);
  assert.equal(result.expectedQuantity, 23);
  assert.equal(result.complete, true);
  assert.equal(result.rows.every((row) => row.receivedQuantity > 0), true);
});
test("바코드 근거에 주문번호가 있으면 온돌패스 주문번호 누락도 입고 제안에서 제외한다", () => {
  const missingOrderNo = input({
    applications: input().applications.map((application) =>
      application.applicationNo === "673626"
        ? {
            ...application,
            rows: application.rows.map((row) => ({ ...row, orderNo: "" })),
          }
        : application,
    ),
  });
  const result = buildInternalChinaOndolpassReceiptObservation(missingOrderNo, evidence);
  assert.equal(result.mismatchCount, 1);
  assert.equal(result.observedReceivedQuantity, 10);
  assert.match(result.issues.join("\n"), /ORDER_NO_MISMATCH:673626:1/);
});

test("누락·중복 행은 차단하고 이미 입고된 행의 표식 소실은 누적 상태로 유지한다", () => {
  const missing = input({
    applications: input().applications.map((application) =>
      application.applicationNo === "673842"
        ? { ...application, rows: application.rows.slice(0, 1) }
        : application,
    ),
  });
  assert.throws(
    () => buildInternalChinaOndolpassReceiptObservation(missing, evidence),
    /ONDOLPASS_RECEIPT_ROW_SET_MISMATCH/,
  );
  const previous = buildInternalChinaOndolpassReceiptObservation(input(), evidence);
  const regressed = input({
    observedAt: "2026-11-21T04:00:00.000Z",
    applications: input().applications.map((application) => ({
      ...application,
      rows: application.rows.map((row) => ({ ...row, status: "PENDING" })),
    })),
  });
  const carried = buildInternalChinaOndolpassReceiptObservation(
    regressed,
    evidence,
    previous,
  );
  assert.equal(carried.receivedRowCount, previous.receivedRowCount);
  assert.equal(
    carried.observedReceivedQuantity,
    previous.observedReceivedQuantity,
  );
  assert.equal(carried.snapshotHash, previous.snapshotHash);

  const partialPrevious = buildInternalChinaOndolpassReceiptObservation(input({
    applications: input().applications.map((application) => ({
      ...application,
      rows: application.rows.map((row) => ({ ...row, status: "RECEIVED" })),
    })),
  }), evidence);
  const reducedQuantity = input({
    observedAt: "2026-11-21T05:00:00.000Z",
    applications: input().applications.map((application) => ({
      ...application,
      rows: application.rows.map((row) => (
        application.applicationNo === "673842" && row.rowNo === 1
          ? { ...row, status: "PENDING", quantity: 9 }
          : { ...row, status: "RECEIVED" }
      )),
    })),
  });
  assert.throws(
    () => buildInternalChinaOndolpassReceiptObservation(reducedQuantity, evidence, partialPrevious),
    /ONDOLPASS_RECEIPT_STATUS_REGRESSION/,
  );

  const disposedAfterReceipt = input({
    observedAt: "2026-11-21T06:00:00.000Z",
    applications: input().applications.map((application) => ({
      ...application,
      rows: application.rows.map((row) => ({
        ...row,
        status: application.applicationNo === "673842" && row.rowNo === 1
          ? "DISPOSED"
          : "RECEIVED",
      })),
    })),
  });
  assert.throws(
    () => buildInternalChinaOndolpassReceiptObservation(
      disposedAfterReceipt,
      evidence,
      partialPrevious,
    ),
    /ONDOLPASS_RECEIPT_STATUS_REGRESSION/,
  );
});

test("같은 주문의 명시적 입고수량이 1535개에서 1452개로 정정되면 최신 수량만 준비한다", () => {
  const correctionEvidence = {
    ...evidence,
    lines: [{ ...evidence.lines[0], quantity: 1535 }],
  };
  const base = input();
  const application = base.applications[0];
  const sample = (quantity, observedAt, orderNo = application.rows[0].orderNo) => ({
    ...base,
    observedAt,
    applications: [{
      ...application,
      rows: [{ ...application.rows[0], quantity, orderNo }],
    }],
  });
  const original = buildInternalChinaOndolpassReceiptObservation(
    sample(1535, "2026-11-23T03:33:29.123Z"),
    correctionEvidence,
  );
  const correctedInput = sample(1452, "2026-11-25T11:35:24.000Z");
  const corrected = buildInternalChinaOndolpassReceiptObservation(
    correctedInput,
    correctionEvidence,
    original,
  );
  assert.equal(corrected.rows[0].status, "RECEIVED");
  assert.equal(corrected.rows[0].receivedQuantity, 1452);
  assert.equal(corrected.byBarcode[0].observedReceivedQuantity, 1452);
  assert.equal(corrected.observedReceivedQuantity, 1452);
  assert.equal(corrected.expectedQuantity, 1535);
  assert.notEqual(corrected.snapshotHash, original.snapshotHash);
  const restored = buildInternalChinaOndolpassReceiptObservation(
    sample(1535, "2026-11-25T12:00:00.000Z"),
    correctionEvidence,
    corrected,
  );
  assert.equal(restored.snapshotHash, original.snapshotHash);
  assert.notEqual(
    buildOndolpassReceiptSourceEventId(restored, corrected),
    buildOndolpassReceiptSourceEventId(original, null),
  );
  const correctedAgain = buildInternalChinaOndolpassReceiptObservation(
    sample(1452, "2026-11-25T13:00:00.000Z"),
    correctionEvidence,
    restored,
  );
  assert.equal(correctedAgain.snapshotHash, corrected.snapshotHash);
  assert.notEqual(
    buildOndolpassReceiptSourceEventId(correctedAgain, restored),
    buildOndolpassReceiptSourceEventId(corrected, original),
  );
  assert.equal(
    buildOndolpassReceiptSourceEventId(correctedAgain, restored),
    buildOndolpassReceiptSourceEventId(
      { ...correctedAgain, observedAt: "2026-11-25T13:00:01.000Z" },
      restored,
    ),
  );
  assert.throws(
    () => buildInternalChinaOndolpassReceiptObservation(
      correctedInput,
      correctionEvidence,
      restored,
    ),
    /ONDOLPASS_RECEIPT_OBSERVATION_STALE/,
  );
  assert.throws(
    () => buildInternalChinaOndolpassReceiptObservation(
      sample(1452, correctedInput.observedAt, "3316598510069009454"),
      correctionEvidence,
      original,
    ),
    /ONDOLPASS_RECEIPT_STATUS_REGRESSION/,
  );
});

test("온돌패스 상단 신청상태는 신청번호별 품목 입고 판정에 관여하지 않는다", () => {
  const baseline = buildInternalChinaOndolpassReceiptObservation(input(), evidence);
  const changedHeaderStates = buildInternalChinaOndolpassReceiptObservation(
    input({
      applications: input().applications.map((application, index) => ({
        ...application,
        state: ["입고대기", "부분입고", "출고준비"][index % 3],
      })),
    }),
    evidence,
  );
  assert.equal(changedHeaderStates.snapshotHash, baseline.snapshotHash);
  assert.deepEqual(changedHeaderStates.rows, baseline.rows);
  assert.deepEqual(changedHeaderStates.byBarcode, baseline.byBarcode);
});

test("과거에 입고로 저장된 기준 10개·표시 15개 품목은 초과로 제외하고 나머지는 저장한다", () => {
  const sample = input();
  const first = buildInternalChinaOndolpassReceiptObservation(sample, evidence);
  const legacyOverage = {
    ...first,
    // Legacy fingerprint of the same 15-count source, before eligibility was hashed.
    snapshotHash: "sha256:ff2908f9b4808ea7209fd21f8cc802fc44f5083be7bdfca086ff721427fbc042",
    rows: first.rows.map((row) => row.applicationNo === "673842" && row.rowNo === 1
      ? { ...row, displayedQuantity: 15, receivedQuantity: 15, quantityMatches: false }
      : row),
  };
  const observe = (quantity, orderNo = sample.applications[0].rows[0].orderNo) => input({
    observedAt: "2026-11-25T11:47:09.000Z",
    applications: sample.applications.map((application) => application.applicationNo === "673842"
      ? {
          ...application,
          rows: application.rows.map((row) => row.rowNo === 1
            ? { ...row, quantity, orderNo }
            : row),
        }
      : application),
  });

  const updated = buildInternalChinaOndolpassReceiptObservation(observe(15), evidence, legacyOverage);
  const overage = updated.rows.find((row) => row.applicationNo === "673842" && row.rowNo === 1);
  assert.equal(overage.displayedQuantity, 15);
  assert.equal(overage.eligible, false);
  assert.equal(overage.receivedQuantity, 0);
  assert.equal(updated.observedReceivedQuantity, 8);
  assert.equal(updated.receivedRowCount, 1);
  assert.equal(updated.mismatchCount, 1);
  assert.equal(updated.complete, false);
  assert.notEqual(updated.snapshotHash, legacyOverage.snapshotHash);
  assert.equal(
    buildInternalChinaOndolpassReceiptObservation(observe(15), evidence, updated).snapshotHash,
    updated.snapshotHash,
  );
  assert.ok(updated.issues.includes("QUANTITY_MISMATCH:673842:1:10:15"));
  assert.throws(
    () => buildInternalChinaOndolpassReceiptObservation(observe(16), evidence, legacyOverage),
    /ONDOLPASS_RECEIPT_STATUS_REGRESSION/,
  );
  assert.throws(
    () => buildInternalChinaOndolpassReceiptObservation(
      observe(15, "3316598510069009454"),
      evidence,
      legacyOverage,
    ),
    /ONDOLPASS_RECEIPT_STATUS_REGRESSION/,
  );
});

test("같은 화면 상태는 확인시각이 달라도 같은 멱등 해시를 사용하고 저장값을 복원한다", () => {
  const first = buildInternalChinaOndolpassReceiptObservation(input(), evidence);
  const replay = buildInternalChinaOndolpassReceiptObservation(
    input({ observedAt: "2026-11-21T05:00:00.000Z" }),
    evidence,
    first,
  );
  assert.equal(replay.snapshotHash, first.snapshotHash);
  assert.deepEqual(
    parseStoredInternalChinaOndolpassReceiptObservation(draftId, {
      result_snapshot: first,
    }),
    first,
  );
});

test("4단계는 온돌패스 누계에서 이미 원장 반영된 수량을 빼고 이번 입력을 준비한다", () => {
  const observation = buildInternalChinaOndolpassReceiptObservation(input(), evidence);
  const lines = buildInternalChinaReceiptWorkspaceLines(
    [
      { barcode: "BBA1-1", orderedQuantity: 15, receivedQuantity: 4, cancelledQuantity: 0, openQuantity: 11, status: "PARTIALLY_RECEIVED", recoveredFromPurchaseEvidence: false, ledgerOrderedQuantity: 15, ledgerCancelledQuantity: 0, modelNo: "A", modelName: "A", saleOption: "", imageUrl: "" },
      { barcode: "BBB2-1", orderedQuantity: 8, receivedQuantity: 0, cancelledQuantity: 0, openQuantity: 8, status: "ORDERED", recoveredFromPurchaseEvidence: false, ledgerOrderedQuantity: 8, ledgerCancelledQuantity: 0, modelNo: "B", modelName: "B", saleOption: "", imageUrl: "" },
    ],
    [],
    {},
    observation,
  );
  assert.deepEqual(
    lines.map((line) => [line.barcode, line.suggestedReceiptQuantity]),
    [["BBA1-1", 6], ["BBB2-1", 8]],
  );
});

test("API/UI 계약은 관찰 저장과 실제 입고확정을 분리한다", async () => {
  const [route, service, panel, page] = await Promise.all([
    readFile("src/app/api/china-order-manager/ondolpass-receipt-observation/route.ts", "utf8"),
    readFile("src/lib/internalChinaOndolpassReceiptObservation.ts", "utf8"),
    readFile("src/components/china-order-manager/InternalChinaReceiptPanel.tsx", "utf8"),
    readFile("src/app/china-order-manager/page.tsx", "utf8"),
  ]);
  assert.match(route, /isSameOriginOpsRequest/);
  assert.match(service, /resolution=ignore-duplicates/);
  assert.match(service, /snapshotHash/);
  assert.match(panel, /온돌패스 확인수량 채우기/);
  assert.match(panel, /확인이 필요한 품목/);
  assert.match(panel, /입고 감지완료 품목/);
  assert.match(panel, /w-full table-fixed/);
  assert.doesNotMatch(panel, /max-h-\[560px\] overflow-auto/);
  assert.doesNotMatch(panel, /min-w-\[1280px\]/);
  assert.match(panel, /정상 부분입고\(1개 이상·기준수량 이하\)/);
  assert.match(page, /issues: ondolpassObservation\.issues/);
  assert.match(panel, /suggestedReceiptQuantity/);
  assert.match(panel, /\/api\/china-order-manager\/receipts/);
  assert.match(page, /loadLatestInternalChinaOndolpassReceiptObservation/);
  assert.doesNotMatch(route, /recordInternalChinaReceipt/);
});
