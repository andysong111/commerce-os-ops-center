export type ShoplingDirectRunTerminalOutcome =
  | "SUCCEEDED"
  | "FAILED"
  | "UNCERTAIN";

export type ShoplingDirectRunAttempt = 1 | 2 | 3;

export type ShoplingDirectRunProgress = {
  status: "RUNNING" | "COMPLETED" | "COMPLETED_WITH_EXCEPTIONS" | "STOPPED";
  total: number;
  outcomesByJobId: Record<string, ShoplingDirectRunTerminalOutcome>;
  attempt?: ShoplingDirectRunAttempt;
};

export type ShoplingDirectRunCounts = {
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
  uncertain: number;
  remaining: number;
};

export function startShoplingDirectRun(
  total: number,
  attempt: ShoplingDirectRunAttempt = 1,
): ShoplingDirectRunProgress {
  return {
    status: "RUNNING",
    total: Math.max(0, Math.trunc(total)),
    outcomesByJobId: {},
    attempt,
  };
}

export function shoplingDirectRunAttempt(current: ShoplingDirectRunProgress) {
  return current.attempt ?? 1;
}

export function retryableShoplingDirectRunJobIds(
  current: ShoplingDirectRunProgress,
  allJobIds: string[],
) {
  return [...new Set(allJobIds.map((jobId) => jobId.trim()).filter(Boolean))]
    .filter((jobId) => current.outcomesByJobId[jobId] !== "SUCCEEDED");
}

export function canRetryShoplingDirectRun(
  current: ShoplingDirectRunProgress,
  allJobIds: string[],
) {
  return (
    current.status !== "RUNNING" &&
    shoplingDirectRunAttempt(current) < 3 &&
    retryableShoplingDirectRunJobIds(current, allJobIds).length > 0
  );
}

export function prepareShoplingDirectRunRetry(
  current: ShoplingDirectRunProgress,
  allJobIds: string[],
): ShoplingDirectRunProgress {
  const uniqueJobIds = [
    ...new Set(allJobIds.map((jobId) => jobId.trim()).filter(Boolean)),
  ];
  const nextAttempt = Math.min(
    3,
    shoplingDirectRunAttempt(current) + 1,
  ) as ShoplingDirectRunAttempt;
  const succeededOutcomes = Object.fromEntries(
    uniqueJobIds
      .filter((jobId) => current.outcomesByJobId[jobId] === "SUCCEEDED")
      .map((jobId) => [jobId, "SUCCEEDED" as const]),
  );

  return {
    status: "RUNNING",
    total: uniqueJobIds.length,
    outcomesByJobId: succeededOutcomes,
    attempt: nextAttempt,
  };
}

export function recordShoplingDirectRunOutcome(
  current: ShoplingDirectRunProgress,
  jobId: string,
  outcome: ShoplingDirectRunTerminalOutcome,
): ShoplingDirectRunProgress {
  const normalizedJobId = jobId.trim();
  if (
    !normalizedJobId ||
    current.outcomesByJobId[normalizedJobId] === "SUCCEEDED"
  ) {
    return current;
  }

  return {
    ...current,
    outcomesByJobId: {
      ...current.outcomesByJobId,
      [normalizedJobId]: outcome,
    },
  };
}

export function shoplingDirectRunCounts(
  current: ShoplingDirectRunProgress,
): ShoplingDirectRunCounts {
  const outcomes = Object.values(current.outcomesByJobId).slice(0, current.total);
  const succeeded = outcomes.filter((outcome) => outcome === "SUCCEEDED").length;
  const failed = outcomes.filter((outcome) => outcome === "FAILED").length;
  const uncertain = outcomes.filter((outcome) => outcome === "UNCERTAIN").length;
  const completed = succeeded + failed + uncertain;
  return {
    total: current.total,
    completed,
    succeeded,
    failed,
    uncertain,
    remaining: Math.max(0, current.total - completed),
  };
}

export function finalizeShoplingDirectRun(
  current: ShoplingDirectRunProgress,
  forceStopped = false,
): ShoplingDirectRunProgress {
  const counts = shoplingDirectRunCounts(current);
  const allTerminal = counts.total > 0 && counts.completed === counts.total;
  const allSucceeded =
    allTerminal &&
    counts.succeeded === counts.total &&
    counts.failed === 0 &&
    counts.uncertain === 0;
  return {
    ...current,
    status: forceStopped || !allTerminal
      ? "STOPPED"
      : allSucceeded
        ? "COMPLETED"
        : "COMPLETED_WITH_EXCEPTIONS",
  };
}

export function canRetryUnstartedShoplingDirectRun(
  current: ShoplingDirectRunProgress,
) {
  const counts = shoplingDirectRunCounts(current);
  return (
    current.status === "STOPPED" &&
    counts.remaining > 0 &&
    counts.failed === 0 &&
    counts.uncertain === 0
  );
}

export function shoplingDirectRunSummaryText(
  current: ShoplingDirectRunProgress,
) {
  const counts = shoplingDirectRunCounts(current);
  if (current.status === "COMPLETED") {
    return `전체 작업 끝남 · Shopling 전송 접수 완료 ${counts.succeeded}/${counts.total}건`;
  }
  if (current.status === "COMPLETED_WITH_EXCEPTIONS") {
    return `전체 시도 끝남 · 성공 ${counts.succeeded}/${counts.total}건 · 실패·확인 필요 ${counts.failed + counts.uncertain}건`;
  }
  if (current.status === "STOPPED") {
    return `작업 중단 · 성공 ${counts.succeeded}/${counts.total}건 · 실패·확인 필요 ${counts.failed + counts.uncertain}건 · 미시작 ${counts.remaining}건`;
  }
  return `Shopling 전송 접수 진행 중 · ${counts.completed}/${counts.total}건 완료`;
}
