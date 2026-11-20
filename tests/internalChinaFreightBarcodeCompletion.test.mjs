import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildInternalChinaFreightBarcodeCompletion,
  completeInternalChinaFreightBarcodeWithDependencies,
  freightBarcodeHistoryEvidenceHash,
  parseStoredInternalChinaFreightBarcodeCompletion,
} from "../src/lib/internalChinaFreightBarcodeCompletionCore.ts";

const draftId = "fast-purchase-draft:1234567890abcdef1234";
const cycleMonth = "2026-11";

function historyRecord(overrides = {}) {
  const parsedItems = [
    { id: "item-1", rowNo: 1, itemName: "상품 1", optionText: "검정", quantity: 2 },
    { id: "item-2", rowNo: 2, itemName: "상품 2", optionText: "흰색", quantity: 1 },
  ];
  const productMasterMatches = [
    { itemId: "item-1", matchedModelNo: "A1", matchedBarcode: "880000000001" },
    { itemId: "item-2", matchedModelNo: "A2", matchedBarcode: "880000000002" },
  ];
  return {
    id: "history-final-1",
    applicationNo: "673842, 673626",
    title: "11월 2차 바코드 최종본",
    rawText: "신청번호 673842\n신청번호 673626",
    parsedItems,
    productMasterMatches,
    memo: "온돌패스 전달 완료",
    createdAt: "2026-11-19T02:34:00.000Z",
    updatedAt: "2026-11-19T02:35:00.000Z",
    source: "manual-paste",
    pdfVersion: 1,
    itemCount: 2,
    matchedItemCount: 2,
    items: parsedItems,
    version: 1,
    ...overrides,
  };
}

function purchase(overrides = {}) {
  return {
    cycleMonth,
    orderCount: 56,
    lineCount: 142,
    assignedLineCount: 142,
    ...overrides,
  };
}

