import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { planShoplingStockLaunch } from "../src/lib/shoplingStockLaunchPlan.ts";

const sameModelIncident = [
  {
    jobId: "bde7-1",
    barcode: "BDE7-1",
    productKind: "OPTION",
    modelNo: "AAA115",
    desiredStatus: "SOLD_OUT",
  },
  {
    jobId: "bde7-3",
    barcode: "BDE7-3",
    productKind: "OPTION",
    modelNo: "AAA115",
    desiredStatus: "SOLD_OUT",
  },
];

test("HF91 assigns only the first B-code even when same-model options are queued together", () => {
  const plan = planShoplingStockLaunch(sameModelIncident, "0.6.53");
  assert.equal(plan.mode, "SINGLE");
  assert.deepEqual(plan.jobs.map((job) => job.barcode), ["BDE7-1"]);
  assert.equal(plan.compatibilitySerial, true);
});

test("both Commerce OS launch surfaces send one plain B-code job per extension START", async () => {
  const [direct, queue] = await Promise.all([
    readFile(
      "src/components/china-order-manager/InventoryStockoutOperatorPanel.tsx",
      "utf8",
    ),
    readFile(
      "src/components/china-order-manager/StockSyncOperationalQueuePanel.tsx",
      "utf8",
    ),
  ]);

  for (const source of [direct, queue]) {
    assert.match(source, /const assignedJobs = plan\.jobs\.slice\(0, 1\)/);
    assert.match(source, /strictSingleBcodeDispatch: true/);
    assert.match(source, /job: prepared\[0\]/);
    assert.doesNotMatch(source, /selectShoplingCoalescedJobs/);
    assert.doesNotMatch(source, /coalescedJobs: prepared/);
  }
});

test("direct input removes the terminal B-code before scheduling the next idle-gated launch", async () => {
  const source = await readFile(
    "src/components/china-order-manager/InventoryStockoutOperatorPanel.tsx",
    "utf8",
  );
  const removeCompleted = source.indexOf(
    "directQueue.current = directQueue.current.filter",
  );
  const releaseBatch = source.indexOf("activeBatch.current = null", removeCompleted);
  const scheduleNext = source.indexOf("void launchNextRef.current()", releaseBatch);
  const idleBarrier = source.indexOf("await waitForShoplingStockIdle()");
  const startedRecord = source.indexOf('"STARTED"', idleBarrier);

  assert.ok(removeCompleted >= 0);
  assert.ok(releaseBatch > removeCompleted);
  assert.ok(scheduleNext > releaseBatch);
  assert.ok(idleBarrier >= 0);
  assert.ok(startedRecord > idleBarrier);
});
