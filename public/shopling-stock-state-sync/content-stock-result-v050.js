(() => {
  const VERSION = chrome.runtime.getManifest().version;
  const norm = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  let lastSignature = "";

  function bodyText() {
    return norm(document.body?.innerText || document.body?.textContent || document.documentElement?.innerText || "");
  }

  function parseCounts(text) {
    const success = [...text.matchAll(/성공건수\s*[:：]?\s*([\d,]+)/gi)].reduce((sum, match) => sum + Number(match[1].replace(/,/g, "")), 0);
    const failure = [...text.matchAll(/실패건수\s*[:：]?\s*([\d,]+)/gi)].reduce((sum, match) => sum + Number(match[1].replace(/,/g, "")), 0);
    return { success, failure };
  }

  async function publish() {
    const text = bodyText();
    const counts = parseCounts(text);
    const evidence = {
      processing: /처리중입니다/i.test(text) || /잠시만\s*기다려주시기\s*바랍니다/i.test(text),
      optionComplete:
        /상품\s*옵션\s*(?:수정\s*)?전송이\s*완료되었습니다/i.test(text) ||
        /상품옵션\s*전송이\s*완료되었습니다/i.test(text) ||
        /옵션\s*송신이\s*완료되었습니다/i.test(text),
      productComplete:
        /상품\s*수정\s*전송이\s*완료되었습니다/i.test(text) ||
        /상품판매상태\s*송신이\s*완료되었습니다/i.test(text),
      explicitFailure:
        /성공여부\s*[:：]?\s*실패/i.test(text) ||
        /전송\s*실패|송신\s*실패|처리\s*실패/i.test(text),
      successCount: counts.success,
      failureCount: counts.failure,
      readyState: String(document.readyState || ""),
      href: String(location.href || ""),
      title: String(document.title || ""),
      top: window.top === window,
      textSample: text.slice(-900),
      version: VERSION,
    };
    if (!evidence.processing && !evidence.optionComplete && !evidence.productComplete && !evidence.explicitFailure && evidence.successCount <= 0 && evidence.failureCount <= 0) return;
    const signature = JSON.stringify({
      processing: evidence.processing,
      optionComplete: evidence.optionComplete,
      productComplete: evidence.productComplete,
      explicitFailure: evidence.explicitFailure,
      successCount: evidence.successCount,
      failureCount: evidence.failureCount,
      href: evidence.href,
      textSample: evidence.textSample,
    });
    if (signature === lastSignature) return;
    lastSignature = signature;
    await chrome.runtime.sendMessage({ type: "STOCK_SYNC_RESULT_EVIDENCE", evidence, version: VERSION }).catch(() => null);
  }

  void publish();
  window.addEventListener("load", () => void publish(), { once: true });
  window.setInterval(() => void publish(), 700);
})();
