importScripts("background-v095.js");

// HF86: the A21 list button opens a named popup with window.open. A synthetic
// HTMLElement.click() is not a browser-trusted user gesture, so Chrome may block
// the popup while the old bridge still reports success. Dispatch one trusted CDP
// mouse click and acknowledge success only after the exact Shopling popup exists.
(() => {
  const REQUEST_HF86 = "A21_TRUSTED_MODIFY_SEND_CLICK_HF86";
  const DEBUGGER_VERSION_HF86 = "1.3";
  const POPUP_URLS_HF86 = [
    "https://a.shopling.co.kr/prodlinkage/goods_mallMdfy_trsmt.phtml*",
    "https://kt.shopling.co.kr/prodlinkage/goods_mallMdfy_trsmt.phtml*",
  ];
  const sleepHf86 = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const normHf86 = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();

  function expectedListTabHf86(active) {
    const candidates = [
      active?.a21ExecutionWorkerHf76?.tabId,
      active?.workTabs?.A21_LIST?.tabId,
      active?.shoplingTabId,
    ];
    return candidates.map(Number).find(Number.isInteger) ?? null;
  }

  async function popupIdsHf86() {
    const tabs = await chrome.tabs.query({ url: POPUP_URLS_HF86 }).catch(() => []);
    return new Set(tabs.map((tab) => Number(tab?.id)).filter(Number.isInteger));
  }

  async function exactButtonRectHf86(tabId, frameId) {
    const results = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      world: "MAIN",
      func: () => {
        const norm = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
        const visible = (node) => {
          const rect = node?.getBoundingClientRect?.();
          return Boolean(rect && rect.width > 0 && rect.height > 0);
        };
        const label = (node) => norm([
          node?.value,
          node?.textContent,
          node?.getAttribute?.("aria-label"),
          node?.getAttribute?.("title"),
          node?.getAttribute?.("alt"),
        ].filter(Boolean).join(" "));
        const candidates = [...document.querySelectorAll('button,input[type="button"],input[type="submit"],a,[onclick]')]
          .filter(visible)
          .filter((node) => /상품\s*수정전송/.test(label(node)));
        if (candidates.length !== 1) {
          return { ok: false, code: candidates.length ? "HF86_BUTTON_AMBIGUOUS" : "HF86_BUTTON_MISSING", count: candidates.length };
        }
        const button = candidates[0];
        const onclick = norm(button.getAttribute("onclick") || "");
        if (!/goods_mallMody_submit\s*\(/.test(onclick)) {
          return { ok: false, code: "HF86_NATIVE_HANDLER_MISMATCH", onclick };
        }
        button.scrollIntoView({ block: "center", inline: "center" });
        const rect = button.getBoundingClientRect();
        return {
          ok: true,
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
          width: rect.width,
          height: rect.height,
          onclick,
        };
      },
    }).catch(() => []);
    return results.find((entry) => entry.frameId === frameId)?.result || null;
  }

  async function attachDebuggerHf86(tabId) {
    try {
      await chrome.debugger.attach({ tabId }, DEBUGGER_VERSION_HF86);
      return { ok: true, attachedHere: true };
    } catch (error) {
      const probe = await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
        expression: "1",
        returnByValue: true,
      }).catch(() => null);
      if (probe) return { ok: true, attachedHere: false };
      return {
        ok: false,
        attachedHere: false,
        code: "HF86_DEBUGGER_ATTACH_FAILED",
        message: normHf86(error?.message || error || "Chrome debugger 연결 실패"),
      };
    }
  }

  async function waitForNewPopupHf86(tabId, baseline) {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const tabs = await chrome.tabs.query({ url: POPUP_URLS_HF86 }).catch(() => []);
      const popup = tabs.find((tab) => {
        const id = Number(tab?.id);
        if (!Number.isInteger(id) || baseline.has(id)) return false;
        return !Number.isInteger(tab?.openerTabId) || Number(tab.openerTabId) === tabId;
      });
      if (Number.isInteger(popup?.id)) return popup;
      await sleepHf86(100);
    }
    return null;
  }

  async function trustedClickHf86(message, sender) {
    const tabId = Number(sender?.tab?.id);
    const frameId = Number(sender?.frameId ?? 0);
    if (!Number.isInteger(tabId) || !Number.isInteger(frameId)) {
      return { ok: false, code: "HF86_SENDER_MISSING", message: "A21 실행 탭 정보를 확인하지 못했습니다." };
    }
    if (frameId !== 0) {
      return { ok: false, code: "HF86_TOP_FRAME_REQUIRED", message: "A21 목록의 최상위 실행 프레임을 확인하지 못했습니다." };
    }
    const active = await loadActive().catch(() => null);
    const expectedTabId = expectedListTabHf86(active);
    if (
      !active ||
      active.status !== "RUNNING" ||
      String(active?.job?.jobId || "") !== String(message?.jobId || "") ||
      !Number.isInteger(expectedTabId) ||
      expectedTabId !== tabId
    ) {
      return { ok: false, code: "HF86_ASSIGNMENT_OWNER_MISMATCH", message: "현재 작업과 A21 목록 탭 소유권이 일치하지 않아 클릭하지 않았습니다." };
    }
    if (normHf86(message?.expectedHandler) !== "goods_mallMody_submit") {
      return { ok: false, code: "HF86_HANDLER_CONTRACT_MISMATCH", message: "Shopling 원본 버튼 함수 계약이 일치하지 않습니다." };
    }

    const rect = await exactButtonRectHf86(tabId, frameId);
    if (!rect?.ok || !Number.isFinite(rect.x) || !Number.isFinite(rect.y)) {
      return {
        ok: false,
        code: rect?.code || "HF86_BUTTON_RECT_FAILED",
        message: "상품 수정전송 단추의 정확한 화면 위치를 확인하지 못했습니다.",
        evidence: rect || null,
      };
    }

    const baseline = await popupIdsHf86();
    const debuggerState = await attachDebuggerHf86(tabId);
    if (!debuggerState.ok) return debuggerState;
    try {
      await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: rect.x,
        y: rect.y,
      });
      await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: rect.x,
        y: rect.y,
        button: "left",
        clickCount: 1,
      });
      await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: rect.x,
        y: rect.y,
        button: "left",
        clickCount: 1,
      });
      const popup = await waitForNewPopupHf86(tabId, baseline);
      if (!popup) {
        return {
          ok: false,
          code: "HF86_TRUSTED_CLICK_POPUP_TIMEOUT",
          message: "Chrome 신뢰 클릭은 실행했지만 8초 안에 실제 Shopling 수정전송 팝업이 열리지 않았습니다.",
        };
      }
      return {
        ok: true,
        trustedClick: true,
        popupObserved: true,
        popupTabId: popup.id,
        popupWindowId: popup.windowId,
        code: "HF86_TRUSTED_CLICK_POPUP_CONFIRMED",
      };
    } catch (error) {
      return {
        ok: false,
        code: "HF86_TRUSTED_CLICK_DISPATCH_FAILED",
        message: normHf86(error?.message || error || "Chrome 신뢰 클릭 실패"),
      };
    } finally {
      if (debuggerState.attachedHere) {
        await chrome.debugger.detach({ tabId }).catch(() => null);
      }
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== REQUEST_HF86) return false;
    void trustedClickHf86(message, sender)
      .then(sendResponse)
      .catch((error) => sendResponse({
        ok: false,
        code: "HF86_TRUSTED_CLICK_UNHANDLED",
        message: normHf86(error?.message || error || "신뢰 클릭 처리 실패"),
      }));
    return true;
  });
})();
