export type ProductDecisionResumeStatus = {
  state: "IDLE" | "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
  lastActivityAt?: string | null;
  analysisAsOf?: string | null;
};

export const PRODUCT_DECISION_ACTIVE_RESUME_MAX_AGE_MS = 30 * 60 * 1000;
export const PRODUCT_DECISION_FUTURE_ACTIVITY_TOLERANCE_MS = 5 * 60 * 1000;

export function shouldReuseProductDecisionLiveStatus(
  status: ProductDecisionResumeStatus,
  options: {
    nowMs: number;
    completedMaxAgeMs: number;
    activeMaxAgeMs?: number;
    futureToleranceMs?: number;
  },
) {
  const lastActivityMs = Date.parse(String(
    status.lastActivityAt ?? status.analysisAsOf ?? "",
  ));
  if (!Number.isFinite(lastActivityMs)) return false;

  const rawAgeMs = options.nowMs - lastActivityMs;
  const futureToleranceMs = Math.max(
    0,
    Number(
      options.futureToleranceMs ??
        PRODUCT_DECISION_FUTURE_ACTIVITY_TOLERANCE_MS,
    ),
  );
  if (rawAgeMs < -futureToleranceMs) return false;

  // A chunk can finish after another overlapping request captured its clock.
  // Treat a small future timestamp as current activity instead of abandoning
  // an almost-complete request and restarting all Shopling ranges.
  const ageMs = Math.max(0, rawAgeMs);
  if (status.state === "QUEUED" || status.state === "RUNNING") {
    return ageMs <= Math.max(
      0,
      Number(
        options.activeMaxAgeMs ?? PRODUCT_DECISION_ACTIVE_RESUME_MAX_AGE_MS,
      ),
    );
  }
  return status.state === "COMPLETED" &&
    ageMs <= Math.max(0, Number(options.completedMaxAgeMs));
}
