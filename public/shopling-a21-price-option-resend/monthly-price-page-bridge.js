(() => {
  const channel = "commerce-os-monthly-price-v1";
  const marker = "__commerceOsMonthlyPriceBridgeV055";
  if (window.top !== window || location.origin !== "https://commerce-os-ops-center.vercel.app") return;
  if (globalThis[marker]) return;
  globalThis[marker] = true;

  function respond(requestId, response) {
    window.postMessage({ channel, direction: "response", requestId, response }, location.origin);
  }

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (event.source !== window || event.origin !== location.origin || message?.channel !== channel || message.direction !== "request" || typeof message.requestId !== "string" || message.requestId.length > 100) return;
    if (!["PING", "READ", "START", "STATUS", "BATCH_START", "BATCH_STATUS"].includes(message.command)) return;
    try {
      chrome.runtime.sendMessage({ type: `MONTHLY_PRICE_${message.command}`, payload: message.payload || {} }, (response) => {
        try {
          const error = chrome.runtime.lastError;
          respond(message.requestId, error ? { ok: false, error: "MONTHLY_PRICE_EXTENSION_RELOAD_REQUIRED" } : response);
        } catch {
          respond(message.requestId, { ok: false, error: "MONTHLY_PRICE_EXTENSION_RELOAD_REQUIRED" });
        }
      });
    } catch {
      respond(message.requestId, { ok: false, error: "MONTHLY_PRICE_EXTENSION_RELOAD_REQUIRED" });
    }
  });
})();