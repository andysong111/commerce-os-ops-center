import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  normalizeShoplingStockResponsibilityResult,
  shoplingStockResultDetail,
} from "../src/lib/shoplingStockResponsibility.ts";

const JOB_ID =
  "stock-sync:BCC5-1:ON_SALE:2026-11-18T18:19:28.338Z";
const OWNER_KEY = `${JOB_ID}:${JOB_ID}:OPTION:120461,120462,120463`;

function realBcc51Fixture() {
  return {
    type: "COMMERCE_OS_SHOPLING_STOCK_SYNC_RESULT_HF27",
    jobId: JOB_ID,
    job: {
      jobId: JOB_ID,
      barcode: "BCC5-1",
      productKind: "OPTION",
      desiredStatus: "ON_SALE",
    },
    outcome: "UNCERTAIN",
    message:
      "BCC5-1 · Shopling 결과표에 실패 17건이 확인되어 자동 성공 처리하지 않았습니다.",
    evidence: {
      code: "SHOPLING_HF87_RESULT_TABLE_FAILURE",
      stage: "WAIT_A21_RESULT",
      resultTabId: 338620311,
      result: {
        terminal: true,
        resultHeading: true,
        rowsBalanced: true,
        totalCount: 53,
        successCount: 36,
        failureCount: 17,
        exactOwnerA21PopupTabId: 338620311,
      },
      history: [
        {
          code: "SHOPLING_HF84_MODE_THEN_TARGET_COMMITTED",
          stage: "WAIT_A21_RESULT",
          lastMileReceipt: {
            receiptKey: OWNER_KEY,
            assignmentOwnerKey: OWNER_KEY,
            goodsKeyQuery: "120461,120462,120463",
            popupTabId: 338620311,
            popupFrameId: 0,
            productKind: "OPTION",
            desiredStatus: "ON_SALE",
            shoplingSubmitInvoked: true,
            submitConfirmSeen: true,
            submitControlVerified: true,
            topChecked: true,
            targetChecked: true,
          },
        },
      ],
    },
  };
}

test("HF97 counts the real BCC5-1 exact submit receipt as Commerce OS success with a market advisory", () => {
  const raw = realBcc51Fixture();
  const normalized = normalizeShoplingStockResponsibilityResult(raw);

  assert.equal(raw.outcome, "UNCERTAIN");
  assert.equal(normalized.outcome, "SUCCEEDED");
  assert.match(normalized.message, /53건 중 마켓 실패 17건/);
  assert.equal(
    normalized.evidence.outcomeNormalization,
    "SHOPLING_SUBMIT_RECEIPT_WITH_MARKET_FAILURE_ADVISORY_HF97",
  );
  assert.equal(normalized.evidence.marketFailuresAdvisory, true);
  assert.equal(normalized.evidence.marketFailureCount, 17);
  assert.equal(normalized.evidence.marketSuccessCount, 36);
  assert.equal(normalized.evidence.marketTotalCount, 53);
  assert.equal(normalized.evidence.rawOutcome, "UNCERTAIN");
  assert.equal(
    normalized.evidence.code,
    "SHOPLING_HF87_RESULT_TABLE_FAILURE",
  );

  assert.deepEqual(shoplingStockResultDetail(normalized), {
    code: "SHOPLING_HF87_RESULT_TABLE_FAILURE",
    stage: "WAIT_A21_RESULT",
    marketFailureCount: 17,
    marketSuccessCount: 36,
    marketTotalCount: 53,
    responsibilityReceiptAccepted: true,
  });
});

test("HF97 applies the same responsibility rule when reading the persisted sync snapshot", () => {
  const persisted = realBcc51Fixture();
  delete persisted.job;
  persisted.productKind = "OPTION";
  persisted.desiredStatus = "ON_SALE";

  assert.equal(
    normalizeShoplingStockResponsibilityResult(persisted).outcome,
    "SUCCEEDED",
  );
});

test("HF97 fails closed when exact popup submit proof is incomplete or mismatched", () => {
  const cases = [
    (fixture) => {
      fixture.evidence.history = [];
    },
    (fixture) => {
      fixture.evidence.history[0].lastMileReceipt.submitConfirmSeen = false;
    },
    (fixture) => {
      fixture.evidence.result.failureCount = 16;
    },
    (fixture) => {
      fixture.evidence.result.exactOwnerA21PopupTabId = 999;
    },
    (fixture) => {
      fixture.evidence.history[0].lastMileReceipt.assignmentOwnerKey =
        "another-assignment";
    },
  ];

  for (const mutate of cases) {
    const fixture = realBcc51Fixture();
    mutate(fixture);
    assert.equal(
      normalizeShoplingStockResponsibilityResult(fixture).outcome,
      "UNCERTAIN",
    );
  }
});

test("HF97 never upgrades a genuine pre-submit failure", () => {
  const failed = {
    jobId: "stock-sync:BAF3-3:SOLD_OUT:2026-11-18T18:19:28.338Z",
    outcome: "FAILED",
    message:
      "대상 상품이 판매/품절(B/C) 상태가 아니어서 자동 전환을 차단했습니다.",
    evidence: {
      code: "SHOPLING_STOCK_STATE_COALESCED_API_FAILED",
      browserMutationStarted: false,
      appliedApiCount: 0,
    },
  };

  assert.equal(normalizeShoplingStockResponsibilityResult(failed), failed);
});

test("HF97 bridge and persisted report use one canonical normalizer while the run UI shows exact details", async () => {
  const [bridge, report, panel] = await Promise.all([
    readFile(
      new URL(
        "../src/components/china-order-manager/StockSyncHF15Bridge.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL("../src/lib/inventoryStockControl.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../src/components/china-order-manager/InventoryStockoutOperatorPanel.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(bridge, /normalizeShoplingStockResponsibilityResult\(data\)/);
  assert.match(
    report,
    /normalizeShoplingStockResponsibilityResult\(snapshot\(row\)\)/,
  );
  assert.match(panel, /이번 실행 상세/);
  assert.match(panel, /전송 접수 성공 · 마켓 경고/);
  assert.match(panel, /성공·마켓 경고·실패 원인은 바로 아래/);
  assert.doesNotMatch(panel, /실패·확인 필요 건만 아래 운영 큐/);
});

