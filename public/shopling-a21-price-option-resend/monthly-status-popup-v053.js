(() => {
  const VERSION = "0.5.3";
  const TARGET_PATH = "/prodlinkage/goods_mallMdfy_trsmt.phtml";
  const REQUEST_EVENT = "commerce-os-monthly-status-main-submit-request";
  const RESPONSE_EVENT = "commerce-os-monthly-status-main-submit-response";
  const STATUS_MODES = new Set(["STATUS_SELLING", "STATUS_SOLD_OUT"]);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const norm = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  const isExactPopupUrl = () => String(location.pathname || "").toLowerCase() === TARGET_PATH.toLowerCase();
  let busy = false;

  function visible(element) {
    if (!(element instanceof Element)) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  }

  function adjacentText(control) {
    if (!(control instanceof Element)) return "";
    const chunks = [];
    if (control.id) {
      for (const label of document.querySelectorAll("label")) if (label.htmlFor === control.id) chunks.push(label.textContent || "");
    }
    const closest = control.closest("label");
    if (closest) chunks.push(closest.textContent || "");
    for (const sibling of [control.previousSibling, control.nextSibling, control.previousElementSibling, control.nextElementSibling]) {
      if (sibling) chunks.push(sibling.textContent || sibling.nodeValue || "");
    }
    const row = control.closest("tr");
    if (row) chunks.push(row.textContent || "");
    return norm(chunks.join(" | "));
  }

  function setControl(control, checked = true) {
    if (!(control instanceof HTMLInputElement) || !["radio", "checkbox"].includes(control.type) || control.disabled) return false;
    if (checked && !control.checked) control.click();
    if (!checked && control.checked && control.type === "checkbox") control.click();
    control.checked = checked;
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
    return control.checked === checked;
  }

  function modeRadio() {
    return [...document.querySelectorAll('input[type="radio"]')]
      .filter((radio) => visible(radio) && adjacentText(radio).includes("상품판매상태송신"))
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0] || null;
  }

  function targetLabel(mode) {
    return mode === "STATUS_SOLD_OUT" ? "품절" : "판매중";
  }

  function statusControl(mode) {
    const wanted = targetLabel(mode);
    return [...document.querySelectorAll('input[type="radio"],input[type="checkbox"]')]
      .filter(visible)
      .filter((control) => {
        const text = adjacentText(control);
        return text.includes(wanted) && /판매상태|상품판매상태|품절|판매중/.test(text);
      })
      .sort((a, b) => adjacentText(a).length - adjacentText(b).length)[0] || null;
  }

  function payloadExists() {
    const joined = [...document.querySelectorAll('input[type="hidden"]')].filter((item) => item.name === "prod_join_chk[]");
    return joined.length > 0 && joined.every((item) => /^\d+$/.test(String(item.value || "")));
  }

  function configure(mode) {
    const top = modeRadio();
    const target = statusControl(mode);
    if (!setControl(top, true)) return { ok: false, code: "MONTHLY_STATUS_MODE_NOT_FOUND" };
    if (!setControl(target, true)) return { ok: false, code: "MONTHLY_STATUS_TARGET_NOT_FOUND" };
    if (!top.checked || !target.checked) return { ok: false, code: "MONTHLY_STATUS_CONFIG_VERIFY_FAILED" };
    return { ok: true };
  }

  function verify(mode) {
    return Boolean(modeRadio()?.checked && statusControl(mode)?.checked && payloadExists());
  }

  function mainSubmit(mode) {
    return new Promise((resolve) => {
      const nonce = `monthly-status-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      let settled = false;
      const cleanup = () => document.removeEventListener(RESPONSE_EVENT, onResponse);
      const onResponse = (event) => {
        let body = null;
        try { body = JSON.parse(String(event?.detail || "{}")); } catch { return; }
        if (body?.nonce !== nonce) return;
        settled = true;
        cleanup();
        resolve(body);
      };
      document.addEventListener(RESPONSE_EVENT, onResponse);
      document.dispatchEvent(new CustomEvent(REQUEST_EVENT, { detail: JSON.stringify({ nonce, mode }) }));
      setTimeout(() => {
        if (settled) return;
        cleanup();
        resolve({ ok: false, error: "monthly_status_main_bridge_timeout" });
      }, 5000);
    });
  }

  async function fail(jobId, code, message) {
    await chrome.runtime.sendMessage({ type: "A21_JOB_FAILURE", jobId, code, message }).catch(() => null);
  }

  async function stage(jobId, nextStage, message) {
    await chrome.runtime.sendMessage({ type: "A21_STAGE", jobId, stage: nextStage, message }).catch(() => null);
  }

  async function execute(message) {
    if (!STATUS_MODES.has(String(message?.mode || ""))) return;
    if (busy) return;
    busy = true;
    try {
      if (!isExactPopupUrl()) return fail(message.jobId, "MONTHLY_STATUS_POPUP_URL_INVALID", String(location.href));
      if (!payloadExists()) return fail(message.jobId, "MONTHLY_STATUS_PAYLOAD_MISSING", "prod_join_chk[] 전송 대상을 확인하지 못했습니다.");
      const configured = configure(message.mode);
      if (!configured.ok) return fail(message.jobId, configured.code, "상품판매상태송신 form을 안전하게 설정하지 못했습니다.");
      await stage(message.jobId, "POPUP_CONFIG", `상품판매상태 ${targetLabel(message.mode)} form 검증 완료`);
      await sleep(500);
      if (!verify(message.mode)) return fail(message.jobId, "MONTHLY_STATUS_CONFIG_CHANGED", "송신 직전 상품판매상태 설정이 변경됐습니다.");
      await stage(message.jobId, "SUBMIT_CLICKED", `상품판매상태 ${targetLabel(message.mode)} · MAIN world 원본 송신 호출`);
      const response = await mainSubmit(message.mode);
      if (!response?.ok || response?.invoked !== true) {
        return fail(message.jobId, "MONTHLY_STATUS_MAIN_SUBMIT_FAILED", String(response?.error || "응답 없음"));
      }
      await stage(message.jobId, "RESULT_WAIT", `상품판매상태 ${targetLabel(message.mode)} 수정전송 결과 확인 중`);
    } finally {
      busy = false;
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "A21_POPUP_ASSIGNMENT" || !STATUS_MODES.has(String(message?.mode || ""))) return false;
    sendResponse({ ok: true, accepted: true, version: VERSION, statusOverlay: true });
    void execute(message);
    return false;
  });
})();