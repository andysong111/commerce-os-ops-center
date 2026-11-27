type SaleStatus = "SOLD_OUT" | "ON_SALE";
type CommandJob = { jobId: string; barcode: string; desiredStatus: SaleStatus; retransmissionRequestId?: string };

export function directStockCommandId(batchId: string) {
  return `unified-command:${batchId}`;
}

export function directStockJobId(requestId: string, barcode: string, desiredStatus: SaleStatus) {
  return `stock-command:${requestId}:${barcode}:${desiredStatus}`;
}

// The operator's original input defines the scope. A shorter response must never
// lower the completion denominator or dispatch only the visible subset.
export function verifyDirectStockCommand<T extends CommandJob>(
  batchId: string, soldOut: string[], onSale: string[],
  saved: { batchId?: string; commandRequestId?: string | null; jobs?: T[] },
) {
  const requestId = directStockCommandId(batchId);
  const expected = [
    ...soldOut.map((barcode) => ({barcode, desiredStatus: "SOLD_OUT" as const})),
    ...onSale.map((barcode) => ({barcode, desiredStatus: "ON_SALE" as const})),
  ];
  const jobs = saved.jobs;
  if (saved.batchId !== batchId || saved.commandRequestId !== (expected.length ? requestId : null) || !Array.isArray(jobs)) {
    throw new Error("이번 입력의 저장 응답과 실행번호가 일치하지 않아 전송을 중단했습니다. 저장된 실행 기록을 확인해 주세요.");
  }
  const missing = expected.filter(({barcode, desiredStatus}, index) => {
    const job = jobs[index];
    return !job || job.barcode !== barcode || job.desiredStatus !== desiredStatus ||
      job.retransmissionRequestId !== requestId || job.jobId !== directStockJobId(requestId, barcode, desiredStatus);
  });
  if (missing.length || jobs.length !== expected.length) {
    const affected = missing.map((item) => item.barcode).join(", ");
    throw new Error(`입력한 품절·판매중 ${expected.length}건과 저장된 전송 목록이 일치하지 않아 전송을 중단했습니다.${affected ? " 확인할 B코드 " + affected : ""}`);
  }
  return jobs;
}
