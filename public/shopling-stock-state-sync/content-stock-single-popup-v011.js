(() => {
  const VERSION = chrome.runtime.getManifest().version;
  const CLAIM = "STOCK_SINGLE_POPUP_CLAIM_V011";
  const STAGE = "STOCK_SINGLE_POPUP_STAGE_V011";
  const FAILURE = "STOCK_SINGLE_POPUP_FAILURE_V011";
  const TARGET_PATH = "/prodlinkage/goods_mallMdfy_trsmt.phtml";
  const MAIN_REQUEST = "commerce-os-stock-main-click";
  const MAIN_RESULT = "commerce-os-stock-main-click-result";
  const MAIN_TOKEN_ATTRIBUTE = "data-commerce-os-stock-click-token";
  let busy = false;

  const norm = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  const compact = (value) => norm(value).replace(/\s+/g, "");
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function isExactPopupUrl() {
    try {
      const parsed = new URL(String(location.href || ""));
      return parsed.origin === "https://a.shopling.co.kr" && parsed.pathname.toLowerCase() === TARGET_PATH.toLowerCase();
    } catch {
      return false;
    }
  }

  function visible(element) {
    if (!(element instanceof HTMLElement)) return true;
    const rect = element.getBoundingClientRect();
    return element.offsetParent !== null || rect.width > 0 || rect.height > 0;
  }

  function controlText(element) {
    if (!element) return "";
    const values = [
      element.textContent,
      element.value,
      element.title,
      element.alt,
      element.name,
      element.id,
      element.getAttribute?.("aria-label"),
    ];
    if (element.id) {
      const label = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
      if (label) values.push(label.textContent);
    }
    const wrappingLabel = element.closest?.("label");
    if (wrappingLabel) values.push(wrappingLabel.textContent);
    return norm(values.filter(Boolean).join(" "));
  }

  function localText(element) {
    const values = [controlText(element)];
    let cursor = element?.parentElement;
    for (let depth = 0; cursor && depth < 3; depth += 1) {
      values.push(cursor.textContent || "");
      cursor = cursor.parentElement;
    }
    return norm(values.join(" "));
  }

  function setCheck(control, checked = true) {
    if (!(control instanceof HTMLInputElement) || !["radio", "checkbox"].includes(control.type)) return false;
    if (control.checked !== checked) control.click();
    control.checked = checked;
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
    return control.checked === checked;
  }

  function radioByAdjacentText(pattern) {
    const controls = [...document.querySelectorAll('input[type="radio"],input[type="checkbox"]')]
      .filter(visible)
      .filter((control) => pattern.test(compact(localText(control))));
    controls.sort((left, right) => localText(left).length - localText(right).length);
    return controls[0] || null;
  }

  function buttonByText(pattern) {
    const selector = 'button,input[type="button"],input[type="submit"],input[type="image"],a,[onclick],img[alt],img[title]';
    const candidates = [...document.querySelectorAll(selector)].filter(visible);
    const matches = candidates.filter((element) => pattern.test(controlText(element)));
    matches.sort((left, right) => controlText(left).length - controlText(right).length);
    const candidate = matches[0] || null;
    if (candidate instanceof HTMLImageElement) return candidate.closest("a,button,input,[onclick]") || candidate;
    return candidate;
  }

  function clickViaMain(element) {
    return new Promise((resolve) => {
      if (!element) return resolve({ ok: false, code: "CLICK_TARGET_MISSING", alerts: [] });
      const token = `stock-single-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      element.setAttribute(MAIN_TOKEN_ATTRIBUTE, token);
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        window.removeEventListener(MAIN_RESULT, listener);
        resolve(value);
      };
      const listener = (event) => {
        if (norm(event?.detail?.token) !== token) return;
        finish(event.detail || { ok: false, code: "MAIN_CLICK_EMPTY_RESULT", alerts: [] });
      };
      window.addEventListener(MAIN_RESULT, listener);
      window.dispatchEvent(new CustomEvent(MAIN_REQUEST, { detail: { token } }));
      window.setTimeout(() => finish({ ok: true, code: "MAIN_CLICK_NAVIGATED_OR_PENDING", alerts: [] }), 3500);
    });
  }

  function alertFailure(alerts) {
    const text = (Array.isArray(alerts) ? alerts : []).map((item) => norm(item)).join(" | ");
    return /실패|오류|선택.*없|선택.*하|체크.*없|필수|없습니다|불가|잘못/i.test(text) ? text : "";
  }

  async function fail(jobId, code, message, evidence = null) {
    return chrome.runtime.sendMessage({ type: FAILURE, jobId, code, message, evidence, version: VERSION }).catch(() => null);
  }

  async function stage(jobId, nextStage, extra = {}) {
    return chrome.runtime.sendMessage({ type: STAGE, jobId, stage: nextStage, ...extra, version: VERSION }).catch(() => null);
  }

  async function configureAndSubmit(assignment) {
    if (busy || !assignment?.jobId) return;
    busy = true;
    try {
      const desiredStatus = String(assignment.desiredStatus || "").toUpperCase();
      const targetLabel = desiredStatus === "SOLD_OUT" ? "품절" : desiredStatus === "ON_SALE" ? "판매중" : "";
      if (!targetLabel) return fail(assignment.jobId, "SINGLE_A21_DESIRED_STATUS_INVALID", "단품 상품판매상태 목표값이 올바르지 않습니다.");

      const mode = radioByAdjacentText(/상품판매상태송신/i);
      if (!mode || !setCheck(mode, true)) {
        return fail(assignment.jobId, "SINGLE_A21_SALE_STATUS_MODE_NOT_FOUND", "A21 상품판매상태송신 모드를 선택하지 못했습니다.");
      }
      const target = radioByAdjacentText(new RegExp(`(^|[^가-힣])${targetLabel}([^가-힣]|$)`, "i"));
      if (!target || !setCheck(target, true)) {
        return fail(assignment.jobId, "SINGLE_A21_TARGET_STATUS_NOT_FOUND", `A21 상품판매상태 ${targetLabel} 버튼을 찾지 못했습니다.`);
      }
      if (!mode.checked || !target.checked) {
        return fail(assignment.jobId, "SINGLE_A21_CONFIGURATION_CHANGED", "송신 직전 상품판매상태 설정이 유지되지 않았습니다.");
      }

      const button = buttonByText(/^상품수정\s*송신$/i);
      if (!button) return fail(assignment.jobId, "SINGLE_A21_SUBMIT_BUTTON_NOT_FOUND", "A21 상품수정 송신 버튼을 찾지 못했습니다.");
      await stage(assignment.jobId, "SUBMIT_CLICKING", { goodsKey: assignment.goodsKey, desiredStatus, targetLabel });
      const click = await clickViaMain(button);
      const failure = alertFailure(click?.alerts);
      if (!click?.ok || failure) {
        return fail(assignment.jobId, "SINGLE_A21_SUBMIT_REJECTED", failure || click?.message || "A21 상품판매상태 송신이 거절됐습니다.", click);
      }
      await stage(assignment.jobId, "RESULT_WAIT", { goodsKey: assignment.goodsKey, desiredStatus, targetLabel, click });
    } catch (error) {
      await fail(assignment.jobId, "SINGLE_A21_POPUP_EXCEPTION", error instanceof Error ? error.message : String(error));
    } finally {
      busy = false;
    }
  }

  async function claim() {
    if (!isExactPopupUrl() || busy) return;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await chrome.runtime.sendMessage({ type: CLAIM, href: location.href, version: VERSION }).catch(() => null);
      if (response?.ok && response.assignment?.jobId) return configureAndSubmit(response.assignment);
      if (response?.error && !["stock_single_popup_not_ready", "stock_single_popup_no_active_job"].includes(response.error)) return;
      await sleep(250);
    }
  }

  setTimeout(() => void claim(), 80);
  window.addEventListener("load", () => setTimeout(() => void claim(), 80), { once: true });
})();
