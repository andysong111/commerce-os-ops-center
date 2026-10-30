function replaceOnce(source: string, before: string, after: string, code: string) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${code}:anchor_missing`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${code}:anchor_not_unique`);
  }
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

const HF41_OPTION_RESULT_WATCH_LIMIT = "  const WAIT_LIMIT_MS_V055 = 180_000;";
const HF42_OPTION_RESULT_WATCH_LIMIT = "  const WAIT_LIMIT_MS_V055 = 30 * 60_000;";
const HF41_OPTION_PROCESSING_BLOCK = `    const processing = contexts.some((row) => row.processing) || processingRegexV055.test(axText);
    const expectedInRuntime = contexts.some((row) => row.optionFooter);
    const expectedInAx = optionFooterRegexV055.test(axText);
    const expectedFooter = expectedInRuntime || expectedInAx;`;
const HF42_OPTION_PROCESSING_BLOCK = `    const staleProcessingSignal = contexts.some((row) => row.processing) || processingRegexV055.test(axText);
    const expectedInRuntime = contexts.some((row) => row.optionFooter);
    const expectedInAx = optionFooterRegexV055.test(axText);
    const expectedFooter = expectedInRuntime || expectedInAx;
    // Shopling keeps historic per-market headings ending in "전송중입니다" even
    // after the exact terminal footer is appended. The exact footer is the
    // authoritative terminal signal, so stale headings must not veto it.
    const processing = staleProcessingSignal && !expectedFooter;`;
const HF41_OPTION_WATCHER_TAIL = `  chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
    if (changeInfo.status !== "complete") return;
    setTimeout(() => void runDefinitiveWatcherV055("tabUpdatedComplete"), 120);
  });
})();`;
const HF42_OPTION_WATCHER_TAIL = `  chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
    if (changeInfo.status !== "complete") return;
    setTimeout(() => void runDefinitiveWatcherV055("tabUpdatedComplete"), 120);
  });

  // A loaded-unpacked update restarts the service worker while the completed
  // result tab and active WAIT_A21_RESULT state remain. Recover that exact tab
  // without dispatching another Shopling submission.
  setTimeout(() => void runDefinitiveWatcherV055("serviceWorkerBoot"), 120);
})();`;

export const SHOPLING_STOCK_HF42_OPTION_RESULT_WATCH_MS = 30 * 60_000;

export function patchShoplingStockHf42OptionResultWatcher(source: string) {
  const normalized = source.replace(/\r\n/g, "\n");
  const withLongWatch = replaceOnce(
    normalized,
    HF41_OPTION_RESULT_WATCH_LIMIT,
    HF42_OPTION_RESULT_WATCH_LIMIT,
    "shopling_stock_hf42_option_result_watch_limit",
  );
  const withTerminalPrecedence = replaceOnce(
    withLongWatch,
    HF41_OPTION_PROCESSING_BLOCK,
    HF42_OPTION_PROCESSING_BLOCK,
    "shopling_stock_hf42_option_terminal_precedence",
  );
  return replaceOnce(
    withTerminalPrecedence,
    HF41_OPTION_WATCHER_TAIL,
    HF42_OPTION_WATCHER_TAIL,
    "shopling_stock_hf42_option_service_worker_boot",
  );
}
