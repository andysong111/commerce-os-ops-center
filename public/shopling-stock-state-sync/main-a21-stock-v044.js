(() => {
  const VERSION = "0.4.4";
  const REQUEST_EVENT = "commerce-os-stock-a21-v044-main-submit-request";
  const RESPONSE_EVENT = "commerce-os-stock-a21-v044-main-submit-response";
  const norm = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  const radios = (name) => [...document.querySelectorAll('input[type="radio"]')].filter((item) => item.name === name);
  const checkedValue = (name) => {
    const checked = radios(name).filter((item) => item.checked);
    return checked.length === 1 ? String(checked[0].value ?? "") : null;
  };
  const hiddenValues = (name) => [...document.querySelectorAll('input[type="hidden"]')]
    .filter((item) => item.name === name)
    .map((item) => String(item.value ?? ""));

  function respond(nonce, payload) {
    document.dispatchEvent(new CustomEvent(RESPONSE_EVENT, {
      detail: JSON.stringify({ nonce, version: VERSION, ...payload }),
    }));
  }

  function validateOption() {
    const payload = hiddenValues("prod_join_chk[]");
    if (!payload.length || payload.some((value) => !/^\d+$/.test(value))) {
      return { ok: false, error: "stock_v044_payload_invalid", payload };
    }
    if (checkedValue("modify_tp") !== "goods_stock") {
      return { ok: false, error: "stock_v044_option_mode_invalid", actual: checkedValue("modify_tp") };
    }
    if (checkedValue("trsmt_env_mody_opt") !== "1") {
      return { ok: false, error: "stock_v044_option_field_invalid", actual: checkedValue("trsmt_env_mody_opt") };
    }
    if (typeof window.goods_mallMdfy_submit_sp !== "function") {
      return { ok: false, error: "stock_v044_shopling_submit_function_missing" };
    }
    return { ok: true, payloadCount: payload.length };
  }

  document.addEventListener(REQUEST_EVENT, (event) => {
    let request = null;
    try { request = JSON.parse(String(event?.detail || "{}")); } catch { /* ignore */ }
    const nonce = String(request?.nonce || "");
    const mode = String(request?.mode || "");
    if (!nonce || mode !== "OPTION") return;

    const validation = validateOption();
    if (!validation.ok) return respond(nonce, validation);

    const originalConfirm = window.confirm;
    const originalAlert = window.alert;
    const dialogs = [];
    let unexpected = null;
    let sawSubmitConfirm = false;

    window.confirm = (message) => {
      const text = norm(message);
      dialogs.push({ type: "confirm", text: text.slice(0, 500) });
      if (/수정전송\s*할\s*상품을\s*선택하셨습니까/i.test(text)) {
        sawSubmitConfirm = true;
        return true;
      }
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
      window.goods_mallMdfy_submit_sp();
      if (unexpected) return respond(nonce, { ok: false, error: unexpected, dialogs });
      respond(nonce, {
        ok: true,
        invoked: true,
        mode,
        payloadCount: validation.payloadCount,
        sawSubmitConfirm,
        dialogs,
      });
    } catch (error) {
      respond(nonce, { ok: false, error: error instanceof Error ? error.message : String(error), dialogs });
    } finally {
      window.confirm = originalConfirm;
      window.alert = originalAlert;
    }
  });
})();
