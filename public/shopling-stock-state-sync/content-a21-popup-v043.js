(() => {
  const VERSION = chrome.runtime.getManifest().version;
  const MAIN_REQUEST = "commerce-os-stock-main-click";
  const MAIN_RESULT = "commerce-os-stock-main-click-result";
  const MAIN_TOKEN_ATTRIBUTE = "data-commerce-os-stock-click-token";
  const handled = new Set();
  let lastEvidenceSignature = "";

  const norm = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  const compact = (value) => norm(value).replace(/\s+/g, "");
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const bodyText = () => norm(document.body?.innerText || document.body?.textContent || document.documentElement?.innerText || "");

  function visible(element) {
    if (!(element instanceof HTMLElement)) return true;
    const rect = element.getBoundingClientRect();
    return element.offsetParent !== null || rect.width > 0 || rect.height > 0;
  }

  function controlText(element) {
    if (!element) return "";
    const chunks = [];
    if (element instanceof HTMLInputElement) {
      chunks.push(element.value || "", element.title || "", element.alt || "", element.name || "", element.id || "", element.getAttribute("aria-label") || "");
    } else {
      chunks.push(element.textContent || "", element.getAttribute?.("title") || "", element.getAttribute?.("alt") || "", element.getAttribute?.("aria-label") || "");
    }
    return norm(chunks.join(" "));
  }

  function localControlText(control) {
    const chunks = [controlText(control)];
    if (control?.id) {
      const label = document.querySelector(`label[for="${CSS.escape(control.id)}"]`);
      if (label) chunks.push(label.textContent || "");
    }
    const wrappingLabel = control?.closest?.("label");
    if (wrappingLabel) chunks.push(wrappingLabel.textContent || "");
    for (const node of [control?.previousSibling, control?.nextSibling]) {
      if (node) chunks.push(node.textContent || "");
    }
    return norm(chunks.join(" "));
  }

  function adjacentText(control) {
    return norm(`${localControlText(control)} ${control?.parentElement?.textContent || ""}`);
  }

  function role() {
    const text = bodyText();
    if (/상품수정\s*송신/i.test(text) && (/일반내용수정/i.test(text) || /옵션송신/i.test(text) || /상품판매상태송신/i.test(text))) {
      return "A21_POPUP";
    }
    if (
      /상품(?:옵션)?\s*(?:수정\s*)?전송이\s*완료되었습니다/i.test(text) ||
      /상품판매상태\s*송신이\s*완료되었습니다/i.test(text) ||
      /처리중입니다/i.test(text) ||
      /성공건수\s*[:：]/i.test(text)
    ) {
      return "RESULT";
    }
    return "OTHER";
  }

  async function send(message) {
    return chrome.runtime.sendMessage({ ...message, version: VERSION }).catch(() => null);
  }

  function pageInfo() {
    return {
      role: role(),
      href: String(location.href || ""),
      title: String(document.title || ""),
      top: window.top === window,
      canNavigate: false,
    };
  }

  function setControl(control, checked = true) {
    if (!(control instanceof HTMLInputElement) || !["radio", "checkbox"].includes(control.type)) return false;
    if (checked && !control.checked) control.click();
    if (!checked && control.checked && control.type === "checkbox") control.click();
    control.checked = checked;
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
    return control.checked === checked;
  }

  function modeRadio(target) {
    const wanted = norm(target);
    const candidates = [...document.querySelectorAll('input[type="radio"]')]
      .filter((radio) => visible(radio) && adjacentText(radio).includes(wanted));
    candidates.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    return candidates[0] || null;
  }

  function optionSelectionControl() {
    const controls = [...document.querySelectorAll('input[type="radio"],input[type="checkbox"]')].filter(visible);
    const candidates = controls.filter((item) => {
      const text = adjacentText(item);
      return text.includes("옵션송신") && text.includes("선택") && !text.includes("추가상품송신") && !text.includes("옵션+추가상품송신");
    });
    candidates.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    return candidates[0] || null;
  }

  function configureOptionPopup() {
    const top = modeRadio("옵션송신");
    if (!setControl(top, true)) {
      return { ok: false, code: "A21_OPTION_MODE_NOT_FOUND", message: "상단 옵션송신 모드를 찾지 못했습니다." };
    }
    const control = optionSelectionControl();
    if (!setControl(control, true)) {
      return { ok: false, code: "A21_OPTION_SELECT_NOT_FOUND", message: "옵션송신 행의 선택 버튼을 찾지 못했습니다." };
    }
    for (const item of document.querySelectorAll('input[type="checkbox"]')) {
      const text = adjacentText(item);
      if (text.includes("추가상품송신") || text.includes("옵션+추가상품송신")) setControl(item, false);
    }
    const forbidden = [...document.querySelectorAll('input[type="checkbox"]')].filter((item) => {
      const text = adjacentText(item);
      return item.checked && (text.includes("추가상품송신") || text.includes("옵션+추가상품송신"));
    });
    if (!top.checked || !control.checked || forbidden.length) {
      return {
        ok: false,
        code: "A21_OPTION_CONFIGURATION_VERIFY_FAILED",
        message: "옵션송신 단독 선택 상태 검증에 실패했습니다.",
        evidence: { topChecked: Boolean(top.checked), optionSelected: Boolean(control.checked), forbiddenChecked: forbidden.length },
      };
    }
    return { ok: true, evidence: { mode: "OPTION_SEND", optionSelected: true, forbiddenChecked: 0 } };
  }

  function targetStatusControl(label) {
    const wanted = norm(label);
    const controls = [...document.querySelectorAll('input[type="radio"],input[type="checkbox"]')].filter(visible);
    const candidates = controls.filter((item) => {
      const text = adjacentText(item);
      return text.includes(wanted) && /판매상태|상품판매상태|품절|판매중/.test(text);
    });
    candidates.sort((a, b) => adjacentText(a).length - adjacentText(b).length);
    return candidates[0] || null;
  }

  function configureSaleStatusPopup(job) {
    const top = modeRadio("상품판매상태송신");
    if (!setControl(top, true)) {
      return { ok: false, code: "A21_SALE_STATUS_MODE_NOT_FOUND", message: "상품판매상태송신 모드를 찾지 못했습니다." };
    }
    const targetLabel = job.desiredStatus === "SOLD_OUT" ? "품절" : "판매중";
    const target = targetStatusControl(targetLabel);
    if (!setControl(target, true)) {
      return { ok: false, code: "A21_TARGET_STATUS_NOT_FOUND", message: `상품판매상태 ${targetLabel} 선택 버튼을 찾지 못했습니다.` };
    }
    if (!top.checked || !target.checked) {
      return { ok: false, code: "A21_SALE_STATUS_CONFIGURATION_VERIFY_FAILED", message: "상품판매상태송신 설정 검증에 실패했습니다." };
    }
    return { ok: true, evidence: { mode: "PRODUCT_SALE_STATUS", targetLabel } };
  }

  function submitButton() {
    const selector = 'button,input[type="button"],input[type="submit"],input[type="image"],a,[onclick],img[alt],img[title]';
    const nodes = [...document.querySelectorAll(selector)].filter(visible);
    let candidate = nodes.find((element) => /^상품수정\s*송신$/.test(controlText(element)));
    if (!candidate) candidate = nodes.find((element) => /상품수정\s*송신/.test(controlText(element)));
    if (!candidate) return null;
    if (candidate instanceof HTMLImageElement) return candidate.closest("a,button,input,[onclick]") || candidate;
    return candidate;
  }

  function clickViaMain(element) {
    return new Promise((resolve) => {
      if (!element) {
        resolve({ ok: false, code: "CLICK_TARGET_MISSING", alerts: [] });
        return;
      }
      const token = `stock-popup-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
    const message = norm((alerts || []).join(" "));
    if (!message) return null;
    if (/실패|오류|불가|없습니다|선택해|확인해|잘못/i.test(message)) return message;
    return null;
  }

  async function execute(message) {
    const job = message.job || {};
    const stage = String(message.stage || "");
    const goodsKey = norm(message.goodsKey);
    if (stage !== "A21_POPUP") {
      return { ok: false, ignored: true, code: "SHOPLING_POPUP_STAGE_NOT_TARGET", message: "현재 전용 worker는 A21 수정전송 팝업만 처리합니다." };
    }
    if (role() !== "A21_POPUP") {
      return { ok: false, waiting: true, code: "A21_POPUP_WAIT", message: "A21 수정전송 팝업 생성을 기다립니다." };
    }
    const key = `${job.jobId || "unknown"}:${job.executionId || ""}:${stage}:${goodsKey}:${location.href}`;
    if (handled.has(key)) return { ok: true, duplicate: true };
    handled.add(key);

    const configured = job.productKind === "OPTION" ? configureOptionPopup() : configureSaleStatusPopup(job);
    if (!configured.ok) {
      handled.delete(key);
      return configured;
    }
    await sleep(220);
    const recheck = job.productKind === "OPTION" ? configureOptionPopup() : configureSaleStatusPopup(job);
    if (!recheck.ok) {
      handled.delete(key);
      return recheck;
    }
    const button = submitButton();
    if (!button) {
      handled.delete(key);
      return { ok: false, code: "A21_SUBMIT_BUTTON_NOT_FOUND", message: "A21 상품수정 송신 버튼을 찾지 못했습니다." };
    }
    const click = await clickViaMain(button);
    const failure = alertFailure(click.alerts);
    if (!click.ok || failure) {
      handled.delete(key);
      return { ok: false, code: "A21_SUBMIT_REJECTED", message: failure || click.message || "A21 송신이 거절됐습니다.", evidence: { ...configured.evidence, click } };
    }
    return {
      ok: true,
      submitted: true,
      step: "A21_POPUP_SUBMITTED",
      message: job.productKind === "OPTION"
        ? `A21 goods key ${goodsKey} 옵션송신 단독 설정을 검증하고 상품수정 송신을 요청했습니다.`
        : `A21 goods key ${goodsKey} 상품판매상태 송신 설정을 검증하고 상품수정 송신을 요청했습니다.`,
      evidence: { goodsKey, ...configured.evidence, alerts: click.alerts || [] },
    };
  }

  function parseCounts(text) {
    const success = [...text.matchAll(/성공건수\s*[:：]?\s*([\d,]+)/gi)].reduce((total, match) => total + Number(match[1].replace(/,/g, "")), 0);
    const failure = [...text.matchAll(/실패건수\s*[:：]?\s*([\d,]+)/gi)].reduce((total, match) => total + Number(match[1].replace(/,/g, "")), 0);
    return { success, failure };
  }

  function resultEvidence() {
    const text = bodyText();
    const counts = parseCounts(text);
    return {
      processing: /처리중입니다/i.test(text) || /잠시만\s*기다려주시기\s*바랍니다/i.test(text),
      optionComplete:
        /상품\s*옵션\s*(?:수정\s*)?전송이\s*완료되었습니다/i.test(text) ||
        /상품옵션\s*전송이\s*완료되었습니다/i.test(text) ||
        /옵션\s*송신이\s*완료되었습니다/i.test(text),
      productComplete:
        /상품\s*수정\s*전송이\s*완료되었습니다/i.test(text) ||
        /상품판매상태\s*송신이\s*완료되었습니다/i.test(text),
      explicitFailure: /성공여부\s*[:：]?\s*실패/i.test(text) || /전송\s*실패|송신\s*실패|처리\s*실패/i.test(text),
      successCount: counts.success,
      failureCount: counts.failure,
      readyState: document.readyState,
      href: String(location.href || ""),
      title: String(document.title || ""),
      textSample: text.slice(-900),
      top: window.top === window,
    };
  }

  async function publishEvidence() {
    const evidence = resultEvidence();
    if (!evidence.processing && !evidence.optionComplete && !evidence.productComplete && evidence.successCount <= 0 && evidence.failureCount <= 0) return;
    const signature = JSON.stringify({
      processing: evidence.processing,
      optionComplete: evidence.optionComplete,
      productComplete: evidence.productComplete,
      explicitFailure: evidence.explicitFailure,
      successCount: evidence.successCount,
      failureCount: evidence.failureCount,
      href: evidence.href,
      textSample: evidence.textSample,
    });
    if (signature === lastEvidenceSignature) return;
    lastEvidenceSignature = signature;
    await send({ type: "STOCK_SYNC_RESULT_EVIDENCE", evidence });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "STOCK_SYNC_PROBE") {
      sendResponse({ ok: true, page: pageInfo(), version: VERSION });
      return;
    }
    if (message?.type !== "STOCK_SYNC_EXECUTE") return;
    sendResponse({ ok: true, accepted: true, version: VERSION });
    void execute(message)
      .then((result) => send({
        type: "STOCK_SYNC_STEP_RESULT",
        jobId: message.job?.jobId,
        stage: message.stage,
        result,
        page: pageInfo(),
      }))
      .catch((error) => send({
        type: "STOCK_SYNC_STEP_RESULT",
        jobId: message.job?.jobId,
        stage: message.stage,
        result: { ok: false, code: "STOCK_SYNC_POPUP_EXCEPTION", message: norm(error?.message || error || "A21 popup worker 예외") },
        page: pageInfo(),
      }));
    return;
  });

  void send({ type: "STOCK_SYNC_PAGE_READY", page: pageInfo() });
  void publishEvidence();
  window.setInterval(() => void publishEvidence(), 800);
})();
