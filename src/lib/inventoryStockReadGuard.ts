import { randomUUID } from "node:crypto";

type Scope = "overview" | "queue";
type Failure = { count: number; retryAt: number; code: string; message: string; requestId: string };
// Keep diagnostic identifiers, never raw messages, payloads, URLs or credentials.
export function inventoryReadFailureDiagnostic(error: unknown) {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const detail = typeof record.message === "string" ? record.message
    : typeof error === "string" ? error : "";
  const cause = record.cause && typeof record.cause === "object"
    ? record.cause as Record<string, unknown> : {};
  const rawCode = typeof record.code === "string" ? record.code
    : typeof cause.code === "string" ? cause.code : "";
  const code = /^(?:PGRST[0-9]{3}|[0-9A-Z]{5}|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|UND_ERR_[A-Z_]+)$/.test(rawCode) ? rawCode : null;
  const internalCode = detail.match(/^(?:INVENTORY_|PRODUCT_MASTER_|CANONICAL_|SUPABASE_|SHOPLING_)[A-Z0-9_]{1,100}(?=[: ]|$)/)?.[0] ?? null;
  const name = typeof record.name === "string" && /^(?:Error|TypeError|ReferenceError|RangeError|SyntaxError|TimeoutError|AbortError)$/.test(record.name) ? record.name : "UnknownError";
  const category = /timeout|timed out|aborted/i.test(detail) || name === "TimeoutError" || name === "AbortError" ? "TIMEOUT"
    : /permission denied|not authorized/i.test(detail) ? "PERMISSION"
    : /does not exist/i.test(detail) ? "MISSING_RESOURCE"
    : /not iterable/i.test(detail) ? "NOT_ITERABLE"
    : /not a function/i.test(detail) ? "NOT_CALLABLE"
    : /Cannot read propert/i.test(detail) ? "MISSING_PROPERTY"
    : /invalid time value/i.test(detail) ? "INVALID_DATE"
    : /JSON|Unexpected token/i.test(detail) ? "INVALID_JSON"
    : /fetch failed|connection|ECONN|network/i.test(detail) ? "CONNECTION"
    : "UNCLASSIFIED";
  const statusMatch = detail.match(/status[=: ]+([45][0-9]{2})/i);
  const frames = typeof record.stack === "string"
    ? (record.stack.match(/\.next\/server\/[A-Za-z0-9_\[\]./()-]+:[0-9]+:[0-9]+/g) ?? []).slice(0, 4)
    : [];
  return { name, category, internalCode, code, httpStatus: statusMatch ? Number(statusMatch[1]) : null, frames };
}
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
    let diagnostic: ReturnType<typeof inventoryReadFailureDiagnostic> | null = null;
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
      diagnostic = inventoryReadFailureDiagnostic(error);
      if (diagnostic.category === "TIMEOUT") {
        code = "INVENTORY_STOCK_READ_TIMEOUT";
        message = "재고 데이터베이스 응답이 지연되고 있습니다. 기존 재고 기준점은 유지하며 잠시 후 다시 확인합니다.";
      }
      if (diagnostic.internalCode?.startsWith("INVENTORY_STOCK_TAIL")) stage = "TAIL_READ";
    }
    const count = (previous?.count ?? 0) + 1;
    const delay = Math.min(30_000 * 2 ** Math.min(count - 1, 3), 180_000);
    const failure = { count, retryAt: now() + delay, code, message, requestId };
    failures.set(scope, failure);
    // No raw database result, credentials, URLs, or customer information in logs.
    log({ scope, stage, code, requestId, diagnostic, durationMs: now() - started, retryAfterSeconds: delay / 1000 });
    return failureResponse(failure, payload);
  };
}
export const withInventoryReadGuard = createInventoryReadGuard();
