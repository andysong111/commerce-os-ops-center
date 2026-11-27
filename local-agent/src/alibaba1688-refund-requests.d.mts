export type RefundRequest = { refundId: string | null; requestedFen: number | null };
export function normalize1688RefundRequests(requests: unknown): RefundRequest[];
