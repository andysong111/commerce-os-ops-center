function replaceOnce(source: string, before: string, after: string, code: string) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${code}:anchor_missing`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${code}:anchor_not_unique`);
  }
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

const ROLE_ORDER_BEFORE = `      else if (hasExact("옵션자체관리코드")) role = "A6";
      else if (hasExact("샵플링상품코드") && (/쇼핑몰상품수정/i.test(text) || /상품\\s*수정전송/i.test(text))) role = "A21_LIST";
      else if ((path === "/prod/prodlst.phtml" && hasExact("샵플링상품코드")) || (/상품조회수정/i.test(text) && /검색항목/i.test(text))) role = "A4";`;

const ROLE_ORDER_AFTER = `      else if (hasExact("옵션자체관리코드")) role = "A6";
      else if ((path === "/prod/prodlst.phtml" && hasExact("샵플링상품코드")) || (/상품조회수정/i.test(text) && /검색항목/i.test(text))) role = "A4";
      else if (hasExact("샵플링상품코드") && /쇼핑몰상품수정/i.test(text) && /상품\\s*수정전송/i.test(text)) role = "A21_LIST";`;

const CANONICAL_WORKER_BEFORE = `  async function ensureCanonicalListWorkerV057(target) {
    if (!target || !Number.isInteger(target.tabId) || !Number.isInteger(target.frameId)) return false;
    const options = { frameId: target.frameId };
    let probe = await chrome.tabs.sendMessage(target.tabId, { type: CANONICAL_IDENTIFY }, options).catch(() => null);
    if (probe?.ok && probe.role === "A21_LIST") return true;
    await chrome.scripting.executeScript({
      target: { tabId: target.tabId, frameIds: [target.frameId] },
      files: [CANONICAL_LIST_SCRIPT],
    }).catch(() => null);
    await sleep(140);
    probe = await chrome.tabs.sendMessage(target.tabId, { type: CANONICAL_IDENTIFY }, options).catch(() => null);
    return Boolean(probe?.ok && probe.role === "A21_LIST");
  }`;

const CANONICAL_WORKER_AFTER = `  async function ensureCanonicalListWorkerV057(target) {
    if (!target || !Number.isInteger(target.tabId) || !Number.isInteger(target.frameId)) return false;
    const options = { frameId: target.frameId };
    const deadlineHf39 = Date.now() + 8_000;
    let injectedHf39 = false;
    while (Date.now() < deadlineHf39) {
      const probe = await chrome.tabs.sendMessage(target.tabId, { type: CANONICAL_IDENTIFY }, options).catch(() => null);
      if (probe?.ok && probe.role === "A21_LIST") return true;
      if (!injectedHf39) {
        injectedHf39 = true;
        await chrome.scripting.executeScript({
          target: { tabId: target.tabId, frameIds: [target.frameId] },
          files: [CANONICAL_LIST_SCRIPT],
        }).catch(() => null);
      }
      await sleep(250);
    }
    return false;
  }`;

export function patchShoplingStockHf39Coordinator(source: string) {
  return replaceOnce(
    source.replace(/\r\n/g, "\n"),
    ROLE_ORDER_BEFORE,
    ROLE_ORDER_AFTER,
    "shopling_stock_hf39_a4_before_a21",
  );
}

export function patchShoplingStockHf39SingleBatch(source: string) {
  return replaceOnce(
    source.replace(/\r\n/g, "\n"),
    CANONICAL_WORKER_BEFORE,
    CANONICAL_WORKER_AFTER,
    "shopling_stock_hf39_a21_worker_wait",
  );
}
