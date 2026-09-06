(() => {
  const VERSION = chrome.runtime.getManifest().version;
  const CLAIM_MESSAGE = "STOCK_SYNC_A21_POPUP_CLAIM_V044";
  const TARGET_PATH = "/prodlinkage/goods_mallMdfy_trsmt.phtml";
  const OPTION_REQUEST = "commerce-os-stock-a21-v044-main-submit-request";
  const OPTION_RESPONSE = "commerce-os-stock-a21-v044-main-submit-response";
  const LEGACY_MAIN_REQUEST = "commerce-os-stock-main-click";
  const LEGACY_MAIN_RESULT = "commerce-os-stock-main-click-result";
  const LEGACY_TOKEN_ATTRIBUTE = "data-commerce-os-stock-click-token";
  const running = new Set();
  const completed = new Set();
  let lastEvidenceSignature = "";

  const norm = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  const bodyText = () => norm(document.body?.innerText || document.body?.textContent || document.documentElement?.innerText || "");
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const isExactPopupUrl = () => String(location.pathname || "").toLowerCase() === TARGET_PATH.toLowerCase();

  function overlay() {
    let node = document.getElementById("commerce-os-stock-v044-popup-status");
    if (node) return node;
    node = document.createElement("div");
    node.id = "commerce-os-stock-v044-popup-status";
    node.style.cssText = "position:fixed;left:12px;top:12px;z-index:2147483647;max-width:430px;padding:9px 11px;border-radius:9px;background:#0f172a;color:#fff;font:12px/1.4 Arial,sans-serif;box-shadow:0 8px 24px rgba(15,23,42,.25)";
    node.textContent = `Stock Sync v${VERSION} · A21 assignment 대기`;
    document.documentElement.appendChild(node);
    return node;
  }

  function status(text, tone = "dark") {
    const node = overlay();
    node.textContent = `Stock Sync v${VERSION} · ${text}`;
    node.style.background = tone === "ok" ? "#047857" : tone === "bad" ? "#b91c1c" : tone === "warn" ? "#b45309" : "#0f172a";
  }

  function role() {
    const text = bodyText();
    if (isExactPopupUrl() && /상품수정\s*송신/i.test(text) && (/일반내용수정/i.test(text) || /옵션송신/i.test(text) || /상품판매상태송신/i.test(text))) return "A21_POPUP";
    if (/상품(?:옵션)?\s*(?:수정\s*)?전송이\s*완료되었습니다|처리중입니다|성공건수\s*[:：]/i.test(text)) return "RESULT";
    return "OTHER";
  }

  function pageInfo() {
    return { role: role(), href: String(location.href || ""), title: String(document.title || ""), top: window.top === window, canNavigate: false };
  }

  async function send(message) {
    return chrome.runtime.sendMessage({ ...message, version: VERSION }).catch(() => null);
  }

  function radios(name) {
    return [...document.querySelectorAll('input[type="radio"]')].filter((item) => item.name === name);
  }

  function exactRadio(name, value) {
    return radios(name).find((item) => String(item.value ?? "") === String(value ?? "")) || null;
  }

  async function selectRadio(name, value) {
    const target = exactRadio(name, value);
    if (!(target instanceof HTMLInputElement) || target.disabled) return false;
    if (!target.checked) target.click();
    await sleep(35);
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
    return verifyRadio(name, value);
  }

  function verifyRadio(name, value) {
    const target = exactRadio(name, value);
    return Boolean(target?.checked) && radios(name).every((peer) => peer === target || !peer.checked);
  }

  function hiddenValues(name) {
    return [...document.querySelectorAll('input[type="hidden"]')]
      .filter((item) => item.name === name)
      .map((item) => String(item.value ?? ""));
  }

  function payloadEvidence() {
    const payload = hiddenValues("prod_join_chk[]");
    return { payload, valid: payload.length > 0 && payload.every((value) => /^\d+$/.test(value)) };
  }

  async function configureOptionExact() {
    status("Shopling 실제 form · modify_tp=goods_stock 설정 중");
    if (!await selectRadio("modify_tp", "goods_stock")) {
      return { ok: false, code: "A21_OPTION_MODE_EXACT_FAILED", message: "modify_tp=goods_stock(옵션송신)를 선택하지 못했습니다." };
    }
    await sleep(180);
    if (!await selectRadio("trsmt_env_mody_opt", "1")) {
      return { ok: false, code: "A21_OPTION_FIELD_EXACT_FAILED", message: "trsmt_env_mody_opt=1(옵션송신 선택)을 설정하지 못했습니다." };
    }
    if (!verifyOptionExact()) {
      return { ok: false, code: "A21_OPTION_EXACT_VERIFY_FAILED", message: "옵션송신 form name/value 검증에 실패했습니다." };
    }
    return { ok: true, evidence: { modify_tp: "goods_stock", trsmt_env_mody_opt: "1" } };
  }

  function verifyOptionExact() {
    return verifyRadio("modify_tp", "goods_stock") && verifyRadio("trsmt_env_mody_opt", "1");
  }

  function visible(element) {
    if (!(element instanceof HTMLElement)) return true;
    const rect = element.getBoundingClientRect();
    return element.offsetParent !== null || rect.width > 0 || rect.height > 0;
  }

  function adjacentText(control) {
    const chunks = [control?.value, control?.name, control?.id, control?.parentElement?.textContent];
    if (control?.id) {
      const label = document.querySelector(`label[for="${CSS.escape(control.id)}"]`);
      if (label) chunks.push(label.textContent);
    }
    const wrapping = control?.closest?.("label");
    if (wrapping) chunks.push(wrapping.textContent);
    for (const node of [control?.previousSibling, control?.nextSibling]) if (node) chunks.push(node.textContent || node.nodeValue);
    return norm(chunks.filter(Boolean).join(" "));
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

  function modeRadioByText(target) {
    const wanted = norm(target);
    const candidates = [...document.querySelectorAll('input[type="radio"]')]
      .filter((radio) => visible(radio) && adjacentText(radio).includes(wanted));
    candidates.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    return candidates[0] || null;
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

  function configureSaleStatusLegacy(job) {
    const top = modeRadioByText("상품판매상태송신");
    if (!setControl(top, true)) return { ok: false, code: "A21_SALE_STATUS_MODE_NOT_FOUND", message: "상품판매상태송신 모드를 찾지 못했습니다." };
    const targetLabel = job.desiredStatus === "SOLD_OUT" ? "품절" : "판매중";
    const target = targetStatusControl(targetLabel);
    if (!setControl(target, true)) return { ok: false, code: "A21_TARGET_STATUS_NOT_FOUND", message: `상품판매상태 ${targetLabel} 선택 버튼을 찾지 못했습니다.` };
    if (!top.checked || !target.checked) return { ok: false, code: "A21_SALE_STATUS_CONFIGURATION_VERIFY_FAILED", message: "상품판매상태송신 설정 검증에 실패했습니다." };
    return { ok: true, evidence: { mode: "PRODUCT_SALE_STATUS", targetLabel } };
  }

  function optionMainSubmit() {
    return new Promise((resolve) => {
      const nonce = `stock-a21-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      let settled = false;
      const cleanup = () => document.removeEventListener(OPTION_RESPONSE, onResponse);
      const onResponse = (event) => {
        let body = null;
        try { body = JSON.parse(String(event?.detail || "{}")); } catch { return; }
        if (body?.nonce !== nonce) return;
        settled = true;
        cleanup();
        resolve(body);
      };
      document.addEventListener(OPTION_RESPONSE, onResponse);
      document.dispatchEvent(new CustomEvent(OPTION_REQUEST, { detail: JSON.stringify({ nonce, mode: "OPTION" }) }));
      setTimeout(() => {
        if (settled) return;
        cleanup();
        resolve({ ok: false, error: "stock_v044_main_bridge_timeout" });
      }, 5000);
    });
  }

  function legacySubmitButton() {
    const selector = 'button,input[type="button"],input[type="submit"],input[type="image"],a,[onclick],img[alt],img[title]';
    const nodes = [...document.querySelectorAll(selector)].filter(visible);
    const controlText = (el) => norm(el instanceof HTMLInputElement ? `${el.value || ""} ${el.title || ""}` : `${el.textContent || ""} ${el.getAttribute?.("title") || ""} ${el.getAttribute?.("alt") || ""}`);
    let candidate = nodes.find((el) => /^상품수정\s*송신$/.test(controlText(el))) || nodes.find((el) => /상품수정\s*송신/.test(controlText(el)));
    if (candidate instanceof HTMLImageElement) candidate = candidate.closest("a,button,input,[onclick]") || candidate;
    return candidate || null;
  }

  function legacyClickViaMain(element) {
    return new Promise((resolve) => {
      if (!element) return resolve({ ok: false, code: "CLICK_TARGET_MISSING", alerts: [] });
      const token = `stock-popup-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      element.setAttribute(LEGACY_TOKEN_ATTRIBUTE, token);
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        window.removeEventListener(LEGACY_MAIN_RESULT, listener);
        resolve(value);
      };
      const listener = (event) => {
        if (norm(event?.detail?.token) !== token) return;
        finish(event.detail || { ok: false, code: "MAIN_CLICK_EMPTY_RESULT", alerts: [] });
      };
      window.addEventListener(LEGACY_MAIN_RESULT, listener);
      window.dispatchEvent(new CustomEvent(LEGACY_MAIN_REQUEST, { detail: { token } }));
      window.setTimeout(() => finish({ ok: true, code: "MAIN_CLICK_NAVIGATED_OR_PENDING", alerts: [] }), 3500);
    });
  }

  async function executeAssignment(message) {
    const job = message.job || {};
    const goodsKey = norm(message.goodsKey);
    if (String(message.stage || "") !== "A21_POPUP" || role() !== "A21_POPUP") {
      return { ok: false, waiting: true, code: "A21_POPUP_WAIT", message: "A21 수정전송 팝업을 기다립니다." };
    }
    const key = `${job.jobId || "unknown"}:${job.executionId || ""}:A21_POPUP:${goodsKey}`;
    if (completed.has(key)) return { ok: true, duplicate: true };
    if (running.has(key)) return { ok: true, duplicate: true, running: true };
    running.add(key);
    try {
      const payload = payloadEvidence();
      if (!payload.valid) return { ok: false, code: "A21_POPUP_PAYLOAD_INVALID", message: "prod_join_chk[] 전송 대상값을 확인하지 못했습니다.", evidence: { payload: payload.payload } };

      if (job.productKind === "OPTION") {
        const configured = await configureOptionExact();
        if (!configured.ok) return configured;
        status(`옵션 form 설정 완료 · ${payload.payload.length}행 · MAIN world 원본송신 대기`, "ok");
        await sleep(650);
        if (!verifyOptionExact()) return { ok: false, code: "A21_OPTION_CONFIG_CHANGED", message: "송신 직전 modify_tp/trsmt_env_mody_opt 값이 변경됐습니다." };
        status("MAIN world goods_mallMdfy_submit_sp() 호출", "warn");
        const response = await optionMainSubmit();
        if (!response?.ok || response?.invoked !== true) {
          return { ok: false, code: "A21_OPTION_MAIN_SUBMIT_FAILED", message: `Shopling 원본 옵션송신 호출 실패: ${response?.error || "응답 없음"}`, evidence: response || null };
        }
        completed.add(key);
        return {
          ok: true,
          submitted: true,
          step: "A21_POPUP_SUBMITTED",
          message: `A21 goods key ${goodsKey} 옵션송신 form을 정확 검증하고 Shopling 원본 송신함수를 호출했습니다.`,
          evidence: { goodsKey, payloadCount: payload.payload.length, modify_tp: "goods_stock", trsmt_env_mody_opt: "1", mainSubmit: response },
        };
      }

      const configured = configureSaleStatusLegacy(job);
      if (!configured.ok) return configured;
      const button = legacySubmitButton();
      if (!button) return { ok: false, code: "A21_SUBMIT_BUTTON_NOT_FOUND", message: "A21 상품수정 송신 버튼을 찾지 못했습니다." };
      const click = await legacyClickViaMain(button);
      const alertText = norm((click?.alerts || []).join(" "));
      if (!click?.ok || /실패|오류|불가|없습니다|선택해|확인해|잘못/i.test(alertText)) {
        return { ok: false, code: "A21_SUBMIT_REJECTED", message: alertText || click?.message || "A21 송신이 거절됐습니다.", evidence: click };
      }
      completed.add(key);
      return { ok: true, submitted: true, step: "A21_POPUP_SUBMITTED", message: `A21 goods key ${goodsKey} 상품판매상태 송신을 요청했습니다.`, evidence: { goodsKey, ...configured.evidence, alerts: click?.alerts || [] } };
    } finally {
      running.delete(key);
    }
  }

  async function report(message, result) {
    if (result?.duplicate) return;
    await send({
      type: "STOCK_SYNC_STEP_RESULT",
      jobId: message.job?.jobId,
      stage: "A21_POPUP",
      result,
      page: pageInfo(),
    });
  }

  async function runAndReport(message) {
    const result = await executeAssignment(message).catch((error) => ({ ok: false, code: "A21_POPUP_CONTENT_EXCEPTION", message: norm(error?.message || error || "A21 popup exception") }));
    await report(message, result);
    if (!result?.ok) status(`중단 · ${result?.message || result?.code || "오류"}`, "bad");
  }

  async function claimLoop() {
    if (!isExactPopupUrl()) return;
    overlay();
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      if ([...completed].length) return;
      const response = await send({ type: CLAIM_MESSAGE, role: "A21_POPUP", href: location.href });
      if (response?.ok && response.assignment?.job?.jobId) {
        status("재고동기화 assignment 수신 · form 직접 설정");
        await runAndReport(response.assignment);
        return;
      }
      status(`assignment 대기 · ${response?.error || "active job 탐색"}`, "warn");
      await sleep(450);
    }
    status("assignment 90초 초과 · 안전 중단", "bad");
  }

  function parseCounts(text) {
    const success = [...text.matchAll(/성공건수\s*[:：]?\s*([\d,]+)/gi)].reduce((total, match) => total + Number(match[1].replace(/,/g, "")), 0);
    const failure = [...text.matchAll(/실패건수\s*[:：]?\s*([\d,]+)/gi)].reduce((total, match) => total + Number(match[1].replace(/,/g, "")), 0);
    return { success, failure };
  }

  async function publishEvidence() {
    const text = bodyText();
    const counts = parseCounts(text);
    const evidence = {
      processing: /처리중입니다|잠시만\s*기다려주시기\s*바랍니다/i.test(text),
      optionComplete: /상품\s*옵션\s*(?:수정\s*)?전송이\s*완료되었습니다|상품옵션\s*전송이\s*완료되었습니다|옵션\s*송신이\s*완료되었습니다/i.test(text),
      productComplete: /상품\s*수정\s*전송이\s*완료되었습니다|상품판매상태\s*송신이\s*완료되었습니다/i.test(text),
      explicitFailure: /성공여부\s*[:：]?\s*실패|전송\s*실패|송신\s*실패|처리\s*실패/i.test(text),
      successCount: counts.success,
      failureCount: counts.failure,
      readyState: document.readyState,
      href: String(location.href || ""),
      title: String(document.title || ""),
      textSample: text.slice(-900),
      top: window.top === window,
    };
    if (!evidence.processing && !evidence.optionComplete && !evidence.productComplete && evidence.successCount <= 0 && evidence.failureCount <= 0) return;
    const signature = JSON.stringify(evidence);
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
    void runAndReport(message);
    return;
  });

  void send({ type: "STOCK_SYNC_PAGE_READY", page: pageInfo() });
  void publishEvidence();
  window.setInterval(() => void publishEvidence(), 800);
  void claimLoop();
})();
