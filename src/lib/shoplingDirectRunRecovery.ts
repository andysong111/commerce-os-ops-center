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

  return jobs.length ? { requestId, jobs } : null;
}
