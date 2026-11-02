export type ShoplingDirectRunTerminalOutcome =
  | "SUCCEEDED"
  | "FAILED"
  | "UNCERTAIN";

export type ShoplingDirectRunProgress = {
  status: "RUNNING" | "COMPLETED" | "STOPPED";
  total: number;
  outcomesByJobId: Record<string, ShoplingDirectRunTerminalOutcome>;
};

export type ShoplingDirectRunCounts = {
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
  uncertain: number;
  remaining: number;
};

export function startShoplingDirectRun(total: number): ShoplingDirectRunProgress {
  return {
    status: "RUNNING",
    total: Math.max(0, Math.trunc(total)),
    outcomesByJobId: {},
  };
}

export function recordShoplingDirectRunOutcome(
  current: ShoplingDirectRunProgress,
  jobId: string,
  outcome: ShoplingDirectRunTerminalOutcome,
): ShoplingDirectRunProgress {
  const normalizedJobId = jobId.trim();
  if (!normalizedJobId || current.outcomesByJobId[normalizedJobId]) {
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
  const allSucceeded =
    counts.total > 0 &&
    counts.succeeded === counts.total &&
    counts.failed === 0 &&
    counts.uncertain === 0;
  return {
    ...current,
    status: !forceStopped && allSucceeded ? "COMPLETED" : "STOPPED",
  };
}

export function shoplingDirectRunSummaryText(
  current: ShoplingDirectRunProgress,
) {
  const counts = shoplingDirectRunCounts(current);
  if (current.status === "COMPLETED") {
    return `전체 작업 끝남 · Shopling 전송 접수 완료 ${counts.succeeded}/${counts.total}건`;
  }
  if (current.status === "STOPPED") {
    return `작업 중단 · 성공 ${counts.succeeded}/${counts.total}건 · 실패·확인 필요 ${counts.failed + counts.uncertain}건 · 미시작 ${counts.remaining}건`;
  }
  return `Shopling 전송 접수 진행 중 · ${counts.completed}/${counts.total}건 완료`;
}
