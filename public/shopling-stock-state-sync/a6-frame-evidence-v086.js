// HF64 read-only A6 frame evidence.
// This helper never clicks or edits Shopling. It only tells the background
// which frame in the dedicated A6 tab contains the exact B-code result rows.
(() => {
  const PROBE = "STOCK_SYNC_A6_FRAME_EVIDENCE_HF64";
  const norm = (value) =>
    String(value ?? "")
      .normalize("NFKC")
      .replace(/\s+/g, " ")
      .trim();

  function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function exactTokenRegex(token) {
    return new RegExp(
      `(^|[^A-Z0-9-])${escapeRegex(norm(token).toUpperCase())}([^A-Z0-9-]|$)`,
      "i",
    );
  }

  function exactSearchControl() {
    return [...document.querySelectorAll("select")].find((select) =>
      [...select.options].some(
        (option) => norm(option.textContent) === "옵션자체관리코드",
      ),
    );
  }

  function resultRows(barcode) {
    if (!barcode) return [];
    const token = exactTokenRegex(barcode);
    const pair = /(^|[^0-9])\d{4,}-\d{4,}(?=[^0-9]|$)/;
    return [...document.querySelectorAll("tr")]
      .map((row) => norm(row.innerText || row.textContent))
      .filter((text) => token.test(text.toUpperCase()) && pair.test(text));
  }

  function totalResultCount() {
    const text = norm(
      document.body?.innerText ||
        document.body?.textContent ||
        document.documentElement?.innerText ||
        "",
    );
    const match = text.match(/총\s*조회수\s*[:：]?\s*([\d,]+)\s*건/i);
    return match ? Number(match[1].replace(/,/g, "")) : null;
  }

  function queryEchoes(barcode) {
    const wanted = norm(barcode).toUpperCase();
    if (!wanted) return false;
    return [...document.querySelectorAll("input,textarea")].some(
      (input) => norm(input.value).toUpperCase() === wanted,
    );
  }

  function freshSubmittedTicket(barcode) {
    const wanted = norm(barcode).toUpperCase();
    if (!wanted) return false;
    try {
      for (let index = 0; index < sessionStorage.length; index += 1) {
        const key = String(sessionStorage.key(index) || "");
        if (!key.startsWith("commerce-stock-search-v042:")) continue;
        const ticket = JSON.parse(sessionStorage.getItem(key) || "null");
        if (
          ticket?.submitted === true &&
          ticket?.fieldLabel === "옵션자체관리코드" &&
          norm(ticket?.token).toUpperCase() === wanted &&
          Date.now() - Number(ticket?.at || 0) < 90_000
        ) {
          return true;
        }
      }
    } catch {}
    return false;
  }

  function evidence(barcode) {
    const control = exactSearchControl();
    const rows = resultRows(barcode);
    return {
      ok: true,
      role: control ? "A6" : "OTHER",
      href: String(location.href || ""),
      hasExactSearchControl: Boolean(control),
      exactResultRowCount: rows.length,
      totalResultCount: totalResultCount(),
      controlsEchoExactBarcode: queryEchoes(barcode),
      hasFreshSubmittedTicket: freshSubmittedTicket(barcode),
      readOnly: true,
      mutationAttempted: false,
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== PROBE) return;
    sendResponse(evidence(message.barcode));
  });
})();
