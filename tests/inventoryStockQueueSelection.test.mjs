import assert from "node:assert/strict";
import test from "node:test";

import { selectExactShoplingStockQueueJob } from "../src/lib/shoplingStockQueueSelection.ts";

const target = {
  jobId: "stock-sync:BBB4-3:2026-10-28T11:40:33.000Z",
  barcode: "BBB4-3",
  desiredStatus: "SOLD_OUT",
  desiredSince: "2026-10-28T11:40:33.000Z",
};

function job(overrides = {}) {
  return { ...target, productName: "욕실 스프레이건", ...overrides };
}

test("single queue execution selects only the exact fresh BBB4-3 job", () => {
  const jobs = [
    job({ jobId: "older", barcode: "BCC6-2", desiredSince: "2026-10-07T08:06:36.000Z" }),
    job(),
  ];
  assert.equal(selectExactShoplingStockQueueJob(jobs, target), jobs[1]);
});

test("single queue execution fails closed when the desired state changed", () => {
  assert.throws(
    () => selectExactShoplingStockQueueJob([job({ desiredStatus: "ON_SALE" })], target),
    /상태가 바뀌었거나 대기건에서 사라져/,
  );
});

test("single queue execution fails closed when the transition timestamp changed", () => {
  assert.throws(
    () => selectExactShoplingStockQueueJob([job({ desiredSince: "2026-10-28T12:00:00.000Z" })], target),
    /단건 실행하지 않았습니다/,
  );
});

test("single queue execution rejects duplicate exact matches", () => {
  assert.throws(
    () => selectExactShoplingStockQueueJob([job(), job()], target),
    /동일 작업이 2건/,
  );
});

test("operational queue UI fresh-reads, runs one row, and does not continue draining", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile("src/components/china-order-manager/StockSyncOperationalQueuePanel.tsx", "utf8"),
  );
  assert.match(source, /const payload = await loadQueue\(\)/);
  assert.match(source, /selectExactShoplingStockQueueJob\(available, requested\)/);
  assert.match(source, /requestedSingleRun\.current = null;[\s\S]*continueAfterBatch\.current = false;[\s\S]*SINGLE_DONE/);
  assert.match(source, /onClick=\{\(\) => void startOne\(job\)\}/);
  assert.match(source, /이 건만 처리/);
});
