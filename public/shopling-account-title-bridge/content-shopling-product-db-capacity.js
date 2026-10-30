(() => {
  "use strict";

  const STORAGE_KEY = "commerceOsShoplingProductDbCapacityV1";
  const SOURCE = "shopling-plan-dom-v1";
  const REFRESH_MS = 6 * 60 * 60 * 1000;

  function text(value) {
    return String(value ?? "").normalize("NFKC").replace(/\u00a0/g, " ").trim();
  }

  function count(value) {
    const normalized = text(value).replace(/,/g, "");
    if (!/^\d{1,12}$/.test(normalized)) return null;
    const parsed = Number(normalized);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
  }

  function valueAfterLabel(lines, index, labelPattern) {
    const inline = text(lines[index]).replace(labelPattern, "").trim();
    const inlineMatch = inline.match(/(?:^|\s)([\d,]{1,15})(?:\s|$)/);
    if (inlineMatch) return count(inlineMatch[1]);
    for (let offset = 1; offset <= 4; offset += 1) {
      const candidate = text(lines[index + offset]);
      if (/^[\d,]{1,15}$/.test(candidate)) return count(candidate);
      if (candidate && /[가-힣A-Za-z]/.test(candidate)) break;
    }
    return null;
  }

  function uniqueValue(values) {
    const unique = [...new Set(values.filter((value) => value !== null))];
    return unique.length === 1 ? unique[0] : null;
  }

  function parseShoplingProductDbCapacityText(value) {
    const lines = String(value ?? "")
      .normalize("NFKC")
      .replace(/\r/g, "")
      .split(/\n|\t/)
      .map(text)
      .filter(Boolean);
    const maximumCandidates = [];
    const usedCandidates = [];
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (/^상품\s*DB(?:\s|$)/.test(line) && !/^사용\s*상품/.test(line)) {
        maximumCandidates.push(
          valueAfterLabel(lines, index, /^상품\s*DB\s*/i),
        );
      }
      if (/^사용\s*상품\s*DB\s*수(?:\s*\(누적\))?/i.test(line)) {
        usedCandidates.push(
          valueAfterLabel(
            lines,
            index,
            /^사용\s*상품\s*DB\s*수(?:\s*\(누적\))?\s*/i,
          ),
        );
      }
    }
    const maximumProductCodeCount = uniqueValue(maximumCandidates);
    const usedProductCodeCount = uniqueValue(usedCandidates);
    if (
      !Number.isSafeInteger(maximumProductCodeCount) ||
      maximumProductCodeCount <= 0 ||
      !Number.isSafeInteger(usedProductCodeCount) ||
      usedProductCodeCount < 0
    ) {
      return null;
    }
    return { maximumProductCodeCount, usedProductCodeCount };
  }

  globalThis.__commerceOsParseShoplingProductDbCapacityText =
    parseShoplingProductDbCapacityText;

  if (
    typeof document === "undefined" ||
    typeof window === "undefined" ||
    typeof chrome === "undefined" ||
    window.top !== window
  ) {
    return;
  }

  function getStored() {
    return new Promise((resolve) => {
      chrome.storage.local.get([STORAGE_KEY], (result) => {
        void chrome.runtime.lastError;
        resolve(result?.[STORAGE_KEY] || null);
      });
    });
  }

  function setStored(value) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [STORAGE_KEY]: value }, () => {
        void chrome.runtime.lastError;
        resolve();
      });
    });
  }

  function snapshotId() {
    if (typeof globalThis.crypto?.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (token) => {
      const value = Math.floor(Math.random() * 16);
      return (token === "x" ? value : (value & 3) | 8).toString(16);
    });
  }

  async function collect() {
    const parsed = parseShoplingProductDbCapacityText(
      document.body?.innerText || document.body?.textContent || "",
    );
    if (!parsed) return;
    const existing = await getStored();
    const existingObservedAt = Date.parse(text(existing?.observedAt));
    const unchanged =
      Number(existing?.maximumProductCodeCount) ===
        parsed.maximumProductCodeCount &&
      Number(existing?.usedProductCodeCount) === parsed.usedProductCodeCount;
    if (
      unchanged &&
      Number.isFinite(existingObservedAt) &&
      Date.now() - existingObservedAt < REFRESH_MS
    ) {
      return;
    }
    await setStored({
      snapshotId: snapshotId(),
      source: SOURCE,
      observedAt: new Date().toISOString(),
      ...parsed,
      evidence: {
        pathname: location.pathname,
        pageTitle: text(document.title).slice(0, 200),
      },
    });
  }

  let timer = 0;
  function scheduleCollect() {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void collect(), 800);
  }

  scheduleCollect();
  window.addEventListener("load", scheduleCollect, { once: true });
  const observer = new MutationObserver(scheduleCollect);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.setTimeout(() => observer.disconnect(), 30_000);
})();
