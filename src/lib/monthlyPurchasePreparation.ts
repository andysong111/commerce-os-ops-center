import { randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  monthlyPurchasePreparationDecision,
  validateMonthlyPurchasePreparationSchedule,
  type MonthlyPurchasePreparationRun,
  type MonthlyPurchasePreparationSchedule,
} from "@/lib/monthlyPurchasePreparationCore";

export {
  monthlyPurchasePreparationDecision,
  validateMonthlyPurchasePreparationSchedule,
};
export type {
  MonthlyPurchasePreparationRun,
  MonthlyPurchasePreparationSchedule,
};

export const MONTHLY_PURCHASE_PREPARATION_SCHEDULE =
  "MONTHLY_PURCHASE_PREPARATION_SCHEDULE";
export const MONTHLY_PURCHASE_PREPARATION_RUN =
  "MONTHLY_PURCHASE_PREPARATION_RUN";
export const MONTHLY_PURCHASE_PREPARATION_MAX_SOURCE_AGE_MS =
  2 * 60 * 60 * 1000;

type OperationRow = {
  input_snapshot?: unknown;
  result_snapshot?: unknown;
  started_at?: unknown;
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function iso(value: unknown) {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function scheduleFromRow(row: OperationRow | null) {
  if (!row) return null;
  const snapshot = object(row.input_snapshot);
  try {
    return validateMonthlyPurchasePreparationSchedule(
      {
        enabled: snapshot.enabled,
        dayOfMonth: snapshot.dayOfMonth,
        startHour: snapshot.startHour,
      },
      new Date(iso(snapshot.updatedAt) ?? iso(row.started_at) ?? ""),
    );
  } catch {
    return null;
  }
}

function runFromRow(row: OperationRow | null) {
  if (!row) return null;
  const snapshot = object(row.result_snapshot);
  const cycleMonth = String(snapshot.cycleMonth ?? "").trim();
  const requestId = String(snapshot.requestId ?? "").trim();
  const startedAt = iso(snapshot.startedAt) ?? iso(row.started_at);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(cycleMonth) || !requestId || !startedAt) {
    return null;
  }
  return {
    cycleMonth,
    requestId,
    analysisAsOf: iso(snapshot.analysisAsOf),
    accepted: snapshot.accepted === true,
    startedAt,
  } satisfies MonthlyPurchasePreparationRun;
}

async function latestOperation(operationType: string) {
  const admin = await createSupabaseAdminClient();
  if (!admin) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  const result = await admin
    .from("commerce_operation_runs")
    .select("input_snapshot,result_snapshot,started_at")
    .eq("operation_type", operationType)
    .order("started_at", { ascending: false })
    .limit(1);
  if (result.error) throw new Error(result.error.message);
  const rows = Array.isArray(result.data) ? result.data : [];
  return (rows[0] ?? null) as OperationRow | null;
}

export async function loadMonthlyPurchasePreparationState(now = new Date()) {
  const [scheduleRow, runRow] = await Promise.all([
    latestOperation(MONTHLY_PURCHASE_PREPARATION_SCHEDULE),
    latestOperation(MONTHLY_PURCHASE_PREPARATION_RUN),
  ]);
  const schedule = scheduleFromRow(scheduleRow);
  const lastRun = runFromRow(runRow);
  return {
    schedule,
    lastRun,
    decision: monthlyPurchasePreparationDecision({ schedule, lastRun, now }),
  };
}

async function storeOperation(input: {
  operationType: string;
  inputSnapshot: Record<string, unknown>;
  resultSnapshot: Record<string, unknown>;
  occurredAt: string;
}) {
  const admin = await createSupabaseAdminClient();
  if (!admin) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  const sourceEventId = `${input.operationType.toLowerCase()}:${randomUUID()}`;
  const result = await admin.from("commerce_operation_runs").insert([
    {
      operation_type: input.operationType,
      status: "SUCCEEDED",
      source: "ops-center-monthly-purchase-preparation",
      source_event_id: sourceEventId,
      correlation_id: `monthly-purchase-preparation:${sourceEventId}`,
      actor_type: "SYSTEM",
      input_snapshot: input.inputSnapshot,
      result_snapshot: input.resultSnapshot,
      error_message: null,
      started_at: input.occurredAt,
      finished_at: input.occurredAt,
      updated_at: input.occurredAt,
    },
  ]);
  if (result.error) throw new Error(result.error.message);
}

export async function saveMonthlyPurchasePreparationSchedule(input: {
  enabled?: unknown;
  dayOfMonth?: unknown;
  startHour?: unknown;
}, now = new Date()) {
  const schedule = validateMonthlyPurchasePreparationSchedule(input, now);
  await storeOperation({
    operationType: MONTHLY_PURCHASE_PREPARATION_SCHEDULE,
    inputSnapshot: schedule,
    resultSnapshot: { saved: true, writesBusinessData: false },
    occurredAt: schedule.updatedAt,
  });
  return schedule;
}

export async function recordMonthlyPurchasePreparationRun(
  input: Omit<MonthlyPurchasePreparationRun, "startedAt">,
  now = new Date(),
) {
  const startedAt = now.toISOString();
  const run = { ...input, startedAt } satisfies MonthlyPurchasePreparationRun;
  await storeOperation({
    operationType: MONTHLY_PURCHASE_PREPARATION_RUN,
    inputSnapshot: { cycleMonth: input.cycleMonth },
    resultSnapshot: run,
    occurredAt: startedAt,
  });
  return run;
}
