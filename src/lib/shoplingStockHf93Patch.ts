const TRUSTED_CLICK_START =
  "  async function trustedClickHf86(message, sender) {";
const TRUSTED_CLICK_END =
  "\n\n  if (globalThis.__COMMERCE_OS_EXPOSE_STOCK_HF92_TRUSTED_TEST_HOOKS__ === true) {";

const TRUSTED_SELECTION_RECEIPT = String.raw`  async function ensureExactRowsSelectedHf93(tabId, frameId, message) {
    const goodsKeys = normHf86(message?.goodsKeyQuery)
      .split(",")
      .map((value) => normHf86(value))
      .filter((value) => /^\d+$/.test(value));
    const expectedSelectedRowCount = Number(message?.expectedSelectedRowCount);
    const expectedTotalResultCount = Number(message?.expectedTotalResultCount);
    if (
      goodsKeys.length < 1 ||
      !Number.isInteger(expectedSelectedRowCount) ||
      expectedSelectedRowCount < 1 ||
      expectedTotalResultCount !== expectedSelectedRowCount
    ) {
      return {
        ok: false,
        code: "HF93_SELECTION_RECEIPT_INPUT_INVALID",
        goodsKeys,
        expectedSelectedRowCount,
        expectedTotalResultCount,
      };
    }

    let last = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const results = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [frameId] },
        world: "MAIN",
        func: (input) => {
          const norm = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
          const keys = Array.isArray(input?.goodsKeys) ? input.goodsKeys.map(norm).filter(Boolean) : [];
          const expected = Number(input?.expectedSelectedRowCount);
          const rows = [...document.querySelectorAll("tr")]
            .map((row) => ({
              row,
              checkbox: [...row.querySelectorAll('input[type="checkbox"]')]
                .find((item) => !item.disabled) || null,
              text: norm(row.textContent || ""),
            }))
            .filter((entry) => entry.checkbox);
          const matched = rows.filter((entry) =>
            keys.some((key) => new RegExp("(^|\\D)" + key + "(\\D|$)").test(entry.text)),
          );
          if (matched.length !== expected) {
            return {
              ok: false,
              code: "HF93_EXACT_ROW_COUNT_MISMATCH",
              matchedRowCount: matched.length,
              expectedSelectedRowCount: expected,
            };
          }
          for (const entry of matched) {
            const checkbox = entry.checkbox;
            if (!checkbox.checked) checkbox.click();
            if (!checkbox.checked) {
              checkbox.checked = true;
              checkbox.dispatchEvent(new Event("input", { bubbles: true }));
              checkbox.dispatchEvent(new Event("change", { bubbles: true }));
            }
          }
          const checkedRowCount = matched.filter((entry) => entry.checkbox.checked).length;
          return {
            ok: checkedRowCount === expected,
            code: checkedRowCount === expected
              ? "HF93_EXACT_ROWS_SELECTED_IN_MAIN_WORLD"
              : "HF93_EXACT_ROW_SELECTION_NOT_STABLE",
            matchedRowCount: matched.length,
            checkedRowCount,
            expectedSelectedRowCount: expected,
          };
        },
        args: [{ goodsKeys, expectedSelectedRowCount }],
      }).catch(() => []);
      last = results.find((entry) => entry?.frameId === frameId)?.result || results[0]?.result || null;
      if (last?.ok === true) {
        return {
          ...last,
          ok: true,
          attempt,
          goodsKeys,
          verifiedAt: Date.now(),
        };
      }
      if (attempt < 3) await sleepHf86(120);
    }
    return {
      ...(last || {}),
      ok: false,
      code: String(last?.code || "HF93_EXACT_ROW_SELECTION_FAILED"),
      goodsKeys,
      attempts: 3,
    };
  }

  async function waitForPopupOrSelectionDialogHf93(tabId, baseline, readDialog) {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const tabs = await chrome.tabs.query({ url: POPUP_URLS_HF86 }).catch(() => []);
      const popup = tabs.find((tab) => {
        const id = Number(tab?.id);
        if (!Number.isInteger(id) || baseline.has(id)) return false;
        return !Number.isInteger(tab?.openerTabId) || Number(tab.openerTabId) === tabId;
      });
      if (Number.isInteger(popup?.id)) return { popup, dialog: null };
      const dialog = readDialog();
      if (dialog) return { popup: null, dialog };
      await sleepHf86(100);
    }
    return { popup: null, dialog: readDialog() };
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
    let selectionDialog = null;
    let selectionDialogClosePromise = Promise.resolve(null);
    let selectionReceipt = null;
    const canObserveDialogs = Boolean(chrome.debugger?.onEvent?.addListener);
    const onDebuggerEventHf93 = (source, method, params) => {
      if (Number(source?.tabId) !== tabId || method !== "Page.javascriptDialogOpening") return;
      const dialogMessage = normHf86(params?.message || "");
      if (!/수정\s*전송할\s*자료를\s*선택하여\s*주세요/.test(dialogMessage)) return;
      selectionDialog = {
        message: dialogMessage,
        type: normHf86(params?.type || "alert"),
        observedAt: Date.now(),
      };
      selectionDialogClosePromise = chrome.debugger.sendCommand(
        { tabId },
        "Page.handleJavaScriptDialog",
        { accept: true },
      ).catch(() => null);
    };
    if (canObserveDialogs) {
      chrome.debugger.onEvent.addListener(onDebuggerEventHf93);
      await chrome.debugger.sendCommand({ tabId }, "Page.enable").catch(() => null);
    }
    try {
      selectionReceipt = await ensureExactRowsSelectedHf93(tabId, frameId, message);
      if (!selectionReceipt?.ok) {
        return {
          ok: false,
          code: String(selectionReceipt?.code || "HF93_EXACT_ROW_SELECTION_FAILED"),
          message: "상품 수정전송 직전 정확한 상품 행 선택을 다시 확인하지 못해 클릭하지 않았습니다.",
          retrySafe: true,
          selectionReceipt,
        };
      }
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
      const outcome = await waitForPopupOrSelectionDialogHf93(
        tabId,
        baseline,
        () => selectionDialog,
      );
      if (outcome.popup) {
        return {
          ok: true,
          trustedClick: true,
          popupObserved: true,
          popupTabId: outcome.popup.id,
          popupWindowId: outcome.popup.windowId,
          selectionReceipt,
          code: "HF93_TRUSTED_CLICK_POPUP_CONFIRMED_AFTER_SELECTION_RECEIPT",
        };
      }
      if (outcome.dialog) {
        await selectionDialogClosePromise;
        return {
          ok: false,
          code: "HF93_SELECTION_DIALOG_CAUGHT",
          message: "Shopling이 선택 자료 없음으로 거부해 경고창을 닫고 이 건을 즉시 재시도 대상으로 전환했습니다.",
          retrySafe: true,
          popupObserved: false,
          selectionReceipt,
          dialog: outcome.dialog,
        };
      }
      return {
        ok: false,
        code: "HF86_TRUSTED_CLICK_POPUP_TIMEOUT",
        message: "Chrome 신뢰 클릭은 실행했지만 8초 안에 실제 Shopling 수정전송 팝업이 열리지 않았습니다.",
        selectionReceipt,
      };
    } catch (error) {
      // The exact new popup is authoritative even if Chrome detaches the A21
      // source tab while the trusted click is being handled.
      const popup = await waitForNewPopupHf86(tabId, baseline);
      if (popup) {
        return {
          ok: true,
          trustedClick: true,
          popupObserved: true,
          popupTabId: popup.id,
          popupWindowId: popup.windowId,
          dispatchDetachedRecovered: true,
          dispatchError: normHf86(error?.message || error || "Chrome 대상 분리"),
          selectionReceipt,
          code: "HF92_TRUSTED_CLICK_DETACHED_POPUP_CONFIRMED",
        };
      }
      return {
        ok: false,
        code: "HF86_TRUSTED_CLICK_DISPATCH_FAILED",
        message: normHf86(error?.message || error || "Chrome 신뢰 클릭 실패"),
        retrySafe: true,
        popupObserved: false,
        selectionReceipt,
      };
    } finally {
      if (canObserveDialogs) {
        chrome.debugger.onEvent.removeListener(onDebuggerEventHf93);
      }
      if (debuggerState.attachedHere) {
        await chrome.debugger.detach({ tabId }).catch(() => null);
      }
    }
  }`;