test("완료 근거는 발주차시와 완전 매칭된 서버 파일을 불변 해시로 묶는다", () => {
  const record = historyRecord();
  const completion = buildInternalChinaFreightBarcodeCompletion({
    draftId,
    cycleMonth,
    historyRecordId: record.id,
    purchase: purchase(),
    historyRecord: record,
    completedAt: "2026-11-21T00:00:00.000Z",
  });

  assert.equal(completion.historyRecordId, record.id);
  assert.equal(completion.applicationNo, "673842, 673626");
  assert.equal(completion.itemCount, 2);
  assert.match(completion.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(completion.completedAt, "2026-11-21T00:00:00.000Z");

  const reordered = historyRecord({
    parsedItems: record.parsedItems.map((item) => ({
      quantity: item.quantity,
      optionText: item.optionText,
      itemName: item.itemName,
      rowNo: item.rowNo,
      id: item.id,
    })),
  });
  assert.equal(
    freightBarcodeHistoryEvidenceHash(reordered),
    freightBarcodeHistoryEvidenceHash(record),
  );
  assert.notEqual(
    freightBarcodeHistoryEvidenceHash(historyRecord({ rawText: "변경된 문서" })),
    freightBarcodeHistoryEvidenceHash(record),
  );
});

test("주문이 없거나 모든 품목이 매칭되지 않은 파일은 종결하지 않는다", () => {
  const record = historyRecord();
  assert.throws(
    () =>
      buildInternalChinaFreightBarcodeCompletion({
        draftId,
        cycleMonth,
        historyRecordId: record.id,
        purchase: purchase({ orderCount: 0 }),
        historyRecord: record,
      }),
    /FREIGHT_BARCODE_COMPLETION_ORDER_REQUIRED/,
  );

  const partial = historyRecord({
    productMasterMatches: record.productMasterMatches.slice(0, 1),
    matchedItemCount: 1,
  });
  assert.throws(
    () =>
      buildInternalChinaFreightBarcodeCompletion({
        draftId,
        cycleMonth,
        historyRecordId: partial.id,
        purchase: purchase(),
        historyRecord: partial,
      }),
    /FREIGHT_BARCODE_COMPLETION_HISTORY_MATCH_INCOMPLETE/,
  );

  assert.throws(
    () =>
      buildInternalChinaFreightBarcodeCompletion({
        draftId,
        cycleMonth,
        historyRecordId: record.id,
        purchase: purchase(),
        historyRecord: historyRecord({ applicationNo: "" }),
      }),
    /FREIGHT_BARCODE_COMPLETION_APPLICATION_REQUIRED/,
  );
});

test("같은 파일 재요청은 재사용하고 다른 파일 덮어쓰기는 차단한다", async () => {
  const record = historyRecord();
  let stored = null;
  let storeCount = 0;
  const dependencies = {
    loadPurchaseContext: async () => purchase(),
    loadHistoryRecord: async (id) => (id === record.id ? record : undefined),
    loadCompletion: async () => stored,
    storeCompletion: async (completion) => {
      storeCount += 1;
      stored = completion;
    },
  };

  const first = await completeInternalChinaFreightBarcodeWithDependencies(
    { draftId, cycleMonth, historyRecordId: record.id },
    dependencies,
  );
  assert.equal(first.alreadyCompleted, false);
  assert.equal(storeCount, 1);

  const replay = await completeInternalChinaFreightBarcodeWithDependencies(
    { draftId, cycleMonth, historyRecordId: record.id },
    dependencies,
  );
  assert.equal(replay.alreadyCompleted, true);
  assert.equal(storeCount, 1);

  const other = historyRecord({ id: "history-final-2" });
  await assert.rejects(
    completeInternalChinaFreightBarcodeWithDependencies(
      { draftId, cycleMonth, historyRecordId: other.id },
      {
        ...dependencies,
        loadHistoryRecord: async () => other,
      },
    ),
    /FREIGHT_BARCODE_COMPLETION_ALREADY_COMPLETED/,
  );
  assert.equal(storeCount, 1);
});

test("저장 원장은 일치하는 draft와 유효한 증거만 복원한다", () => {
  const record = historyRecord();
  const completion = buildInternalChinaFreightBarcodeCompletion({
    draftId,
    cycleMonth,
    historyRecordId: record.id,
    purchase: purchase(),
    historyRecord: record,
    completedAt: "2026-11-21T00:00:00.000Z",
  });
  assert.deepEqual(
    parseStoredInternalChinaFreightBarcodeCompletion(draftId, {
      result_snapshot: completion,
    }),
    completion,
  );
  assert.equal(
    parseStoredInternalChinaFreightBarcodeCompletion(
      "fast-purchase-draft:aaaaaaaaaaaaaaaaaaaa",
      { result_snapshot: completion },
    ),
    null,
  );
  assert.equal(
    parseStoredInternalChinaFreightBarcodeCompletion(draftId, {
      result_snapshot: { ...completion, evidenceHash: "sha256:bad" },
    }),
    null,
  );
});

test("UI와 API는 선택 파일 종결 및 4단계 게이트 계약을 유지한다", async () => {
  const [route, core, freightPage, managerPage, store] = await Promise.all([
    readFile(
      new URL(
        "../src/app/api/china-order-manager/freight-barcode-completion/route.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../src/lib/internalChinaFreightBarcodeCompletionCore.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL("../src/app/freight-barcode-request/page.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../src/app/china-order-manager/page.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../src/lib/internalChinaFreightBarcodeCompletion.ts",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(route, /isSameOriginOpsRequest/);
  assert.match(freightPage, /선택 파일로 바코드 업무 종결/);
  assert.match(freightPage, /historyRecordId/);
  assert.match(managerPage, /loadInternalChinaFreightBarcodeCompletion/);
  assert.match(managerPage, /바코드 업무 종결 후 진행/);
  assert.match(store, /resolution=ignore-duplicates/);
  assert.match(store, /internal-china-freight-barcode:/);
  assert.match(core, /STORE_READBACK_FAILED/);
});
