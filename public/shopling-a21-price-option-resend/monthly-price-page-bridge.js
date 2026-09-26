(() => {
  const channel = "commerce-os-monthly-price-v1";
  const slot = "__commerceOsMonthlyPriceBridge";
  if (window.top !== window || location.origin !== "https://commerce-os-ops-center.vercel.app") return;

  const previous = globalThis[slot];
  if (previous?.listener) {
    try { window.removeEventListener("message", previous.listener); } catch { /* stale context */ }
  }

  function respond(requestId, response) {
    window.postMessage({ channel, direction: "response", requestId, response }, location.origin);
  }

  const listener = (event) => {
    const message = event.data;
    if (event.source !== window || event.origin !== location.origin || message?.channel !== channel || message.direction !== "request" || typeof message.requestId !== "string" || message.requestId.length > 100) return;
    if (!["PING", "READ", "MARKET_READ", "START", "STATUS", "BATCH_START", "BATCH_STATUS"].includes(message.command)) return;

    const runtime = globalThis.chrome?.runtime;
    if (!runtime || typeof runtime.sendMessage !== "function") {
      respond(message.requestId, { ok: false, error: "MONTHLY_PRICE_EXTENSION_RELOAD_REQUIRED" });
      return;
    }

    try {
      runtime.sendMessage({ type: `MONTHLY_PRICE_${message.command}`, payload: message.payload || {} }, (response) => {
        try {
          const error = runtime.lastError;
          respond(message.requestId, error ? { ok: false, error: "MONTHLY_PRICE_EXTENSION_RELOAD_REQUIRED" } : response);
        } catch {
          respond(message.requestId, { ok: false, error: "MONTHLY_PRICE_EXTENSION_RELOAD_REQUIRED" });
        }
      });
    } catch {
      respond(message.requestId, { ok: false, error: "MONTHLY_PRICE_EXTENSION_RELOAD_REQUIRED" });
    }
  };

  globalThis[slot] = { version: "0.5.13", listener };
  window.addEventListener("message", listener);
})();