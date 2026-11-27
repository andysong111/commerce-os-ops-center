// An order may identify an application before 1688 shows its case number or amount.
export function normalize1688RefundRequests(requests) {
  if (!Array.isArray(requests) || !requests.length || requests.length > 2000) throw new Error("PAYMENT_REFUND_REQUEST_INVALID");
  const cases = new Map();
  const anonymous = new Set();
  for (const row of requests) {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("PAYMENT_REFUND_REQUEST_INVALID");
    const { refundId = null, requestedFen = null } = row;
    if ((refundId !== null && (typeof refundId !== "string" || !/^TQ\d{1,60}$/.test(refundId))) ||
        (requestedFen !== null && (!Number.isSafeInteger(requestedFen) || requestedFen < 0 || requestedFen >= 10_000_000_000))) {
      throw new Error("PAYMENT_REFUND_REQUEST_INVALID");
    }
    if (refundId === null) {
      anonymous.add(requestedFen);
      continue;
    }
    const existing = cases.get(refundId);
    if (existing != null && requestedFen !== null && existing !== requestedFen) throw new Error("PAYMENT_REFUND_REQUEST_CONFLICT");
    cases.set(refundId, existing ?? requestedFen);
  }
  const unnamed = [...anonymous].sort((a, b) => (a ?? -1) - (b ?? -1))
    .map(requestedFen => ({ refundId: null, requestedFen }));
  return unnamed.concat([...cases].sort(([a], [b]) => a.localeCompare(b, "en"))
    .map(([refundId, requestedFen]) => ({ refundId, requestedFen })));
}
