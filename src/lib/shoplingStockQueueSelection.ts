export type ShoplingStockQueueSelection = {
  jobId: string;
  barcode: string;
  desiredStatus: "SOLD_OUT" | "ON_SALE";
  desiredSince: string;
};

export function selectExactShoplingStockQueueJob<T extends ShoplingStockQueueSelection>(
  jobs: readonly T[],
  requested: ShoplingStockQueueSelection,
): T {
  const matches = jobs.filter(
    (job) =>
      job.jobId === requested.jobId &&
      job.barcode === requested.barcode &&
      job.desiredStatus === requested.desiredStatus &&
      job.desiredSince === requested.desiredSince,
  );

  if (matches.length === 1) return matches[0];

  if (matches.length > 1) {
    throw new Error(
      `${requested.barcode} 최신 운영 큐에서 동일 작업이 ${matches.length}건이라 단건 실행을 중단했습니다.`,
    );
  }

  throw new Error(
    `${requested.barcode} 운영 큐 상태가 바뀌었거나 대기건에서 사라져 단건 실행하지 않았습니다. 큐를 새로고침해 주세요.`,
  );
}
