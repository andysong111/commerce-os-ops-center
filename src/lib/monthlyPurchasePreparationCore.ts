const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;

export type MonthlyPurchasePreparationSchedule = {
  enabled: boolean;
  dayOfMonth: number;
  startHour: number;
  timeZone: "Asia/Seoul";
  updatedAt: string;
};

export type MonthlyPurchasePreparationRun = {
  cycleMonth: string;
  requestId: string;
  analysisAsOf: string | null;
  accepted: boolean;
  startedAt: string;
};

function integer(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}

export function validateMonthlyPurchasePreparationSchedule(input: {
  enabled?: unknown;
  dayOfMonth?: unknown;
  startHour?: unknown;
}, now = new Date()): MonthlyPurchasePreparationSchedule {
  const dayOfMonth = integer(input.dayOfMonth);
  const startHour = integer(input.startHour);
  if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 28) {
    throw new Error("MONTHLY_PURCHASE_PREPARATION_DAY_INVALID");
  }
  if (!Number.isInteger(startHour) || startHour < 0 || startHour > 23) {
    throw new Error("MONTHLY_PURCHASE_PREPARATION_HOUR_INVALID");
  }
  if (!Number.isFinite(now.valueOf())) {
    throw new Error("MONTHLY_PURCHASE_PREPARATION_TIME_INVALID");
  }
  return {
    enabled: input.enabled !== false,
    dayOfMonth,
    startHour,
    timeZone: "Asia/Seoul",
    updatedAt: now.toISOString(),
  };
}

function seoulParts(now: Date) {
  const shifted = new Date(now.valueOf() + SEOUL_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
  };
}

function scheduledInstant(year: number, month: number, schedule: MonthlyPurchasePreparationSchedule) {
  return new Date(
    Date.UTC(year, month - 1, schedule.dayOfMonth, schedule.startHour) -
      SEOUL_OFFSET_MS,
  );
}

export function monthlyPurchasePreparationDecision(input: {
  schedule: MonthlyPurchasePreparationSchedule | null;
  lastRun: MonthlyPurchasePreparationRun | null;
  now?: Date;
}) {
  const now = input.now ? new Date(input.now.valueOf()) : new Date();
  if (!Number.isFinite(now.valueOf())) {
    throw new Error("MONTHLY_PURCHASE_PREPARATION_TIME_INVALID");
  }
  if (!input.schedule?.enabled) {
    return {
      due: false,
      cycleMonth: null,
      scheduledAt: null,
      nextScheduledAt: null,
      reason: input.schedule ? "DISABLED" : "NOT_CONFIGURED",
    } as const;
  }

  const parts = seoulParts(now);
  const cycleMonth = `${parts.year}-${String(parts.month).padStart(2, "0")}`;
  const thisMonthAt = scheduledInstant(parts.year, parts.month, input.schedule);
  const alreadyRan = input.lastRun?.cycleMonth === cycleMonth;
  if (!alreadyRan && now.valueOf() >= thisMonthAt.valueOf()) {
    return {
      due: true,
      cycleMonth,
      scheduledAt: thisMonthAt.toISOString(),
      nextScheduledAt: thisMonthAt.toISOString(),
      reason: "DUE",
    } as const;
  }

  const nextMonthIndex = alreadyRan || now.valueOf() >= thisMonthAt.valueOf()
    ? parts.month
    : parts.month - 1;
  const nextAt = scheduledInstant(
    parts.year + Math.floor(nextMonthIndex / 12),
    (nextMonthIndex % 12) + 1,
    input.schedule,
  );
  return {
    due: false,
    cycleMonth,
    scheduledAt: thisMonthAt.toISOString(),
    nextScheduledAt: nextAt.toISOString(),
    reason: alreadyRan ? "ALREADY_RAN" : "BEFORE_SCHEDULE",
  } as const;
}
