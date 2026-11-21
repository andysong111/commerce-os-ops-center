import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  applyInternalChinaOndolpassOrderNumberCorrections,
  buildInternalChinaOndolpassOrderNumberCorrection,
  buildInternalChinaOndolpassReceiptObservation,
  buildInternalChinaOndolpassReceiptSourceEventId,
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
          { rowNo: 1, quantity: 10, status: "RECEIVED", orderNo: "3316598510069009453", itemName: "A1", trackingNumbers: ["760256617306"] },
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
      shortageRowCount: 0,
      shortageQuantity: 0,
      overageRowCount: 0,
      overageQuantity: 0,
      mismatchCount: 0,
      trackingNumbers: ["760256617306"],
      orderMismatches: [],
    },
    {
      barcode: "BBB2-1",
      expectedQuantity: 8,
      observedReceivedQuantity: 8,
      rowCount: 1,
      receivedRowCount: 1,
      pendingRowCount: 0,
      disposedRowCount: 0,
      shortageRowCount: 0,
      shortageQuantity: 0,
      overageRowCount: 0,
      overageQuantity: 0,
      mismatchCount: 0,
      trackingNumbers: [],
      orderMismatches: [],
    },
  ]);
});

test("변경된 1688 주문번호를 행 단위로 정정하면 다음 11-2 매칭과 트레킹번호를 함께 복구한다", () => {
  const changedOrderNo = "3317999999999009453";
  const mismatched = buildInternalChinaOndolpassReceiptObservation(input({
    applications: input().applications.map((application) => (
      application.applicationNo === "673842"
        ? {
            ...application,
            rows: application.rows.map((row) => row.rowNo === 1
              ? { ...row, orderNo: changedOrderNo, trackingNumbers: ["SF5163733838175"] }
              : row),
          }
        : application
    )),
  }), evidence);
  assert.equal(mismatched.mismatchCount, 1);
  assert.equal(mismatched.byBarcode[0].orderMismatches[0].observedOrderNo, changedOrderNo);

  const correction = buildInternalChinaOndolpassOrderNumberCorrection({
    draftId,
    applicationNo: "673842",
    rowNo: 1,
    correctedOrderNo: changedOrderNo,
  }, evidence, mismatched, "2026-11-21T03:30:00.000Z");
  const correctedEvidence = applyInternalChinaOndolpassOrderNumberCorrections(
    evidence,
    [correction],
  );
  const corrected = buildInternalChinaOndolpassReceiptObservation(input({
    observedAt: "2026-11-21T03:30:00.000Z",
    applications: input().applications.map((application) => (
      application.applicationNo === "673842"
        ? {
            ...application,
            rows: application.rows.map((row) => row.rowNo === 1
              ? { ...row, orderNo: changedOrderNo, trackingNumbers: ["SF5163733838175"] }
              : row),
          }
        : application
    )),
  }), correctedEvidence, mismatched);
  assert.equal(corrected.mismatchCount, 0);
  assert.equal(corrected.rows.find((row) => row.applicationNo === "673842" && row.rowNo === 1)?.expectedOrderNo, changedOrderNo);
  assert.deepEqual(corrected.byBarcode[0].trackingNumbers, ["SF5163733838175"]);
  assert.notEqual(corrected.snapshotHash, mismatched.snapshotHash);
});

test("주문보다 많이 입고된 수량은 매칭 실패가 아니라 초과 입고로 분류한다", () => {
  const overage = input({
    applications: input().applications.map((application) =>
      application.applicationNo === "673842"
        ? {
            ...application,
            rows: application.rows.map((row) =>
              row.rowNo === 1 ? { ...row, quantity: 15 } : row,
            ),
          }
        : application,
    ),
  });
  const result = buildInternalChinaOndolpassReceiptObservation(overage, evidence);
  assert.equal(result.mismatchCount, 0);
  assert.equal(result.overageRowCount, 1);
  assert.equal(result.overageQuantity, 5);
  assert.equal(result.observedReceivedQuantity, 23);
  assert.match(result.issues.join("\n"), /RECEIPT_OVERAGE:673842:1:10:15/);
  assert.equal(result.complete, false);
});

