(() => {
  const VERSION = "0.5.4";
  const REQUEST_EVENT = "commerce-os-monthly-status-main-submit-request";
  const RESPONSE_EVENT = "commerce-os-monthly-status-main-submit-response";
  const STATUS_MODES = new Set(["STATUS_SELLING", "STATUS_SOLD_OUT"]);
  const norm = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();

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

  function payloadValid() {
    const values = [...document.querySelectorAll('input[type="hidden"]')]
      .filter((item) => item.name === "prod_join_chk[]")
      .map((item) => String(item.value || ""));
    return values.length > 0 && values.every((value) => /^\d+$/.test(value));
  }

  function verify(mode) {
    return Boolean(modeRadio()?.checked && statusControl(mode)?.checked && payloadValid());
  }

  function respond(nonce, payload) {
    document.dispatchEvent(new CustomEvent(RESPONSE_EVENT, {
      detail: JSON.stringify({ nonce, version: VERSION, ...payload }),
    }));
  }

  document.addEventListener(REQUEST_EVENT, (event) => {
    let request = null;
    try { request = JSON.parse(String(event?.detail || "{}")); } catch { return; }
    const nonce = String(request?.nonce || "");
    const mode = String(request?.mode || "");
    if (!nonce || !STATUS_MODES.has(mode)) return;
    if (!verify(mode)) return respond(nonce, { ok: false, error: "monthly_status_main_preimage_invalid" });
    if (typeof window.goods_mallMdfy_submit_sp !== "function") {
      return respond(nonce, { ok: false, error: "monthly_status_submit_function_missing" });
    }

    const originalConfirm = window.confirm;
    const originalAlert = window.alert;
    const dialogs = [];
    let unexpected = null;
    window.confirm = (message) => {
      const text = norm(message);
      dialogs.push({ type: "confirm", text: text.slice(0, 500) });
      if (/수정전송\s*할\s*상품을\s*선택하셨습니까/i.test(text)) return true;
      unexpected = `unexpected_confirm:${text.slice(0, 200)}`;
      return false;
    };
    window.alert = (message) => {
      const text = norm(message);
      dialogs.push({ type: "alert", text: text.slice(0, 500) });
      unexpected = `unexpected_alert:${text.slice(0, 200)}`;
      throw new Error(unexpected);
    };

    try {
      if (!verify(mode)) return respond(nonce, { ok: false, error: "monthly_status_main_changed_before_submit", dialogs });
      window.goods_mallMdfy_submit_sp();
      if (unexpected) return respond(nonce, { ok: false, error: unexpected, dialogs });
      respond(nonce, { ok: true, invoked: true, mode, targetLabel: targetLabel(mode), dialogs });
    } catch (error) {
      respond(nonce, { ok: false, error: error instanceof Error ? error.message : String(error), dialogs });
    } finally {
      window.confirm = originalConfirm;
      window.alert = originalAlert;
    }
  });
})();