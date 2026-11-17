export type ShoplingBatchCoalescingJob = {
  jobId: string;
  barcode: string;
  productKind: "OPTION" | "SINGLE";
  modelNo: string | null;
  desiredStatus: "SOLD_OUT" | "ON_SALE";
};

function normalized(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim().toUpperCase();
}

/**
 * Option B-codes that belong to the same model and target state can safely
 * share one A21 option transmission only after every B-code API mutation has
 * completed. Single products and mixed target states remain independent.
 */
export function shoplingOptionCoalescingKey(
  job: ShoplingBatchCoalescingJob,
) {
  const modelNo = normalized(job.modelNo);
  if (job.productKind !== "OPTION" || !modelNo) return null;
  return ["OPTION", modelNo, job.desiredStatus].join(":");
}

export function selectShoplingCoalescedJobs<
  T extends ShoplingBatchCoalescingJob,
>(jobs: readonly T[], anchor: T, limit = 50): T[] {
  const anchorKey = shoplingOptionCoalescingKey(anchor);
  if (!anchorKey) return [anchor];
  const selected = jobs.filter(
    (job) => shoplingOptionCoalescingKey(job) === anchorKey,
  );
  return selected.slice(0, Math.max(1, limit));
}
