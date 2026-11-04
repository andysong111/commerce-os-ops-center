(() => {
  const VERSION = "0.2.5";
  const REQUEST_EVENT = "commerce-os-a21-v025-main-submit-request";
  const RESPONSE_EVENT = "commerce-os-a21-v025-main-submit-response";
  const OPTION_MODE_MARKER = "data-commerce-os-option-mode";
  const OPTION_FIELD_MARKER = "data-commerce-os-option-field";
  const DELIVERY_NAME = "trsmt_env_mody_dlvyinfo";
  const GENERAL_NAMES = [
    "trsmt_env_mody_item_nm",
    "trsmt_env_mody_price",
    "trsmt_env_mody_ctg",
    "trsmt_env_mody_img",
    "trsmt_env_mody_fee",
    "trsmt_env_mody_desc",
    "trsmt_env_mody_keyword",
    "trsmt_env_mody_paysvc",
  ];
  const norm = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  const compact = (value) => norm(value).replace(/\s+/g, "");
  const radios = (name) => [...document.querySelectorAll('input[type="radio"]')].filter((item) => item.name === name);
  const checkedValue = (name) => {
    const checked = radios(name).filter((item) => item.checked);
    return checked.length === 1 ? String(checked[0].value ?? "") : null;
  };
  const hiddenValues = (name) => [...document.querySelectorAll('input[type="hidden"]')]
    .filter((item) => item.name === name)
    .map((item) => String(item.value ?? ""));

  function markedChoice(marker) {
    const controls = [...document.querySelectorAll(`[${marker}="true"]`)]
      .filter((node) => node instanceof HTMLInputElement && ["radio", "checkbox"].includes(node.type));
    return controls.length === 1 ? controls[0] : null;
  }

  function semanticModeMatches(control) {
    for (const node of document.querySelectorAll("td, th, label")) {
      if (compact(node.textContent) !== "옵션송신") continue;
      if (node.contains(control)) return true;
      if (node instanceof HTMLLabelElement && node.htmlFor && document.getElementById(node.htmlFor) === control) return true;
    }
    return false;
  }

  function semanticFieldMatches(control) {
    const row = control.closest("tr");
    if (!row) return false;
    const cells = [...row.children].filter((node) => ["TD", "TH"].includes(node.tagName));
    const labels = cells.map((cell) => compact(cell.textContent));
    const text = compact(row.textContent);
    return labels.includes("옵션송신") && labels.includes("선택") &&
      !text.includes("추가상품송신") && !text.includes("옵션+추가상품송신");
  }

  function forbiddenOptionSelected() {
    for (const row of document.querySelectorAll("tr")) {
      const text = compact(row.textContent);
      if (!text.includes("추가상품송신") && !text.includes("옵션+추가상품송신")) continue;
      if ([...row.querySelectorAll('input[type="radio"], input[type="checkbox"]')].some((node) => node.checked)) return true;
    }
    return false;
  }

  function optionSelectionState() {
    if (checkedValue("modify_tp") === "goods_stock" && checkedValue("trsmt_env_mody_opt") === "1") {
      return { ok: true, locator: "FORM_CONTRACT" };
    }
    const mode = markedChoice(OPTION_MODE_MARKER);
    const field = markedChoice(OPTION_FIELD_MARKER);
    if (!mode || !field || mode === field || !mode.checked || !field.checked) {
      return { ok: false, locator: "EXACT_VISIBLE_LABELS", error: "v025_option_markers_invalid" };
    }
    if (!semanticModeMatches(mode) || !semanticFieldMatches(field) || forbiddenOptionSelected()) {
      return { ok: false, locator: "EXACT_VISIBLE_LABELS", error: "v025_option_semantic_guard_invalid" };
    }
    return { ok: true, locator: "EXACT_VISIBLE_LABELS" };
  }

  function radioEvidence(radio) {
    if (!(radio instanceof HTMLInputElement)) return "";
    const chunks = [];
    if (radio.id) {
      for (const label of document.querySelectorAll("label")) {
        if (label.htmlFor === radio.id) chunks.push(label.textContent || "");
      }
    }
    const closestLabel = radio.closest("label");
    if (closestLabel) chunks.push(closestLabel.textContent || "");
    for (const sibling of [radio.previousSibling, radio.nextSibling, radio.previousElementSibling, radio.nextElementSibling]) {
      if (!sibling) continue;
      chunks.push(sibling.textContent || sibling.nodeValue || "");
    }
    const onclick = radio.getAttribute("onclick") || "";
    if (onclick) chunks.push(onclick);
    return norm(chunks.join(" | "));
  }

  function deliveryCandidates() {
    return radios(DELIVERY_NAME).map((radio) => {
      const evidence = radioEvidence(radio);
      const onclick = String(radio.getAttribute("onclick") || "");
      let score = 0;
      if (radio.dataset.commerceOsDeliveryUnchanged === "true") score += 120;
      if (/수정\s*안함|수정안함|변경\s*안함|변경안함/i.test(evidence)) score += 100;
      if (/dlvy_notice/i.test(onclick) || /dlvy_notice/i.test(evidence)) score += 80;
      if (String(radio.value ?? "") === "") score += 10;
      if (/수정\s*함|변경\s*함/i.test(evidence) && !/안함/i.test(evidence)) score -= 60;
      if (String(radio.value ?? "") === "Y") score -= 10;
      return { radio, evidence, score, value: String(radio.value ?? "") };
    });
  }

  function findDeliveryUnchanged() {
    const candidates = deliveryCandidates().sort((a, b) => b.score - a.score);
    const strong = candidates.find((row) => row.score >= 80);
    if (strong) return { ...strong, source: strong.evidence || `score:${strong.score}` };
    const blank = candidates.find((row) => row.value === "");
    const modify = candidates.find((row) => row.value === "Y");
    if (blank && modify && candidates.length === 2) return { ...blank, source: "fallback:blank-paired-with-Y" };
    return null;
  }

  function deliveryDiagnostics() {
    return deliveryCandidates().map((row) => ({
      value: row.value,
      checked: Boolean(row.radio.checked),
      evidence: row.evidence.slice(0, 160),
      score: row.score,
    }));
  }

  function forceDeliveryUnchanged() {
    const targetInfo = findDeliveryUnchanged();
    if (!targetInfo?.radio) return { ok: false, evidence: "", diagnostics: deliveryDiagnostics() };
    const peers = radios(DELIVERY_NAME);
    for (const peer of peers) peer.checked = peer === targetInfo.radio;
    targetInfo.radio.removeAttribute("onclick");
    try { targetInfo.radio.onclick = null; } catch { /* no-op */ }
    targetInfo.radio.dataset.commerceOsDeliveryUnchanged = "true";
    targetInfo.radio.dataset.commerceOsDeliveryEvidence = targetInfo.source || "";
    targetInfo.radio.dispatchEvent(new Event("input", { bubbles: true }));
    targetInfo.radio.dispatchEvent(new Event("change", { bubbles: true }));
    const checked = peers.filter((peer) => peer.checked);
    return {
      ok: checked.length === 1 && checked[0] === targetInfo.radio,
      evidence: targetInfo.source || "",
      value: String(targetInfo.radio.value ?? ""),
      diagnostics: deliveryDiagnostics(),
    };
  }

  function deliveryState() {
    const targetInfo = findDeliveryUnchanged();
    if (!targetInfo?.radio) return { ok: false, evidence: "", diagnostics: deliveryDiagnostics() };
    const checked = radios(DELIVERY_NAME).filter((peer) => peer.checked);
    return {
      ok: checked.length === 1 && checked[0] === targetInfo.radio,
      evidence: targetInfo.source || "",
      value: String(targetInfo.radio.value ?? ""),
      diagnostics: deliveryDiagnostics(),
    };
  }

  function respond(nonce, payload) {
    document.dispatchEvent(new CustomEvent(RESPONSE_EVENT, {
      detail: JSON.stringify({ nonce, version: VERSION, ...payload }),
    }));
  }

  function validate(mode) {
    const payload = hiddenValues("prod_join_chk[]");
    if (!payload.length || payload.some((value) => !/^\d+$/.test(value))) {
      return { ok: false, error: "v025_payload_invalid", payload };
    }
    if (mode === "PRICE") {
      if (checkedValue("modify_tp") !== "goods_normal") return { ok: false, error: "v025_price_mode_invalid", actual: checkedValue("modify_tp") };
      const source = hiddenValues("tsmt_sale_price_tp");
      if (!source.length || source.some((value) => value !== "J")) return { ok: false, error: "v025_price_source_invalid", source };
      for (const name of GENERAL_NAMES) {
        const expected = name === "trsmt_env_mody_price" ? "Y" : "";
        const actual = checkedValue(name);
        if (actual !== expected) return { ok: false, error: "v025_price_field_invalid", name, expected, actual };
      }
      const delivery = forceDeliveryUnchanged();
      if (!delivery.ok) {
        return { ok: false, error: "v025_delivery_label_guard_invalid", delivery };
      }
    } else if (mode === "OPTION") {
      const option = optionSelectionState();
      if (!option.ok) return { ok: false, error: option.error || "v025_option_selection_invalid", option };
    } else {
      return { ok: false, error: "v025_invalid_mode" };
    }
    if (typeof window.goods_mallMdfy_submit_sp !== "function") {
      return { ok: false, error: "v025_shopling_submit_function_missing" };
    }
    return { ok: true, payloadCount: payload.length, optionLocator: mode === "OPTION" ? optionSelectionState().locator : undefined };
  }

  document.addEventListener(REQUEST_EVENT, (event) => {
    let request = null;
    try { request = JSON.parse(String(event?.detail || "{}")); } catch { /* ignore */ }
    const nonce = String(request?.nonce || "");
    const mode = String(request?.mode || "");
    if (!nonce) return;

    const validation = validate(mode);
    if (!validation.ok) return respond(nonce, validation);

    const originalConfirm = window.confirm;
    const originalAlert = window.alert;
    const dialogs = [];
    let unexpected = null;
    let sawSubmitConfirm = false;
    let sawDeliveryNotice = false;

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
      if (/배송정보\(A17\s*정보\).*수정되지\s*않고\s*유지/i.test(text) || /배송정보.*수정되지\s*않고\s*유지/i.test(text)) {
        sawDeliveryNotice = true;
        return;
      }
      unexpected = `unexpected_alert:${text.slice(0, 200)}`;
      throw new Error(unexpected);
    };

    try {
      if (mode === "PRICE") {
        const delivery = forceDeliveryUnchanged();
        if (!delivery.ok) return respond(nonce, { ok: false, error: "v025_delivery_pre_submit_failed", delivery, dialogs });
      }
      window.goods_mallMdfy_submit_sp();
      if (unexpected) return respond(nonce, { ok: false, error: unexpected, dialogs });
      const deliveryAfter = mode === "PRICE" ? deliveryState() : { ok: true, evidence: "" };
      if (mode === "PRICE" && !deliveryAfter.ok) {
        return respond(nonce, { ok: false, error: "v025_delivery_changed_during_submit", delivery: deliveryAfter, dialogs });
      }
      respond(nonce, {
        ok: true,
        invoked: true,
        mode,
        payloadCount: validation.payloadCount,
        optionLocator: validation.optionLocator,
        sawSubmitConfirm,
        sawDeliveryNotice,
        deliveryInfoUnchanged: mode === "PRICE" ? deliveryAfter.ok : true,
        deliveryEvidence: deliveryAfter.evidence || "",
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
