(() => {
  const VERSION = chrome.runtime.getManifest().version;
  const MESSAGE = "STOCK_SINGLE_STATUS_RESULT_TERMINAL_V023";
  const POLL_MS = 350;
  const STABLE_MS = 2_500;
  const MAX_MS = 120_000;
  const startedAt = Date.now();
  let stableSince = 0;
  let stopped = false;
  let sending = false;

  const norm = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();

  function isExactResultPage() {
    try {
      const url = new URL(String(location.href || ""));
      const hostOk = url.hostname === "shopling.co.kr" || url.hostname.endsWith(".shopling.co.kr");
      return hostOk && /\/prod_a\/prod_status_trsmt\.phtml$/i.test(url.pathname);
    } catch {
      return false;
    }
  }

  function readEvidence() {
    const text = norm(document.body?.innerText || document.body?.textContent || document.documentElement?.innerText || "");
    const totals = [...text.matchAll(/총건수\s*[:：]?\s*([\d,]+)/gi)].map((match) => Number(match[1].replace(/,/g, "")));
    const successes = [...text.matchAll(/성공건수\s*[:：]?\s*([\d,]+)/gi)].map((match) => Number(match[1].replace(/,/g, "")));
    const failures = [...text.matchAll(/실패건수\s*[:：]?\s*([\d,]+)/gi)].map((match) => Number(match[1].replace(/,/g, "")));
    const totalCount = totals.reduce((sum, value) => sum + value, 0);
    const successCount = successes.reduce((sum, value) => sum + value, 0);
    const failureCount = failures.reduce((sum, value) => sum + value, 0);
    const exactFooter = /상품\s*상태\s*변경\s*전송이\s*완료되었습니다/i.test(text);
    const fallbackFooter =
      /상품판매상태\s*송신이\s*완료되었습니다/i.test(text) ||
      /상품\s*수정\s*전송이\s*완료되었습니다/i.test(text);
    const processing = /처리중입니다/i.test(text) || /잠시만\s*기다려주시기\s*바랍니다/i.test(text);
    const countsBalanced = totals.length > 0 && totalCount === successCount + failureCount;
    return {
      exactFooter,
      fallbackFooter,
      processing,
      countsBalanced,
      totalCount,
      successCount,
      failureCount,
      readyState: String(document.readyState || ""),
      href: String(location.href || ""),
      hostname: String(location.hostname || ""),
      pathname: String(location.pathname || ""),
      textTail: text.slice(-1200),
    };
  }

  async function tick() {
    if (stopped || sending) return;
    if (!isExactResultPage()) return;
    if (Date.now() - startedAt > MAX_MS) {
      stopped = true;
      return;
    }

    const evidence = readEvidence();
    const terminal = (evidence.exactFooter || evidence.fallbackFooter) && !evidence.processing && evidence.readyState === "complete";
    if (!terminal) {
      stableSince = 0;
      return;
    }
    if (!stableSince) stableSince = Date.now();
    const stableMs = Date.now() - stableSince;
    if (stableMs < STABLE_MS) return;

    sending = true;
    try {
      const response = await chrome.runtime.sendMessage({
        type: MESSAGE,
        evidence: {
          ...evidence,
          stableMs,
          directResultHostBridge: true,
          version: VERSION,
        },
      }).catch(() => null);
      if (response?.ok && response?.accepted) stopped = true;
      if (response?.noActiveJob) stopped = true;
    } finally {
      sending = false;
    }
  }

  if (!isExactResultPage()) return;
  void tick();
  window.addEventListener("load", () => void tick(), { once: true });
  const timer = window.setInterval(() => {
    if (stopped) {
      window.clearInterval(timer);
      return;
    }
    void tick();
  }, POLL_MS);
})();