export function patchHf93TrustedSelectionReceipt(source: string) {
  const normalized = source.replace(/\r\n?/g, "\n");
  const start = normalized.indexOf(TRUSTED_CLICK_START);
  const end = normalized.indexOf(TRUSTED_CLICK_END, start);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error("shopling_stock_hf93_trusted_click_marker_missing");
  }
  const patched = `${normalized.slice(0, start)}${TRUSTED_SELECTION_RECEIPT}${normalized.slice(end)}`;
  for (const guard of [
    "ensureExactRowsSelectedHf93",
    'world: "MAIN"',
    "expectedSelectedRowCount",
    "HF93_EXACT_ROWS_SELECTED_IN_MAIN_WORLD",
    "Page.javascriptDialogOpening",
    "Page.handleJavaScriptDialog",
    "HF93_SELECTION_DIALOG_CAUGHT",
    "HF92_TRUSTED_CLICK_DETACHED_POPUP_CONFIRMED",
  ]) {
    if (!patched.includes(guard)) {
      throw new Error(`shopling_stock_hf93_trusted_guard_missing:${guard}`);
    }
  }
  return patched;
}

export function patchHf93CanonicalSelectionReceipt(source: string) {
  const normalized = source.replace(/\r\n?/g, "\n");
  const signature = "  async function clickModifySend(assignment) {";
  const requestMarker = `      expectedHandler: "goods_mallMody_submit",`;
  const call = "    const modifySend = await clickModifySend(assignment);";
  if (
    !normalized.includes(signature) ||
    !normalized.includes(requestMarker) ||
    !normalized.includes(call)
  ) {
    throw new Error("shopling_stock_hf93_canonical_marker_missing");
  }
  const patched = normalized
    .replace(
      signature,
      "  async function clickModifySend(assignment, selectionReceipt = {}) {",
    )
    .replace(
      requestMarker,
      `${requestMarker}\n      expectedSelectedRowCount: Number(selectionReceipt?.selectedRowCount || 0),\n      expectedTotalResultCount: Number(selectionReceipt?.totalResultCount || 0),`,
    )
    .replace(
      call,
      "    const modifySend = await clickModifySend(assignment, { selectedRowCount: checked, totalResultCount: total });",
    );
  for (const guard of [
    "selectionReceipt = {}",
    "expectedSelectedRowCount",
    "expectedTotalResultCount",
    "selectedRowCount: checked",
    "totalResultCount: total",
  ]) {
    if (!patched.includes(guard)) {
      throw new Error(`shopling_stock_hf93_canonical_guard_missing:${guard}`);
    }
  }
  return patched;
}

export function patchHf93ProgressLabels(source: string) {
  const normalized = source.replace(/\r\n?/g, "\n");
  const replacements: Array<[string, string]> = [
    ["단품 A21 가격조정 원본 목록 엔진 연결 대기", "단품 A21 상품 원본 목록 엔진 연결 대기"],
    ["가격조정 원본 검색 제출 → 전체 정확일치 행 선택", "A21 상품 원본 검색 제출 → 전체 정확일치 행 선택"],
    ["단품 A21 가격조정 원본 목록 엔진 실행 실패", "단품 A21 상품 원본 목록 엔진 실행 실패"],
  ];
  let patched = normalized;
  for (const [before, after] of replacements) {
    if (!patched.includes(before)) {
      throw new Error(`shopling_stock_hf93_progress_label_missing:${before}`);
    }
    patched = patched.replaceAll(before, after);
  }
  if (patched.includes("가격조정 원본")) {
    throw new Error("shopling_stock_hf93_stale_price_label_remaining");
  }
  return patched;
}
