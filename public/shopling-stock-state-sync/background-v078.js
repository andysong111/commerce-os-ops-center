importScripts("background-v077.js");

// HF54: the browser can retain many Shopling work tabs. HF50 inspected them
// sequentially, so the Commerce OS page's seven-second read-only login preflight
// could time out before the extension answered. Inspect the most recent tabs in
// parallel, bound every individual inspection, and keep this path write-free.
(() => {
  const REQUEST = "STOCK_SYNC_SESSION_PREFLIGHT_HF54";
  const SHOPLING_MATCH = "https://a.shopling.co.kr/*";
  const MAX_RECENT_TABS = 32;
  const PER_TAB_TIMEOUT_MS = 2_500;

  function recentFirst(left, right) {
    if (Boolean(left?.active) !== Boolean(right?.active)) {
      return left?.active ? -1 : 1;
    }
    return Number(right?.lastAccessed || 0) - Number(left?.lastAccessed || 0);
  }

  async function inspectTab(tab) {
    if (!Number.isInteger(tab?.id)) return null;
    let timer = null;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), PER_TAB_TIMEOUT_MS);
    });
    const inspection = chrome.scripting
      .executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: () => {
          const body = String(
            document.body?.innerText ||
              document.body?.textContent ||
              document.documentElement?.innerText ||
              "",
          ).normalize("NFKC");
          const authenticated =
            /로그아웃/.test(body) ||
            [...document.querySelectorAll("a[href]")].some((anchor) =>
              /logout/i.test(String(anchor.getAttribute("href") || "")),
            );
          const loginPage =
            /\/login\.phtml/i.test(String(location.pathname || "")) ||
            Boolean(document.querySelector('input[type="password"]'));
          return { authenticated, loginPage, href: String(location.href || "") };
        },
      })
      .then((frames) => ({
        tabId: tab.id,
        authenticated: frames.some(
          (frame) => frame.result?.authenticated === true,
        ),
        loginPage: frames.some((frame) => frame.result?.loginPage === true),
      }))
      .catch(() => null);
    try {
      return await Promise.race([inspection, timeout]);
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }

  async function preflight() {
    const tabs = await chrome.tabs.query({ url: SHOPLING_MATCH }).catch(() => []);
    const candidates = [...tabs]
      .sort(recentFirst)
      .slice(0, MAX_RECENT_TABS);
    const inspections = await Promise.all(candidates.map(inspectTab));
    const authenticated = inspections.find((row) => row?.authenticated);
    if (authenticated) {
      return {
        ok: true,
        authenticated: true,
        tabId: authenticated.tabId,
        checkedTabCount: tabs.length,
        inspectedTabCount: candidates.length,
        parallelInspection: true,
      };
    }
    return {
      ok: false,
      authenticated: false,
      code: "SHOPLING_LOGIN_REQUIRED_BEFORE_START",
      message: tabs.length
        ? "Shopling 로그인 세션이 만료되었습니다. 관리자 메인 탭에서 로그인한 뒤 다시 실행해 주세요. 아직 전송 시작 기록이나 Shopling 변경은 만들지 않았습니다."
        : "로그인된 Shopling 관리자 메인 탭을 1개 열어 주세요. 아직 전송 시작 기록이나 Shopling 변경은 만들지 않았습니다.",
      checkedTabCount: tabs.length,
      inspectedTabCount: candidates.length,
      loginPageDetected: inspections.some((row) => row?.loginPage),
      parallelInspection: true,
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== REQUEST) return;
    void preflight()
      .then(sendResponse)
      .catch((error) =>
        sendResponse({
          ok: false,
          authenticated: false,
          code: "SHOPLING_SESSION_PREFLIGHT_FAILED",
          message: String(
            error?.message || error || "Shopling 로그인 상태를 확인하지 못했습니다.",
          ),
        }),
      );
    return true;
  });
})();
