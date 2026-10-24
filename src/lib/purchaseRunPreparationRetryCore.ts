export type PurchaseRunRetryTracker = {
  signature: string | null;
  identicalFailureCount: number;
};

export type PurchaseRunRetrySample = {
  stage?: string | null;
  progress?: number | null;
  code?: string | null;
  retryableFailure?: boolean;
};

export type PurchaseRunRetryDecision = PurchaseRunRetryTracker & {
  stopAutomaticRetry: boolean;
  waitMs: number;
};

export const EMPTY_PURCHASE_RUN_RETRY_TRACKER: PurchaseRunRetryTracker = {
  signature: null,
  identicalFailureCount: 0,
};

/**
 * Normal preparation progress keeps a short polling cadence. Repeated
 * transport failures back off and then stop, so one unavailable dependency
 * cannot hammer the start API for minutes while looking like useful work.
 */
export function decidePurchaseRunRetry(
  previous: PurchaseRunRetryTracker,
  sample: PurchaseRunRetrySample,
  options: { maxIdenticalFailures?: number } = {},
): PurchaseRunRetryDecision {
  if (sample.retryableFailure !== true) {
    return {
      ...EMPTY_PURCHASE_RUN_RETRY_TRACKER,
      stopAutomaticRetry: false,
      waitMs: 1_000,
    };
  }

  const maxIdenticalFailures = Math.max(
    1,
    Math.min(10, Math.trunc(options.maxIdenticalFailures ?? 2)),
  );
  const signature = [
    String(sample.stage ?? "UNKNOWN"),
    String(Math.max(0, Math.min(100, Number(sample.progress) || 0))),
    String(sample.code ?? "TRANSIENT_SOURCE_READ_FAILED"),
  ].join(":");
  const identicalFailureCount = previous.signature === signature
    ? previous.identicalFailureCount + 1
    : 1;

  return {
    signature,
    identicalFailureCount,
    stopAutomaticRetry: identicalFailureCount >= maxIdenticalFailures,
    waitMs: Math.min(8_000, 1_500 * (2 ** (identicalFailureCount - 1))),
  };
}
