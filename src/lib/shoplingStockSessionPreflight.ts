const REQUEST = "COMMERCE_OS_SHOPLING_STOCK_SYNC_SESSION_PREFLIGHT_REQUEST";
const RESULT = "COMMERCE_OS_SHOPLING_STOCK_SYNC_SESSION_PREFLIGHT_RESULT";

export class ShoplingSessionPreflightError extends Error {
  code: string;
  constructor(message: string, code = "SHOPLING_SESSION_PREFLIGHT_FAILED") {
    super(message);
    this.name = "ShoplingSessionPreflightError";
    this.code = code;
  }
}

export function requireShoplingAuthenticatedSession(timeoutMs = 7_000) {
  return new Promise<{ authenticated: true; tabId?: number }>((resolve, reject) => {
    const requestId = `shopling-session:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new ShoplingSessionPreflightError("Shopling 로그인 점검 응답이 없습니다. 재고상태 자동화 확장 v0.6.29 연결을 확인해 주세요.", "SHOPLING_SESSION_PREFLIGHT_TIMEOUT"));
    }, timeoutMs);
    function onMessage(event: MessageEvent) {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data as Record<string, unknown> | null;
      if (!data || data.type !== RESULT || data.requestId !== requestId) return;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      if (data.ok === true && data.authenticated === true) {
        resolve({ authenticated: true, tabId: Number(data.tabId) || undefined });
      } else {
        reject(new ShoplingSessionPreflightError(
          String(data.message || "Shopling 관리자 로그인이 필요합니다."),
          String(data.code || "SHOPLING_LOGIN_REQUIRED_BEFORE_START"),
        ));
      }
    }
    window.addEventListener("message", onMessage);
    window.postMessage({ type: REQUEST, requestId }, window.location.origin);
  });
}
