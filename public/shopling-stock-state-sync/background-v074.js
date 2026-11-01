importScripts("background-v073.js");

// HF50: read-only login preflight. No Shopling navigation, click, or write is
// allowed here. Commerce OS asks this before it records STARTED or launches a job.
(() => {
  const REQUEST = "STOCK_SYNC_SESSION_PREFLIGHT";
  const SHOPLING_MATCH = "https://a.shopling.co.kr/*";

  async function inspectTab(tab) {
    if (!Number.isInteger(tab?.id)) return null;
    const frames = await chrome.scripting.executeScript({
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
    }).catch(() => []);
    return {
      tabId: tab.id,
      authenticated: frames.some((frame) => frame.result?.authenticated === true),
      loginPage: frames.some((frame) => frame.result?.loginPage === true),
    };
  }

  async function preflight() {
    const tabs = await chrome.tabs.query({ url: SHOPLING_MATCH }).catch(() => []);
    const inspections = [];
    for (const tab of tabs) inspections.push(await inspectTab(tab));
    const authenticated = inspections.find((row) => row?.authenticated);
    if (authenticated) {
      return {
        ok: true,
        authenticated: true,
        tabId: authenticated.tabId,
        checkedTabCount: tabs.length,
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
      loginPageDetected: inspections.some((row) => row?.loginPage),
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
          message: String(error?.message || error || "Shopling 로그인 상태를 확인하지 못했습니다."),
        }),
      );
    return true;
  });
})();
