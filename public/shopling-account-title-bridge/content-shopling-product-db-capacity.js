(() => {
  "use strict";

  const STORAGE_KEY = "commerceOsShoplingProductDbCapacityV1";
  const DIAGNOSTIC_KEY = "commerceOsShoplingProductDbCapacityCollectorDiagnosticV1";
  const SOURCE = "shopling-plan-dom-v1";
  const EXTENSION_VERSION = "0.6.8";
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

  function inlineValue(value, labelPattern) {
    const inline = text(value).replace(labelPattern, "").trim();
    const inlineMatch = inline.match(/(?:^|\s)([\d,]{1,15})(?:\s|$)/);
    return inlineMatch ? count(inlineMatch[1]) : null;
  }

  function valueNearLabel(rows, rowIndex, columnIndex, labelPattern) {
    const currentRow = rows[rowIndex] || [];
    const inline = inlineValue(currentRow[columnIndex], labelPattern);
    if (inline !== null) return inline;

    for (let offset = 1; offset <= 2; offset += 1) {
      const candidate = text(currentRow[columnIndex + offset]);
      if (/^[\d,]{1,15}$/.test(candidate)) return count(candidate);
      if (candidate && /[가-힣A-Za-z]/.test(candidate)) break;
    }

    for (let offset = 1; offset <= 4; offset += 1) {
      const candidate = text(rows[rowIndex + offset]?.[columnIndex]);
      if (/^[\d,]{1,15}$/.test(candidate)) return count(candidate);
    }
    return null;
  }

  function uniqueValue(values) {
    const unique = [...new Set(values.filter((value) => value !== null))];
    return unique.length === 1 ? unique[0] : null;
  }

  function parseFlattenedCapacityText(value) {
    const flattened = text(value).replace(/\s+/g, " ");
    const adjacentHeaders = flattened.match(
      /상품\s*DB\s+사용\s*상품\s*DB\s*수(?:\s*\(누적\))?\s+([\d,]{1,15})\s+([\d,]{1,15})(?:\s|$)/i,
    );
    if (adjacentHeaders) {
      return {
        maximumProductCodeCount: count(adjacentHeaders[1]),
        usedProductCodeCount: count(adjacentHeaders[2]),
      };
    }

    const maximum = flattened.match(
      /(?:^|\s)상품\s*DB\s*[:：]?\s*([\d,]{1,15})(?:\s|$)/i,
    );
    const used = flattened.match(
      /사용\s*상품\s*DB\s*수(?:\s*\(누적\))?\s*[:：]?\s*([\d,]{1,15})(?:\s|$)/i,
    );
    return {
      maximumProductCodeCount: maximum ? count(maximum[1]) : null,
      usedProductCodeCount: used ? count(used[1]) : null,
    };
  }

  function parseShoplingProductDbCapacityText(value) {
    const rows = String(value ?? "")
      .normalize("NFKC")
      .replace(/\r/g, "")
      .split("\n")
      .map((row) => row.split("\t").map(text))
      .filter((row) => row.some(Boolean));
    const maximumCandidates = [];
    const usedCandidates = [];
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      for (let columnIndex = 0; columnIndex < rows[rowIndex].length; columnIndex += 1) {
        const cell = rows[rowIndex][columnIndex];
        if (/^상품\s*DB(?:\s|$)/.test(cell) && !/^사용\s*상품/.test(cell)) {
          maximumCandidates.push(
            valueNearLabel(rows, rowIndex, columnIndex, /^상품\s*DB\s*/i),
          );
        }
        if (/^사용\s*상품\s*DB\s*수(?:\s*\(누적\))?/i.test(cell)) {
          usedCandidates.push(
            valueNearLabel(
              rows,
              rowIndex,
              columnIndex,
              /^사용\s*상품\s*DB\s*수(?:\s*\(누적\))?\s*/i,
            ),
          );
        }
      }
    }
    let maximumProductCodeCount = uniqueValue(maximumCandidates);
    let usedProductCodeCount = uniqueValue(usedCandidates);
    const maximumConflict =
      maximumCandidates.length > 0 && maximumProductCodeCount === null;
    const usedConflict = usedCandidates.length > 0 && usedProductCodeCount === null;
    if (maximumConflict || usedConflict) return null;
    if (maximumCandidates.length === 0 || usedCandidates.length === 0) {
      const fallback = parseFlattenedCapacityText(value);
      if (maximumCandidates.length === 0) {
        maximumProductCodeCount = fallback.maximumProductCodeCount;
      }
      if (usedCandidates.length === 0) {
        usedProductCodeCount = fallback.usedProductCodeCount;
      }
    }
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
    typeof chrome === "undefined"
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

  function setStorage(value) {
    return new Promise((resolve) => {
      chrome.storage.local.set(value, () => {
        void chrome.runtime.lastError;
        resolve();
      });
    });
  }

  function documentLocation(candidate) {
    try {
      return {
        href: text(candidate?.location?.href).slice(0, 500),
        pathname: text(candidate?.location?.pathname).slice(0, 240),
      };
    } catch {
      return { href: "", pathname: "" };
    }
  }

  function collectDocumentEntries(candidate, depth = 0, seen = new Set()) {
    if (!candidate || depth > 6 || seen.has(candidate)) return [];
    seen.add(candidate);
    const bodyText = String(
      candidate.body?.innerText || candidate.body?.textContent || "",
    );
    const locationEvidence = documentLocation(candidate);
    const entries = [
      {
        bodyText,
        depth,
        pageTitle: text(candidate.title).slice(0, 200),
        ...locationEvidence,
      },
    ];
    let frames = [];
    try {
      frames =
        typeof candidate.querySelectorAll === "function"
          ? [...candidate.querySelectorAll("iframe, frame")]
          : [];
    } catch {
      frames = [];
    }
    for (const frame of frames) {
      try {
        entries.push(
          ...collectDocumentEntries(frame.contentDocument, depth + 1, seen),
        );
      } catch {
        // Cross-origin frames are covered by the all_frames content-script entry.
      }
    }
    return entries;
  }

  function labelSnippet(value) {
    const flattened = text(value).replace(/\s+/g, " ");
    const index = flattened.search(/상품\s*DB/i);
    if (index < 0) return "";
    return flattened.slice(Math.max(0, index - 40), index + 280);
  }

  function capacityFromEntries(entries) {
    const matches = [];
    for (const entry of entries) {
      const parsed = parseShoplingProductDbCapacityText(entry.bodyText);
      if (!parsed) continue;
      matches.push({ entry, parsed });
    }
    const uniquePairs = [
      ...new Set(
        matches.map(
          ({ parsed }) =>
            `${parsed.maximumProductCodeCount}:${parsed.usedProductCodeCount}`,
        ),
      ),
    ];
    if (uniquePairs.length !== 1) {
      return {
        match: null,
        status: uniquePairs.length > 1 ? "conflicting_values" : "not_found",
      };
    }
    return { match: matches[0], status: "matched" };
  }

  function isTopFrame() {
    try {
      return window.top === window;
    } catch {
      return false;
    }
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
    const entries = collectDocumentEntries(document);
    const result = capacityFromEntries(entries);
    const diagnostic = {
      extensionVersion: EXTENSION_VERSION,
      attemptedAt: new Date().toISOString(),
      status: result.status,
      topFrame: isTopFrame(),
      frameHref: text(location.href).slice(0, 500),
      framePathname: text(location.pathname).slice(0, 240),
      scannedDocumentCount: entries.length,
      scannedCharacterCount: entries.reduce(
        (total, entry) => total + entry.bodyText.length,
        0,
      ),
      labelSnippets: entries.map((entry) => labelSnippet(entry.bodyText)).filter(Boolean).slice(0, 8),
    };
    if (!result.match) {
      const existingDiagnostic = await new Promise((resolve) => {
        chrome.storage.local.get([DIAGNOSTIC_KEY], (stored) => {
          void chrome.runtime.lastError;
          resolve(stored?.[DIAGNOSTIC_KEY] || null);
        });
      });
      const priorMatchedAt = Date.parse(text(existingDiagnostic?.attemptedAt));
      const preserveRecentMatch =
        existingDiagnostic?.status === "matched" &&
        Number.isFinite(priorMatchedAt) &&
        Date.now() - priorMatchedAt < 10 * 60 * 1000;
      if (!preserveRecentMatch && isTopFrame()) {
        await setStorage({ [DIAGNOSTIC_KEY]: diagnostic });
      }
      return;
    }
    const { entry, parsed } = result.match;
    diagnostic.maximumProductCodeCount = parsed.maximumProductCodeCount;
    diagnostic.usedProductCodeCount = parsed.usedProductCodeCount;
    diagnostic.matchedDocumentDepth = entry.depth;
    diagnostic.matchedDocumentHref = entry.href;
    diagnostic.matchedDocumentPathname = entry.pathname;
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
      await setStorage({ [DIAGNOSTIC_KEY]: diagnostic });
      return;
    }
    await setStorage({
      [DIAGNOSTIC_KEY]: diagnostic,
      [STORAGE_KEY]: {
        snapshotId: snapshotId(),
        source: SOURCE,
        observedAt: new Date().toISOString(),
        ...parsed,
        evidence: {
          pathname: entry.pathname || text(location.pathname),
          pageTitle: entry.pageTitle || text(document.title).slice(0, 200),
          frameHref: entry.href,
          matchedDocumentDepth: entry.depth,
        },
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
