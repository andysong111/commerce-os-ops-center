function replaceOnce(source: string, before: string, after: string, code: string) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${code}:anchor_missing`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${code}:anchor_not_unique`);
  }
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

const HF40_SINGLE_RESULT_WATCH_LIMIT = "  const WAIT_MS = 95_000;";
const HF41_SINGLE_RESULT_WATCH_LIMIT = "  const WAIT_MS = 30 * 60_000;";

export const SHOPLING_STOCK_HF41_RESULT_WATCH_MS = 30 * 60_000;

export function patchShoplingStockHf41ResultWatcher(source: string) {
  return replaceOnce(
    source.replace(/\r\n/g, "\n"),
    HF40_SINGLE_RESULT_WATCH_LIMIT,
    HF41_SINGLE_RESULT_WATCH_LIMIT,
    "shopling_stock_hf41_single_result_watch_limit",
  );
}
