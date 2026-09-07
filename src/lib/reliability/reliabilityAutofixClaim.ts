type ClaimReliabilityAutofixOptions<T> = {
  findExisting: () => Promise<T | null>;
  claimFresh: () => Promise<T | null>;
};

export type ClaimReliabilityAutofixResult<T> = {
  job: T | null;
  recovered: boolean;
};

/**
 * Claim delivery can time out after Postgres has already committed the claim.
 * A blind retry could therefore claim a second job. This helper makes the
 * caller's run idempotent by checking for an existing claim before claiming and
 * again after an ambiguous failure/null response.
 */
export async function claimReliabilityAutofixIdempotently<T>({
  findExisting,
  claimFresh,
}: ClaimReliabilityAutofixOptions<T>): Promise<ClaimReliabilityAutofixResult<T>> {
  // If this lookup fails, do not attempt a fresh claim: we cannot prove this run
  // does not already own a job.
  const existing = await findExisting();
  if (existing) return { job: existing, recovered: true };

  try {
    const fresh = await claimFresh();
    if (fresh) return { job: fresh, recovered: false };

    // A null response is rare but still ambiguous enough to re-check ownership
    // before reporting that no work exists.
    const recovered = await findExisting();
    return { job: recovered, recovered: Boolean(recovered) };
  } catch (error) {
    // The claim RPC may have committed even when its HTTP response timed out.
    // Recover the claim by the same repository + GitHub run id instead of
    // retrying the mutating RPC.
    try {
      const recovered = await findExisting();
      if (recovered) return { job: recovered, recovered: true };
    } catch {
      // Preserve the original claim error; the next scheduler run can retry
      // after the server-side claim lease expires.
    }
    throw error;
  }
}
