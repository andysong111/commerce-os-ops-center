function replaceOnce(source: string, before: string, after: string, code: string) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${code}:anchor_missing`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${code}:anchor_not_unique`);
  }
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

const OPTION_CANONICAL_WORKER_BEFORE = `  async function ensureCanonicalListWorkerV071(target) {
    if (!target || !Number.isInteger(target.tabId) || !Number.isInteger(target.frameId)) return false;
    const options = { frameId: target.frameId };
    let probe = await chrome.tabs
      .sendMessage(target.tabId, { type: CANONICAL_IDENTIFY_V071 }, options)
      .catch(() => null);
    if (probe?.ok && probe.role === "A21_LIST") return true;

    await chrome.scripting
      .executeScript({
        target: { tabId: target.tabId, frameIds: [target.frameId] },
        files: [CANONICAL_LIST_SCRIPT_V071],
      })
      .catch(() => null);
    await sleep(140);
    probe = await chrome.tabs
      .sendMessage(target.tabId, { type: CANONICAL_IDENTIFY_V071 }, options)
      .catch(() => null);
    return Boolean(probe?.ok && probe.role === "A21_LIST");
  }`;

const OPTION_CANONICAL_WORKER_AFTER = `  async function ensureCanonicalListWorkerV071(target) {
    if (!target || !Number.isInteger(target.tabId) || !Number.isInteger(target.frameId)) return false;
    const options = { frameId: target.frameId };
    const deadlineHf46 = Date.now() + 8_000;
    let injectedHf46 = false;
    while (Date.now() < deadlineHf46) {
      const probe = await chrome.tabs
        .sendMessage(target.tabId, { type: CANONICAL_IDENTIFY_V071 }, options)
        .catch(() => null);
      if (probe?.ok && probe.role === "A21_LIST") return true;
      if (!injectedHf46) {
        injectedHf46 = true;
        await chrome.scripting
          .executeScript({
            target: { tabId: target.tabId, frameIds: [target.frameId] },
            files: [CANONICAL_LIST_SCRIPT_V071],
          })
          .catch(() => null);
      }
      await sleep(250);
    }
    return false;
  }`;

export function patchShoplingStockHf46OptionBatch(source: string) {
  return replaceOnce(
    source.replace(/\r\n/g, "\n"),
    OPTION_CANONICAL_WORKER_BEFORE,
    OPTION_CANONICAL_WORKER_AFTER,
    "shopling_stock_hf46_option_a21_worker_wait",
  );
}
