importScripts("background-v076.js");

// HF53: Shopling reuses the named A21 transmit popup. A stale pre-submit popup
// can therefore receive a new window.open call while its old extension worker is
// still waiting for an assignment. Clear only the exact, objectively safe stale
// state before the list worker is allowed to click 상품 수정전송. Ambiguous,
// processing, submitted, or completed popups fail closed and are never removed.
(() => {
  const VERSION_V077 = chrome.runtime.getManifest().version;
  const PREFLIGHT = "A21_STALE_POPUP_PREFLIGHT_HF53";
  const POPUP_MATCH =
    "https://a.shopling.co.kr/prodlinkage/goods_mallMdfy_trsmt.phtml*";
  const RESULT_PATH = "/prod_a/prod_status_trsmt.phtml";
  const NO_POPUP_TIMEOUT_MS = 45_000;

  function exactResultUrl(raw) {
    try {
      const url = new URL(String(raw || ""));
      return (
        (url.hostname === "shopling.co.kr" ||
          url.hostname.endsWith(".shopling.co.kr")) &&
        url.pathname.toLowerCase() === RESULT_PATH
      );
    } catch {
      return false;
    }
  }

  async function inspectPopup(tabId) {
    const rows = await chrome.scripting
      .executeScript({
        target: { tabId, allFrames: true },
        func: () => {
          const norm = (value) =>
            String(value ?? "")
              .normalize("NFKC")
              .replace(/\s+/g, " ")
              .trim();
          const text = norm(
            document.body?.innerText ||
              document.body?.textContent ||
              document.documentElement?.innerText ||
              "",
          );
          const checkedRadios = [
            ...document.querySelectorAll('input[type="radio"]:checked'),
          ].map((input) => {
            const id = String(input.id || "");
            const labelled = id
              ? document.querySelector(`label[for="${CSS.escape(id)}"]`)
              : null;
            return norm(
              labelled?.textContent ||
                input.closest("label")?.textContent ||
                input.parentElement?.textContent ||
                `${input.name || ""} ${input.value || ""}`,
            ).slice(0, 200);
          });
          return {
            textLength: text.length,
            terminal:
              /상품\s*상태\s*변경\s*전송이\s*완료되었습니다|상품판매상태\s*송신이\s*완료되었습니다|상품\s*수정\s*전송이\s*완료되었습니다/i.test(
                text,
              ),
            processing:
              /처리중입니다|잠시만\s*기다려주시기\s*바랍니다/i.test(text),
            staleMarker:
              /assignment\s*대기|popup_claim_not_unique|A21\s*상태전환\s*시간초과/i.test(
                text,
              ),
            hasTransmitForm:
              /상품수정\s*송신/i.test(text) && /일반내용수정/i.test(text),
            generalChecked: checkedRadios.some((value) =>
              /일반내용수정/i.test(value),
            ),
            mutationModeChecked: checkedRadios.some((value) =>
              /상품판매상태송신|옵션송신|상품옵션/i.test(value),
            ),
            checkedRadios,
          };
        },
      })
      .catch(() => []);
    const frames = rows.map((row) => row?.result).filter(Boolean);
    const terminal = frames.some((frame) => frame.terminal);
    const processing = frames.some((frame) => frame.processing);
    const safeStalePreSubmit =
      !terminal &&
      !processing &&
      frames.some(
        (frame) =>
          frame.staleMarker &&
          frame.hasTransmitForm &&
          frame.generalChecked &&
          !frame.mutationModeChecked,
      );
    return { frames, terminal, processing, safeStalePreSubmit };
  }

  async function exactResultTabIds() {
    const tabs = await chrome.tabs.query({}).catch(() => []);
    return tabs
      .filter(
        (tab) =>
          Number.isInteger(tab?.id) &&
          exactResultUrl(tab.url || tab.pendingUrl),
      )
      .map((tab) => tab.id);
  }

  async function finishMissingPopup(jobId, beforeResultTabIds) {
    const active = await loadActive();
    if (
      !active ||
      active.status !== "RUNNING" ||
      active.job?.jobId !== jobId ||
      active.job?.productKind !== "SINGLE" ||
      active.stage !== "A21_LIST" ||
      active.singleA21CanonicalStage !== "POPUP_OPENING"
    ) {
      return;
    }
    const resultIds = await exactResultTabIds();
    const newResultIds = resultIds.filter(
      (tabId) => !beforeResultTabIds.includes(tabId),
    );
    const popupTabs = await chrome.tabs.query({ url: POPUP_MATCH }).catch(() => []);
    if (newResultIds.length || popupTabs.length) {
      await finish(
        active,
        "UNCERTAIN",
        `${active.job.barcode} · 상품 수정전송 클릭 뒤 결과창 또는 전송창이 남아 있어 중복 재시도를 차단했습니다.`,
        {
          code: "A21_POPUP_CLAIM_TIMEOUT_EXTERNAL_STATE_PRESENT_HF53",
          priorA21TransmissionSubmitted: null,
          retryAllowedAutomatically: false,
          popupTabIds: popupTabs.map((tab) => tab.id),
          newResultTabIds: newResultIds,
          extensionVersion: VERSION_V077,
        },
      );
      return;
    }
    await finish(
      active,
      "FAILED",
      `${active.job.barcode} · 상품 수정전송 팝업이 열리지 않아 외부 전송 없이 종료했습니다.`,
      {
        code: "A21_POPUP_NOT_OPENED_HF53",
        priorA21TransmissionSubmitted: false,
        retryAllowedAutomatically: true,
        extensionVersion: VERSION_V077,
      },
    );
  }

  async function preflight(message) {
    const active = await loadActive();
    const jobId = String(message?.jobId || "");
    if (
      !active ||
      active.status !== "RUNNING" ||
      active.job?.jobId !== jobId ||
      active.stage !== "A21_LIST"
    ) {
      return {
        ok: false,
        code: "A21_STALE_POPUP_PREFLIGHT_JOB_MISMATCH_HF53",
        message:
          "현재 재고 작업과 A21 목록 작업이 일치하지 않아 상품 수정전송을 클릭하지 않았습니다.",
      };
    }

    const beforeResultTabIds = await exactResultTabIds();
    const tabs = await chrome.tabs.query({ url: POPUP_MATCH }).catch(() => []);
    const closedTabIds = [];
    for (const tab of tabs) {
      if (!Number.isInteger(tab?.id)) continue;
      const inspection = await inspectPopup(tab.id);
      if (!inspection.safeStalePreSubmit) {
        return {
          ok: false,
          code: "A21_EXISTING_POPUP_NOT_SAFE_TO_CLOSE_HF53",
          message:
            "기존 A21 전송창이 처리 중이거나 안전한 미전송 상태임을 확인할 수 없어 새 전송을 차단했습니다.",
          existingPopupTabId: tab.id,
          terminal: inspection.terminal,
          processing: inspection.processing,
        };
      }
      await chrome.tabs.remove(tab.id).catch(() => null);
      if (!(await chrome.tabs.get(tab.id).catch(() => null))) {
        closedTabIds.push(tab.id);
      }
    }
    const remaining = await chrome.tabs.query({ url: POPUP_MATCH }).catch(() => []);
    if (remaining.length) {
      return {
        ok: false,
        code: "A21_STALE_POPUP_CLOSE_NOT_CONFIRMED_HF53",
        message:
          "기존 A21 미전송 팝업 종료를 확인하지 못해 새 전송을 차단했습니다.",
      };
    }

    setTimeout(
      () => void finishMissingPopup(jobId, beforeResultTabIds),
      NO_POPUP_TIMEOUT_MS,
    );
    return {
      ok: true,
      closedSafeStalePopupTabIds: closedTabIds,
      ambiguousPopupClosed: false,
      beforeResultTabIds,
      extensionVersion: VERSION_V077,
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== PREFLIGHT) return;
    void preflight(message)
      .then(sendResponse)
      .catch((error) =>
        sendResponse({
          ok: false,
          code: "A21_STALE_POPUP_PREFLIGHT_EXCEPTION_HF53",
          message: String(error?.message || error || "A21 popup preflight failed"),
        }),
      );
    return true;
  });
})();