test("주문보다 적게 입고된 수량도 실제 수량으로 보존하고 부족 입고로 분류한다", () => {
  const shortage = input({
    applications: input().applications.map((application) =>
      application.applicationNo === "673842"
        ? {
            ...application,
            rows: application.rows.map((row) =>
              row.rowNo === 1 ? { ...row, quantity: 7 } : row,
            ),
          }
        : application,
    ),
  });
  const result = buildInternalChinaOndolpassReceiptObservation(shortage, evidence);
  assert.equal(result.mismatchCount, 0);
  assert.equal(result.shortageRowCount, 1);
  assert.equal(result.shortageQuantity, 3);
  assert.equal(result.observedReceivedQuantity, 15);
  assert.match(result.issues.join("\n"), /RECEIPT_SHORTAGE:673842:1:10:7/);
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

test("누락·중복 행과 이미 입고된 행의 회귀는 fail-closed 한다", () => {
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
  assert.throws(
    () => buildInternalChinaOndolpassReceiptObservation(regressed, evidence, previous),
    /ONDOLPASS_RECEIPT_STATUS_REGRESSION/,
  );

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
          ? { ...row, status: "RECEIVED", quantity: 9 }
          : { ...row, status: "RECEIVED" }
      )),
    })),
  });
  assert.throws(
    () => buildInternalChinaOndolpassReceiptObservation(reducedQuantity, evidence, partialPrevious),
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

test("같은 화면 상태라도 서로 다른 11-2 실행시각은 별도 적용 이력으로 기록한다", () => {
  const first = buildInternalChinaOndolpassReceiptObservation(input(), evidence);
  const later = buildInternalChinaOndolpassReceiptObservation(
    input({ observedAt: "2026-11-21T05:00:00.000Z" }),
    evidence,
    first,
  );
  assert.equal(later.snapshotHash, first.snapshotHash);
  const firstEventId = buildInternalChinaOndolpassReceiptSourceEventId(
    draftId,
    first.snapshotHash,
    first.observedAt,
  );
  assert.equal(
    buildInternalChinaOndolpassReceiptSourceEventId(
      draftId,
      first.snapshotHash,
      first.observedAt,
    ),
    firstEventId,
  );
  assert.notEqual(
    buildInternalChinaOndolpassReceiptSourceEventId(
      draftId,
      later.snapshotHash,
      later.observedAt,
    ),
    firstEventId,
  );
});

test("기존 저장본의 수량 불일치도 다시 읽을 때 부족·초과 입고로 복구한다", () => {
  const current = buildInternalChinaOndolpassReceiptObservation(
    input({
      applications: input().applications.map((application) =>
        application.applicationNo === "673842"
          ? {
              ...application,
              rows: application.rows.map((row) =>
                row.rowNo === 1 ? { ...row, quantity: 15 } : row,
              ),
            }
          : application,
      ),
    }),
    evidence,
  );
  const legacy = structuredClone(current);
  const legacyRow = legacy.rows.find(
    (row) => row.applicationNo === "673842" && row.rowNo === 1,
  );
  legacyRow.quantityMatches = false;
  legacyRow.eligible = false;
  legacyRow.receivedQuantity = 0;
  legacy.mismatchCount = 1;
  legacy.observedReceivedQuantity = 8;
  legacy.issues = ["QUANTITY_MISMATCH:673842:1:10:15"];

  const restored = parseStoredInternalChinaOndolpassReceiptObservation(draftId, {
    result_snapshot: legacy,
  });
  assert.equal(restored.mismatchCount, 0);
  assert.equal(restored.overageRowCount, 1);
  assert.equal(restored.overageQuantity, 5);
  assert.equal(restored.observedReceivedQuantity, 23);
  assert.match(restored.issues.join("\n"), /RECEIPT_OVERAGE:673842:1:10:15/);
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

test("4단계는 주문수량보다 많이 입고된 실제 수량도 자르지 않고 제안한다", () => {
  const lines = buildInternalChinaReceiptWorkspaceLines(
    [
      { barcode: "BBA1-1", orderedQuantity: 10, receivedQuantity: 0, cancelledQuantity: 0, openQuantity: 10, status: "ORDERED", recoveredFromPurchaseEvidence: false, ledgerOrderedQuantity: 10, ledgerCancelledQuantity: 0, modelNo: "A", modelName: "A", saleOption: "", imageUrl: "" },
    ],
    [],
    {},
    {
      byBarcode: [{
        barcode: "BBA1-1", expectedQuantity: 10, observedReceivedQuantity: 15,
        rowCount: 1, receivedRowCount: 1, pendingRowCount: 0, disposedRowCount: 0,
        shortageRowCount: 0, shortageQuantity: 0, overageRowCount: 1,
        overageQuantity: 5, mismatchCount: 0, trackingNumbers: ["760256617306"],
        orderMismatches: [],
      }],
    },
  );
  assert.equal(lines[0].suggestedReceiptQuantity, 15);
  assert.equal(lines[0].ondolpassOverageQuantity, 5);
  assert.deepEqual(lines[0].ondolpassTrackingNumbers, ["760256617306"]);
});

test("API/UI 계약은 관찰 저장과 실제 입고확정을 분리한다", async () => {
  const [route, service, panel, page] = await Promise.all([
    readFile("src/app/api/china-order-manager/ondolpass-receipt-observation/route.ts", "utf8"),
    readFile("src/lib/internalChinaOndolpassReceiptObservation.ts", "utf8"),
    readFile("src/components/china-order-manager/InternalChinaReceiptPanel.tsx", "utf8"),
    readFile("src/app/china-order-manager/page.tsx", "utf8"),
  ]);
  assert.match(route, /isSameOriginOpsRequest/);
  assert.match(route, /export async function PATCH/);
  assert.match(route, /saveInternalChinaOndolpassOrderNumberCorrection/);
  assert.match(service, /resolution=ignore-duplicates/);
  assert.match(service, /buildInternalChinaOndolpassReceiptSourceEventId/);
  assert.match(service, /observation\.observedAt/);
  assert.doesNotMatch(
    service,
    /context\.observation\?\.snapshotHash === observation\.snapshotHash/,
  );
  assert.match(service, /snapshotHash/);
  assert.match(service, /INTERNAL_CHINA_ONDOLPASS_ORDER_NUMBER_CORRECTION/);
  assert.match(service, /applyInternalChinaOndolpassOrderNumberCorrections/);
  assert.match(panel, /11-2 자동 적용 완료/);
  assert.match(panel, /11-2 자동반영 · 최근 적용/);
  assert.match(panel, /ONDOLPASS_AUTO_REFRESH_INTERVAL_MS = 15_000/);
  assert.match(panel, /refreshWhenObservationChanges/);
  assert.match(panel, /router\.refresh\(\)/);
  assert.match(panel, /visibilitychange/);
  assert.doesNotMatch(panel, /최근 11-2 확인수량 입력칸에 적용/);
  assert.doesNotMatch(panel, /observedAppliedAt/);
  assert.match(panel, /현재 입력 \{number\.format\(attentionInputSummary\.lineCount\)\}개 품목/);
  assert.match(panel, /현재 입력 \{number\.format\(completeInputSummary\.lineCount\)\}개 품목/);
  assert.match(panel, /전량 입고확정 · \$\{number\.format\(selectedQuantity\)\}개 · 다음 단계/);
  assert.match(panel, /부분입고 확정 · \$\{number\.format\(selectedQuantity\)\}개 · 4단계 유지/);
  assert.match(panel, /fullReceiptPrepared/);
  assert.match(panel, /별도 적용 버튼 없이 확인수량이 이 입력칸에 자동 반영/);
  assert.match(route, /Ops Center 4단계 입력칸에 자동 반영/);
  assert.match(panel, /폐기 확인 필요/);
  assert.match(panel, /확인이 필요한 품목/);
  assert.match(panel, /입고 감지완료 품목/);
  assert.match(panel, /OPS 입고확정 대기/);
  assert.match(panel, /정상입고 \{number\.format\(observationNormalReceivedRowCount\)\}행/);
  assert.match(panel, /미입고 대기 \{number\.format\(observation\.pendingRowCount\)\}행/);
  assert.match(panel, /확인 필요 \{number\.format\(observationReviewRowCount\)\}행/);
  assert.match(panel, /부족입고 \{number\.format\(observation\.shortageRowCount\)\}행/);
  assert.match(panel, /초과입고 \{number\.format\(observation\.overageRowCount\)\}행/);
  assert.match(panel, /주문 매칭 실패 \{number\.format\(observation\.mismatchCount\)\}행/);
  assert.match(panel, /주문번호 수정/);
  assert.match(panel, /수정하고 다시 매칭/);
  assert.match(panel, /트레킹번호 ·/);
  assert.match(panel, /w-full table-fixed/);
  assert.doesNotMatch(panel, /max-h-\[560px\] overflow-auto/);
  assert.doesNotMatch(panel, /min-w-\[1280px\]/);
  assert.match(panel, /수량 차이는 실패가 아니라 부족 입고 또는 주문보다 많이 입고/);
  assert.doesNotMatch(panel, /근거 불일치/);
  assert.match(page, /issues: ondolpassObservation\.issues/);
  assert.match(panel, /suggestedReceiptQuantity/);
  assert.match(panel, /\/api\/china-order-manager\/receipts/);
  assert.match(page, /loadLatestInternalChinaOndolpassReceiptObservation/);
  assert.doesNotMatch(route, /recordInternalChinaReceipt/);
});
