import assert from "node:assert/strict";
import test from "node:test";
import {
  finalizeShoplingDirectRun,
  recordShoplingDirectRunOutcome,
  shoplingDirectRunCounts,
  shoplingDirectRunSummaryText,
  startShoplingDirectRun,
} from "../src/lib/shoplingDirectRunProgress.ts";

test("direct Shopling run exposes progress and an explicit all-done result", () => {
  let progress = startShoplingDirectRun(2);
  assert.equal(
    shoplingDirectRunSummaryText(progress),
    "Shopling 전송 접수 진행 중 · 0/2건 완료",
  );

  progress = recordShoplingDirectRunOutcome(progress, "job-1", "SUCCEEDED");
  assert.equal(
    shoplingDirectRunSummaryText(progress),
    "Shopling 전송 접수 진행 중 · 1/2건 완료",
  );

  progress = recordShoplingDirectRunOutcome(progress, "job-2", "SUCCEEDED");
  progress = finalizeShoplingDirectRun(progress);
  assert.equal(progress.status, "COMPLETED");
  assert.equal(
    shoplingDirectRunSummaryText(progress),
    "전체 작업 끝남 · Shopling 전송 접수 완료 2/2건",
  );
});

test("duplicate result messages cannot inflate the completed count", () => {
  let progress = startShoplingDirectRun(2);
  progress = recordShoplingDirectRunOutcome(progress, "job-1", "SUCCEEDED");
  const duplicate = recordShoplingDirectRunOutcome(
    progress,
    "job-1",
    "SUCCEEDED",
  );

  assert.equal(duplicate, progress);
  assert.deepEqual(shoplingDirectRunCounts(duplicate), {
    total: 2,
    completed: 1,
    succeeded: 1,
    failed: 0,
    uncertain: 0,
    remaining: 1,
  });
});

test("failure or uncertainty ends with a clear stopped summary", () => {
  let progress = startShoplingDirectRun(2);
  progress = recordShoplingDirectRunOutcome(progress, "job-1", "SUCCEEDED");
  progress = recordShoplingDirectRunOutcome(progress, "job-2", "FAILED");
  progress = finalizeShoplingDirectRun(progress);

  assert.equal(progress.status, "STOPPED");
  assert.equal(
    shoplingDirectRunSummaryText(progress),
    "작업 중단 · 성공 1/2건 · 실패·확인 필요 1건 · 미시작 0건",
  );
});

test("finalizing before every B-code starts reports the remaining count", () => {
  let progress = startShoplingDirectRun(2);
  progress = recordShoplingDirectRunOutcome(progress, "job-1", "SUCCEEDED");
  progress = finalizeShoplingDirectRun(progress, true);

  assert.equal(progress.status, "STOPPED");
  assert.equal(
    shoplingDirectRunSummaryText(progress),
    "작업 중단 · 성공 1/2건 · 실패·확인 필요 0건 · 미시작 1건",
  );
});
