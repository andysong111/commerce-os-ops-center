export const INVENTORY_QUEUE_PATH = "/api/inventory-stock-control/sync";
export const INVENTORY_REFRESH_PATH = "/api/inventory-stock-control";
type ReadPath = typeof INVENTORY_QUEUE_PATH | typeof INVENTORY_REFRESH_PATH;
const EVIDENCE_REFRESH_REUSE_MS = 2 * 60 * 1000;
export class InventoryConnectionError extends Error {
  retryAfterMs: number;
  code: string;
  constructor(message: string, retryAfterMs: number, code = "INVENTORY_CONNECTION_FAILED") {
    super(message);
    this.retryAfterMs = retryAfterMs;
    this.code = code;
    this.name = "InventoryConnectionError";
  }
}

// One in-flight read per browser module. Never cache successful execution jobs.
// Passive queue reads stay read-only. An explicit/fresh queue read first refreshes
// sales/inventory evidence when the last explicit evidence refresh is older than
// two minutes, then re-reads the queue. This prevents a 10-minute Tail expiry
// from deadlocking the manual queue while keeping 30-second polling side-effect free.
export function createInventoryReadClient(options: { fetcher?: typeof fetch; now?: () => number } = {}) {
  const fetcher = options.fetcher ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const now = options.now ?? Date.now;
  let pending: { path: ReadPath; promise: Promise<unknown> } | null = null;
  let failures = 0;
  let retryAt = 0;
  let lastMessage = "재고 연결을 잠시 쉬고 다시 확인합니다.";
  let lastEvidenceRefreshAt = Number.NEGATIVE_INFINITY;
  function read<T>(path: ReadPath, fresh = false): Promise<T> {
    if (path !== INVENTORY_QUEUE_PATH && path !== INVENTORY_REFRESH_PATH) {
      return Promise.reject(new Error("INVENTORY_READ_PATH_NOT_ALLOWED"));
    }
    if (
      path === INVENTORY_QUEUE_PATH &&
      fresh &&
      now() - lastEvidenceRefreshAt >= EVIDENCE_REFRESH_REUSE_MS
    ) {
      // Share an in-flight explicit evidence refresh, but never reuse a completed
      // queue response. A successful refresh records its timestamp below, so the
      // recursive fresh queue read skips this preflight and performs the real read.
      return read<Record<string, unknown>>(INVENTORY_REFRESH_PATH, false).then(() =>
        read<T>(INVENTORY_QUEUE_PATH, true),
      );
    }
    if (pending) {
      if (!fresh && pending.path === path) return pending.promise as Promise<T>;
      return pending.promise.catch(() => undefined).then(() => read<T>(path, fresh));
    }
    if (retryAt > now()) {
      return Promise.reject(new InventoryConnectionError(lastMessage, retryAt - now(), "INVENTORY_READ_COOLDOWN"));
    }
    const promise = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), path === INVENTORY_REFRESH_PATH ? 60_000 : 25_000);
      try {
        const response = await fetcher(path, {
          method: "GET", cache: "no-store", headers: { accept: "application/json" }, signal: controller.signal,
        });
        const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
        const report = payload?.report as { state?: string; message?: string; rows?: unknown[] } | undefined;
        if (!response.ok || payload?.ok !== true || report?.state !== "READY" || !Array.isArray(report.rows)) {
          const code = typeof payload?.code === "string" ? payload.code.slice(0, 100) : `HTTP_${response.status}`;
          const detail = typeof payload?.message === "string" ? payload.message : report?.message;
          const requestId = typeof payload?.requestId === "string" ? payload.requestId.slice(0, 80) : "";
          const seconds = Number(response.headers.get("retry-after"));
          throw new InventoryConnectionError(
            `${detail || "재고 조회 응답을 확인하지 못했습니다."} [${code}]${requestId ? ` 확인번호 ${requestId}` : ""}`,
            Number.isFinite(seconds) ? Math.min(180_000, Math.max(0, seconds * 1000)) : 0, code,
          );
        }
        failures = 0;
        retryAt = 0;
        if (path === INVENTORY_REFRESH_PATH) lastEvidenceRefreshAt = now();
        return payload;
      } catch (error) {
        failures += 1;
        const delay = Math.max(Math.min(30_000 * 2 ** Math.min(failures - 1, 3), 180_000),
          error instanceof InventoryConnectionError ? error.retryAfterMs : 0);
        retryAt = now() + delay;
        const message = error instanceof InventoryConnectionError ? error.message
          : controller.signal.aborted ? "재고 조회 응답이 지연되어 요청을 중단했습니다."
          : "재고 서버 연결에 실패했습니다. 네트워크 또는 서버 상태를 확인하고 있습니다.";
        lastMessage = `${message} 약 ${Math.ceil(delay / 1000)}초 후 자동으로 다시 확인합니다. 재고 확정 버튼은 누르지 마세요.`;
        throw new InventoryConnectionError(lastMessage, delay,
          error instanceof InventoryConnectionError ? error.code : "INVENTORY_CONNECTION_FAILED");
      } finally { clearTimeout(timer); }
    })();
    const entry = { path, promise };
    pending = entry;
    const clear = () => { if (pending === entry) pending = null; };
    void promise.then(clear, clear);
    return promise as Promise<T>;
  }
  return { read };
}
export const inventoryStockReadClient = createInventoryReadClient();

// Completion-based scheduling: no overlapping intervals and no hidden/offline reads.
export function startInventoryPolling(options: {
  task: () => Promise<unknown>; active: () => boolean; onError: (error: unknown) => void;
  schedule?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
}) {
  const schedule = options.schedule ?? setTimeout;
  const cancel = options.cancel ?? clearTimeout;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let running = false;
  let failures = 0;
  const arm = (delay: number) => { if (!stopped) timer = schedule(() => { void run(); }, delay); };
  async function run() {
    if (stopped || running) return;
    if (timer !== undefined) { cancel(timer); timer = undefined; }
    if (!options.active()) { arm(30_000); return; }
    running = true;
    let delay = 30_000;
    try { await options.task(); failures = 0; }
    catch (error) {
      failures += 1;
      delay = Math.max(Math.min(30_000 * 2 ** Math.min(failures - 1, 3), 180_000),
        error instanceof InventoryConnectionError ? error.retryAfterMs : 0);
      options.onError(error);
    } finally { running = false; arm(delay); }
  }
  return { run, stop() { stopped = true; if (timer !== undefined) cancel(timer); } };
}