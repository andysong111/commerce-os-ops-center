import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  StorageSourcingBudgetSyncError,
  syncPreviousMonthRevenueToStorage,
} from "../src/lib/storageSourcingBudgetSync.ts";

const now = new Date("2026-09-14T00:30:00+09:00");
const env = {
  PRODUCT_MASTER_INTEGRATION_SECRET: "integration-secret-for-synthetic-test-only",
  STORAGE_ORGANIZATION_BASE_URL: "https://storage.test",
};
const revenue = (patch = {}) => ({
  month: "2026-08",
  revenueKrw: 1_000_001,
  frozenAt: "2026-09-01T00:00:00+09:00",
  fetchedRows: 321,
  chunkCount: 5,
  cached: true,
  ...patch,
});

function successfulTransport(seen, receiptPatch = {}) {
  return async (url, init) => {
    const body = JSON.parse(String(init.body));
    seen.push({ url, init, body });
    return Response.json({
      ok: true,
      action: "sync_previous_month_revenue",
      requestId: body.requestId,
      budgetMonth: "2026-09",
      sourceMonth: "2026-08",
      revenueKrw: 1_000_001,
      availableSpendWon: 500_001,
      allocationBps: 1200,
      maximumBps: 1500,
      monthlyBudgetWon: 60_000,
      monthlyItemCap: 20,
      version: 4,
      budgetPolicyVersion: "spending-ratio-auto-revenue-v2",
      changed: true,
      ...receiptPatch,
    });
  };
}

test("bridge reads the previous Seoul calendar month and sends only frozen Shopling revenue evidence", async () => {
  const seen = [];
  const months = [];
  const result = await syncPreviousMonthRevenueToStorage({
    now,
    env,
    revenueLoader: async (month) => {
      months.push(month);
      return revenue();
    },
    transport: successfulTransport(seen),
  });
  assert.deepEqual(months, ["2026-08"]);
  assert.equal(result.availableSpendWon, 500_001);
  assert.equal(result.monthlyBudgetWon, 60_000);
  assert.equal(result.monthlyItemCap, 20);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "https://storage.test/api/sourcing-intake");
  assert.equal(
    seen[0].init.headers["x-commerce-os-integration-secret"],
    env.PRODUCT_MASTER_INTEGRATION_SECRET,
  );
  assert.deepEqual(
    Object.keys(seen[0].body).sort(),
    [
      "action",
      "budgetMonth",
      "requestId",
      "revenueKrw",
      "sourceCached",
      "sourceChunkCount",
      "sourceEventId",
      "sourceFetchedRows",
      "sourceFrozenAt",
      "sourceMonth",
    ].sort(),
  );
  assert.equal(seen[0].body.sourceEventId, "shopling-calendar-month-revenue:2026-08");
  assert.match(seen[0].body.requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal("monthlyBudgetWon" in seen[0].body, false);
  assert.equal("allocationBps" in seen[0].body, false);
  assert.equal("monthlyItemCap" in seen[0].body, false);
});

test("same frozen evidence generates the same exact request ID for safe dispatcher retries", async () => {
  const ids = [];
  const transport = async (_url, init) => {
    const body = JSON.parse(String(init.body));
    ids.push(body.requestId);
    return Response.json({
      ok: true,
      action: "sync_previous_month_revenue",
      requestId: body.requestId,
      budgetMonth: "2026-09",
      sourceMonth: "2026-08",
      revenueKrw: 1_000_001,
      availableSpendWon: 500_001,
      allocationBps: 1200,
      maximumBps: 1500,
      monthlyBudgetWon: 60_000,
      monthlyItemCap: 20,
      version: 4,
      budgetPolicyVersion: "spending-ratio-auto-revenue-v2",
      changed: ids.length === 1,
    });
  };
  const args = { now, env, revenueLoader: async () => revenue(), transport };
  await syncPreviousMonthRevenueToStorage(args);
  await syncPreviousMonthRevenueToStorage(args);
  assert.equal(ids.length, 2);
  assert.equal(ids[0], ids[1]);
});

test("bridge fails closed before Shopling access when server integration secret is missing", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      syncPreviousMonthRevenueToStorage({
        now,
        env: {},
        revenueLoader: async () => {
          calls += 1;
          return revenue();
        },
      }),
    (error) => {
      assert.equal(error instanceof StorageSourcingBudgetSyncError, true);
      assert.equal(error.code, "STORAGE_SOURCING_INTEGRATION_NOT_CONFIGURED");
      return true;
    },
  );
  assert.equal(calls, 0);
});

test("wrong month or missing frozen Shopling evidence cannot become a sourcing budget", async () => {
  for (const bad of [
    revenue({ month: "2026-09" }),
    revenue({ frozenAt: null }),
    revenue({ revenueKrw: -1 }),
  ]) {
    let transportCalls = 0;
    await assert.rejects(() =>
      syncPreviousMonthRevenueToStorage({
        now,
        env,
        revenueLoader: async () => bad,
        transport: async () => {
          transportCalls += 1;
          return Response.json({});
        },
      }),
    );
    assert.equal(transportCalls, 0);
  }
});

test("bridge rejects a Storage receipt that disagrees with revenue-half, 12percent or 20-item contract", async () => {
  for (const patch of [
    { availableSpendWon: 500_000 },
    { monthlyBudgetWon: 60_001 },
    { monthlyItemCap: 19 },
    { allocationBps: 1500 },
    { budgetPolicyVersion: "old" },
    { sourceMonth: "2026-07" },
  ]) {
    await assert.rejects(
      () =>
        syncPreviousMonthRevenueToStorage({
          now,
          env,
          revenueLoader: async () => revenue(),
          transport: successfulTransport([], patch),
        }),
      (error) => {
        assert.equal(error instanceof StorageSourcingBudgetSyncError, true);
        assert.equal(error.code, "STORAGE_SOURCING_SYNC_ACK_MISMATCH");
        return true;
      },
    );
  }
});

test("Storage application errors remain explicit and are not accepted as successful budget sync", async () => {
  await assert.rejects(
    () =>
      syncPreviousMonthRevenueToStorage({
        now,
        env,
        revenueLoader: async () => revenue(),
        transport: async () =>
          Response.json(
            { ok: false, error: "FROZEN_REVENUE_CONFLICT", message: "기준매출 충돌" },
            { status: 409 },
          ),
      }),
    (error) => {
      assert.equal(error.code, "FROZEN_REVENUE_CONFLICT");
      assert.equal(error.status, 409);
      return true;
    },
  );
});

test("budget sync reuses the existing dispatcher maintenance task and never adds a second Vercel heartbeat", async () => {
  const route = await readFile(
    new URL("../src/app/api/cron/ops-storage-maintenance/route.ts", import.meta.url),
    "utf8",
  );
  const vercel = JSON.parse(
    await readFile(new URL("../vercel.json", import.meta.url), "utf8"),
  );
  assert.match(route, /syncPreviousMonthRevenueToStorage/);
  assert.match(route, /sourcing budget sync failed/);
  assert.match(route, /sourcingBudget/);
  assert.doesNotMatch(route, /ORDERED|payment|1688.*order/i);
  assert.deepEqual(vercel.crons, [
    { path: "/api/cron/ops-dispatcher", schedule: "* * * * *" },
  ]);
});
