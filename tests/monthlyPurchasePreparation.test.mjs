import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  monthlyPurchasePreparationDecision,
  validateMonthlyPurchasePreparationSchedule,
} from "../src/lib/monthlyPurchasePreparationCore.ts";

const schedule = validateMonthlyPurchasePreparationSchedule(
  { enabled: true, dayOfMonth: 12, startHour: 6 },
  new Date("2026-10-13T00:00:00.000Z"),
);

test("monthly preparation validates a guaranteed calendar day and Seoul start hour", () => {
  assert.deepEqual(schedule, {
    enabled: true,
    dayOfMonth: 12,
    startHour: 6,
    timeZone: "Asia/Seoul",
    updatedAt: "2026-10-13T00:00:00.000Z",
  });
  for (const dayOfMonth of [0, 29, 31, 1.5]) {
    assert.throws(
      () => validateMonthlyPurchasePreparationSchedule({ dayOfMonth, startHour: 6 }),
      /MONTHLY_PURCHASE_PREPARATION_DAY_INVALID/,
    );
  }
  for (const startHour of [-1, 24, 6.5]) {
    assert.throws(
      () => validateMonthlyPurchasePreparationSchedule({ dayOfMonth: 12, startHour }),
      /MONTHLY_PURCHASE_PREPARATION_HOUR_INVALID/,
    );
  }
});

test("monthly preparation waits until the configured Seoul time and becomes due once", () => {
  const before = monthlyPurchasePreparationDecision({
    schedule,
    lastRun: null,
    now: new Date("2026-11-11T20:59:59.000Z"),
  });
  assert.equal(before.due, false);
  assert.equal(before.reason, "BEFORE_SCHEDULE");
  assert.equal(before.nextScheduledAt, "2026-11-11T21:00:00.000Z");

  const due = monthlyPurchasePreparationDecision({
    schedule,
    lastRun: null,
    now: new Date("2026-11-11T21:00:00.000Z"),
  });
  assert.equal(due.due, true);
  assert.equal(due.cycleMonth, "2026-11");

  const alreadyRan = monthlyPurchasePreparationDecision({
    schedule,
    lastRun: {
      cycleMonth: "2026-11",
      requestId: "request-1",
      analysisAsOf: "2026-11-11T21:00:00.000Z",
      accepted: true,
      startedAt: "2026-11-11T21:00:00.000Z",
    },
    now: new Date("2026-11-12T03:00:00.000Z"),
  });
  assert.equal(alreadyRan.due, false);
  assert.equal(alreadyRan.reason, "ALREADY_RAN");
  assert.equal(alreadyRan.nextScheduledAt, "2026-12-11T21:00:00.000Z");
});

test("disabled or missing schedules never start work", () => {
  assert.equal(
    monthlyPurchasePreparationDecision({ schedule: null, lastRun: null }).reason,
    "NOT_CONFIGURED",
  );
  assert.equal(
    monthlyPurchasePreparationDecision({
      schedule: { ...schedule, enabled: false },
      lastRun: null,
    }).reason,
    "DISABLED",
  );
});

test("automatic preparation reuses stable evidence, rereads 45 days, and stops before Product Master promotion", async () => {
  const [cron, sync, route, control] = await Promise.all([
    readFile("src/app/api/cron/monthly-purchase-preparation/route.ts", "utf8"),
    readFile("src/lib/productMasterShoplingSalesEventSync.ts", "utf8"),
    readFile("src/app/api/purchase-cycle/preparation-schedule/route.ts", "utf8"),
    readFile(
      "src/components/purchase-cycle-preflight/PurchasePreparationScheduleControl.tsx",
      "utf8",
    ),
  ]);
  assert.match(cron, /ensureMonthlyPurchasePreparationSalesRequest/);
  assert.match(cron, /writesEnabled: false/);
  assert.match(cron, /approvalEnabled: false/);
  assert.doesNotMatch(cron, /applyProductMasterShoplingSalesEvents|1688|payment/i);
  assert.doesNotMatch(cron, /stage8-candidate-prewrite-evidence/);
  assert.match(sync, /refreshReason: "MONTHLY_PURCHASE_PREPARATION"/);
  assert.match(sync, /MONTHLY_PURCHASE_PREPARATION_CORRECTION_DAYS = 45/);
  assert.match(sync, /buildMonthlySalesEventReusePlan/);
  assert.match(sync, /sales-event-monthly-reuse-chunk:/);
  assert.match(sync, /STABLE_BEFORE_45_DAY_CORRECTION_WINDOW/);
  assert.match(sync, /alreadyActive: true/);
  assert.match(sync, /withSalesEventMutationGuard/);
  assert.doesNotMatch(
    sync.slice(
      sync.indexOf("export async function ensureMonthlyPurchasePreparationSalesRequest"),
      sync.indexOf("// Server-only inventory caller"),
    ),
    /applyProductMasterShoplingSalesEvents/,
  );
  assert.match(route, /isSameOriginOpsRequest/);
  assert.match(control, /실제 원장 반영은 별도 승인 단계에서 진행/);
  assert.match(control, /최근 45일만 다시 읽어/);
});
