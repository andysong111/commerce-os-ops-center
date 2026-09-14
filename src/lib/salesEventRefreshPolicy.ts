// No server dependencies: the same eligibility rule drives the UI and API.
export const SALES_EVENT_REFRESH_STATES = [
  "READY_CANARY", "READY_FULL", "COMPLETED", "BLOCKED", "STORAGE_NOT_READY",
] as const;
export const SALES_EVENT_REFRESH_CONFIRMATION = "REFRESH_CANDIDATE";
export type SalesEventRefreshInput = {
  expectedRequestId: string;
  expectedPlanFingerprint: string;
  confirmation: string;
};
export class SalesEventActionError extends Error {
  constructor(public code: string, public status: number, message: string) {
    super(message);
    this.name = "SalesEventActionError";
  }
}
export function canRefreshSalesEventCandidate(state: string) {
  return SALES_EVENT_REFRESH_STATES.some((value) => value === state);
}
export function parseSalesEventRefreshInput(body: Record<string, unknown>): SalesEventRefreshInput {
  const expectedRequestId = String(body.expectedRequestId ?? "").trim();
  const expectedPlanFingerprint = String(body.expectedPlanFingerprint ?? "").trim();
  const confirmation = String(body.confirmation ?? "").trim();
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(expectedRequestId) ||
      !/^sha256:[a-f0-9]{64}$/.test(expectedPlanFingerprint)) {
    throw new SalesEventActionError("SALES_EVENT_REFRESH_CONTEXT_REQUIRED", 400, "현재 후보 식별 정보가 필요합니다. 화면을 새로고침하세요.");
  }
  if (confirmation !== SALES_EVENT_REFRESH_CONFIRMATION) {
    throw new SalesEventActionError("SALES_EVENT_REFRESH_CONFIRMATION_REQUIRED", 400, "최신 후보 재수집 확인이 필요합니다.");
  }
  return { expectedRequestId, expectedPlanFingerprint, confirmation };
}
export function assertSalesEventRefreshAllowed(current: {
  configured: boolean; state: string; requestId: string | null; analysisAsOf: string | null;
  report: { planFingerprint: string } | null;
}, input: SalesEventRefreshInput, now = Date.now()) {
  parseSalesEventRefreshInput(input);
  if (!current.configured) {
    throw new SalesEventActionError("SALES_EVENT_REFRESH_NOT_CONFIGURED", 503, "판매 수집 연결 설정을 먼저 확인해야 합니다.");
  }
  if (current.requestId !== input.expectedRequestId || current.report?.planFingerprint !== input.expectedPlanFingerprint) {
    throw new SalesEventActionError("SALES_EVENT_REFRESH_CONTEXT_CHANGED", 409, "후보가 변경됐거나 이미 재수집을 접수했습니다. 화면을 새로고침하세요.");
  }
  if (!canRefreshSalesEventCandidate(current.state)) {
    throw new SalesEventActionError("SALES_EVENT_REFRESH_STATE_BLOCKED", 409, "진행 중인 수집은 이어서 처리하고, 실패한 수집은 기존 복구 경로를 사용하세요.");
  }
  const previous = Date.parse(current.analysisAsOf ?? "");
  if (!Number.isFinite(previous) || !Number.isFinite(now) || now <= previous) {
    throw new SalesEventActionError("SALES_EVENT_REFRESH_TIME_INVALID", 409, "기존 분석시점보다 최신인 수집만 접수할 수 있습니다.");
  }
}
