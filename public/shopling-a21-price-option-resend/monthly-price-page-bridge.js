(() => {
  const channel = "commerce-os-monthly-price-v1";
  if (window.top !== window || location.origin !== "https://commerce-os-ops-center.vercel.app") return;
  window.addEventListener("message", (event) => {
    const message = event.data;
    if (event.source !== window || event.origin !== location.origin || message?.channel !== channel || message.direction !== "request" || typeof message.requestId !== "string" || message.requestId.length > 100) return;
    if (!["PING", "READ", "START", "STATUS", "BATCH_START", "BATCH_STATUS"].includes(message.command)) return;
    chrome.runtime.sendMessage({ type: `MONTHLY_PRICE_${message.command}`, payload: message.payload || {} }, (response) => {
      const error = chrome.runtime.lastError;
      window.postMessage({ channel, direction: "response", requestId: message.requestId, response: error ? { ok: false, error: "MONTHLY_PRICE_EXTENSION_RELOAD_REQUIRED" } : response }, location.origin);
    });
  });
})();
