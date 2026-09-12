import { randomUUID } from "node:crypto";

type Scope = "overview" | "queue";
type Failure = { count: number; retryAt: number; code: string; message: string; requestId: string };
// Per-instance failure circuit only. Never cache READY reports or Shopling jobs,
// and never wrap/retry POST operations with this guard.
export function createInventoryReadGuard(options: {
  now?: () => number;
  log?: (entry: Record<string, unknown>) => void;
} = {}) {
  const now = options.now ?? Date.now;
  const failures = new Map<Scope, Failure>();
  const log = options.log ?? ((entry) => console.error("[inventory-read]", JSON.stringify(entry)));
  function failureResponse(failure: Failure, payload: Record<string, unknown> = {}) {
    const retryAfterSeconds = Math.max(1, Math.ceil((failure.retryAt - now()) / 1000));
    return Response.json({ ...payload, ok: false, jobs: [], code: failure.code,
      message: failure.message, requestId: failure.requestId, retryAfterSeconds }, {
      status: 503, headers: { "cache-control": "no-store", "retry-after": String(retryAfterSeconds),
        "x-inventory-request-id": failure.requestId },
    });
  }
  return async function guard(scope: Scope, work: () => Promise<Response>): Promise<Response> {
    const previous = failures.get(scope);
    if (previous && previous.retryAt > now()) return failureResponse(previous);
    const requestId = randomUUID();
    const started = now();
    let payload: Record<string, unknown> = {};
    let code = "INVENTORY_STOCK_READ_UNAVAILABLE";
    let message = "재고 데이터를 읽지 못했습니다. 현재 수량을 확정하지 않고 잠시 후 다시 확인합니다.";
    let stage = "INVENTORY_READ";
    try {
      const response = await work();
      if (response.status < 500) {
        failures.delete(scope);
        return response;
      }
      payload = await response.json().catch(() => ({})) as Record<string, unknown>;
      const report = payload.report as { message?: unknown } | undefined;
      if (typeof payload.message === "string") message = payload.message.slice(0, 500);
      else if (typeof report?.message === "string") message = report.message.slice(0, 500);
      code = "INVENTORY_STOCK_READ_BLOCKED";
    } catch (error) {
      const detail = error instanceof Error ? error.message : "";
      if (/timeout|timed out|aborted/i.test(detail)) {
        code = "INVENTORY_STOCK_READ_TIMEOUT";
        message = "재고 데이터베이스 응답이 지연되고 있습니다. 기존 재고 기준점은 유지하며 잠시 후 다시 확인합니다.";
      }
      if (/INVENTORY_STOCK_TAIL/.test(detail)) stage = "TAIL_READ";
    }
    const count = (previous?.count ?? 0) + 1;
    const delay = Math.min(30_000 * 2 ** Math.min(count - 1, 3), 180_000);
    const failure = { count, retryAt: now() + delay, code, message, requestId };
    failures.set(scope, failure);
    // No raw database result, credentials, URLs, or customer information in logs.
    log({ scope, stage, code, requestId, durationMs: now() - started, retryAfterSeconds: delay / 1000 });
    return failureResponse(failure, payload);
  };
}
export const withInventoryReadGuard = createInventoryReadGuard();
