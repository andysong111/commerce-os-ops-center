export type RecoveredShoplingDirectJob = Record<string, unknown> & {
  jobId: string;
  barcode: string;
  retransmissionRequestId: string;
  directOperatorCommand: true;
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

export function recoverLatestPendingDirectJobs(payload: unknown): {
  requestId: string;
  jobs: RecoveredShoplingDirectJob[];
} | null {
  const root = object(payload);
  if (root.ok !== true) return null;

  const retransmission = object(root.retransmission);
  const latest = object(retransmission.latest);
  const requestId = text(latest.requestId);
  if (
    !requestId ||
    Number(latest.pendingCount) <= 0 ||
    Number(latest.startedCount) > 0 ||
    Number(latest.exceptionCount) > 0
  ) {
    return null;
  }

  const seen = new Set<string>();
  const jobs = (Array.isArray(root.jobs) ? root.jobs : []).flatMap((value) => {
    const job = object(value);
    const jobId = text(job.jobId);
    const barcode = text(job.barcode);
    if (
      !jobId ||
      !barcode ||
      seen.has(jobId) ||
      job.directOperatorCommand !== true ||
      text(job.retransmissionRequestId) !== requestId
    ) {
      return [];
    }
    seen.add(jobId);
    return [
      {
        ...job,
        jobId,
        barcode,
        retransmissionRequestId: requestId,
        directOperatorCommand: true as const,
      },
    ];
  });

  const pendingItems = Array.isArray(latest.items)
    ? latest.items.map(object).filter((item) => item.state === "PENDING") : null;
  if (!jobs.length && !requestId.startsWith("unified-command:") &&
      !pendingItems?.some((item) => item.directOperatorCommand === true)) return null;
  const pendingCount = Number(latest.pendingCount);
  if (jobs.length !== pendingCount || new Set(jobs.map((job) => job.barcode)).size !== pendingCount ||
      (pendingItems && (pendingItems.length !== pendingCount || jobs.some((job) => !pendingItems.some((item) =>
        item.jobId === job.jobId && item.barcode === job.barcode && item.desiredStatus === job.desiredStatus))))) {
    throw new Error(`저장된 실행의 대기 ${pendingCount}건과 복구된 전송 목록이 일치하지 않습니다. 운영 큐에서 해당 실행을 확인해 주세요.`);
  }
  return { requestId, jobs };
}
