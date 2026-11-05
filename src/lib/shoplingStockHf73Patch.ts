function replaceOnce(source: string, before: string, after: string, code: string) {
  const normalizedSource = source.replace(/\r\n?/g, "\n");
  const normalizedBefore = before.replace(/\r\n?/g, "\n");
  const first = normalizedSource.indexOf(normalizedBefore);
  if (first < 0) throw new Error(`${code}:anchor_missing`);
  if (normalizedSource.indexOf(normalizedBefore, first + normalizedBefore.length) >= 0) {
    throw new Error(`${code}:anchor_not_unique`);
  }
  return `${normalizedSource.slice(0, first)}${after}${normalizedSource.slice(first + normalizedBefore.length)}`;
}

export function patchHf73A21ContentSource(source: string) {
  let next = replaceOnce(
    source,
    'const VERSION = "0.2.8";',
    'const VERSION = "0.2.9";',
    "hf73_content_version",
  );

  next = replaceOnce(
    next,
    `  async function configureOptionByVisibleLabels() {`,
    `  function markSemanticOptionControls() {
    const mode = semanticOptionMode();
    const field = semanticOptionField();
    if (!visibleChoice(mode) || !visibleChoice(field) || mode === field) return false;
    for (const node of document.querySelectorAll(\`[\${OPTION_MODE_MARKER}]\`)) {
      node.removeAttribute(OPTION_MODE_MARKER);
    }
    for (const node of document.querySelectorAll(\`[\${OPTION_FIELD_MARKER}]\`)) {
      node.removeAttribute(OPTION_FIELD_MARKER);
    }
    mode.setAttribute(OPTION_MODE_MARKER, "true");
    field.setAttribute(OPTION_FIELD_MARKER, "true");
    return true;
  }

  async function configureOptionByVisibleLabels() {`,
    "hf73_content_mark_semantic_controls",
  );

  const beforeConfigure = `  async function configureOption() {
    status("옵션 전송 form 설정 중");
    // Production proved the visible top-to-bottom click path before the strict
    // name/value shortcut. It avoids stale hidden duplicate radios.
    if (await configureOptionByVisibleLabels()) {
      return { ok: true, locator: "VISIBLE_TOP_MODE_THEN_OPTION_ONLY_ROW" };
    }
    if (await chooseMode("goods_stock")) {
      await sleep(180);
      if (await selectRadio("trsmt_env_mody_opt", "1") && verifyOptionContract()) {
        markExactOptionControls();
        return { ok: true, locator: "FORM_CONTRACT_FALLBACK" };
      }
    }
    return {
      ok: false,
      code: "V028_OPTION_VISIBLE_AND_FORM_CONTRACT",
      message: \`상단 '옵션송신'과 하단 옵션 전용 '선택' 단추를 실제 화면에서 클릭하지 못했습니다. 라디오 진단=\${lastOptionModeDiagnostic || "없음"}\`,
    };
  }`;
  const afterConfigure = `  async function configureOption() {
    status("옵션 전송 form 설정 중 · Shopling 본체 선택");
    if (!markSemanticOptionControls()) {
      return {
        ok: false,
        code: "V029_OPTION_TARGETS_NOT_EXACT",
        message: \`상단 '옵션송신'과 하단 옵션 전용 '선택' 단추를 하나씩 정확히 찾지 못했습니다. 라디오 진단=\${lastOptionModeDiagnostic || "없음"}\`,
      };
    }
    const prepared = await mainSubmit("OPTION", "PREPARE");
    if (!prepared?.ok) {
      return {
        ok: false,
        code: "V029_MAIN_OPTION_PREPARE_FAILED",
        message: \`Shopling 본체에서 옵션송신 단추 선택에 실패했습니다: \${prepared?.error || "응답 없음"}\`,
      };
    }
    await sleep(120);
    if (!verifyOption()) {
      return {
        ok: false,
        code: "V029_MAIN_OPTION_PREPARE_NOT_VISIBLE",
        message: "Shopling 본체에서 선택한 옵션송신 상태가 실제 화면에 남지 않아 전송을 차단했습니다.",
      };
    }
    return { ok: true, locator: "MAIN_WORLD_NATIVE_OPTION_SELECTION" };
  }`;
  next = replaceOnce(next, beforeConfigure, afterConfigure, "hf73_content_main_world_option_prepare");

  next = replaceOnce(
    next,
    `  function mainSubmit(mode) {`,
    `  function mainSubmit(mode, phase = "SUBMIT") {`,
    "hf73_content_main_bridge_phase_signature",
  );
  next = replaceOnce(
    next,
    `document.dispatchEvent(new CustomEvent(REQUEST_EVENT, { detail: JSON.stringify({ nonce, mode }) }));`,
    `document.dispatchEvent(new CustomEvent(REQUEST_EVENT, { detail: JSON.stringify({ nonce, mode, phase }) }));`,
    "hf73_content_main_bridge_phase_payload",
  );

  return replaceOnce(
    next,
    `      chooseOptionModeSnapshot,
      safeOptionModeDiagnostics,`,
    `      chooseOptionModeSnapshot,
      safeOptionModeDiagnostics,
      markSemanticOptionControls,`,
    "hf73_content_test_hook",
  );
}

export function patchHf73A21MainSource(source: string) {
  let next = replaceOnce(
    source,
    'const VERSION = "0.2.8";',
    'const VERSION = "0.2.9";',
    "hf73_main_version",
  );

  const beforeRadioEvidence = `  function radioEvidence(radio) {`;
  const afterRadioEvidence = `  function exactSemanticOptionControls() {
    const candidates = [...document.querySelectorAll('input[type="radio"]')]
      .filter((node) => node instanceof HTMLInputElement && !node.disabled);
    const modeCandidates = candidates.filter((node) => semanticModeMatches(node));
    const fieldCandidates = candidates.filter((node) => semanticFieldMatches(node));
    if (modeCandidates.length !== 1 || fieldCandidates.length !== 1) {
      return {
        ok: false,
        error: \`v029_option_target_ambiguity:mode=\${modeCandidates.length}:field=\${fieldCandidates.length}\`,
      };
    }
    if (modeCandidates[0] === fieldCandidates[0]) {
      return { ok: false, error: "v029_option_target_overlap" };
    }
    return { ok: true, mode: modeCandidates[0], field: fieldCandidates[0] };
  }

  function nativeCheckExactRadio(target) {
    if (!(target instanceof HTMLInputElement) || target.type !== "radio" || target.disabled) {
      return false;
    }
    try {
      if (!target.checked) HTMLInputElement.prototype.click.call(target);
    } catch {
      try { target.click(); } catch { /* fail closed below */ }
    }
    if (!target.checked) {
      const checkedSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "checked",
      )?.set;
      if (typeof checkedSetter === "function") checkedSetter.call(target, true);
    }
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
    return target.checked === true;
  }

  function prepareExactOptionSelection() {
    const exact = exactSemanticOptionControls();
    if (!exact.ok) return exact;
    exact.mode.setAttribute(OPTION_MODE_MARKER, "true");
    exact.field.setAttribute(OPTION_FIELD_MARKER, "true");
    if (!nativeCheckExactRadio(exact.mode)) {
      return { ok: false, error: "v029_option_mode_native_check_failed" };
    }
    if (!nativeCheckExactRadio(exact.field)) {
      return { ok: false, error: "v029_option_field_native_check_failed" };
    }
    const selection = optionSelectionState();
    if (!selection.ok) {
      return { ok: false, error: selection.error || "v029_option_selection_readback_failed" };
    }
    return {
      ok: true,
      prepared: true,
      optionLocator: "MAIN_WORLD_NATIVE_OPTION_SELECTION",
      modeChecked: exact.mode.checked === true,
      fieldChecked: exact.field.checked === true,
    };
  }

  function radioEvidence(radio) {`;
  next = replaceOnce(
    next,
    beforeRadioEvidence,
    afterRadioEvidence,
    "hf73_main_native_option_prepare",
  );

  next = replaceOnce(
    next,
    `    const mode = String(request?.mode || "");
    if (!nonce) return;

    const validation = validate(mode);`,
    `    const mode = String(request?.mode || "");
    const phase = String(request?.phase || "SUBMIT");
    if (!nonce) return;
    if (phase === "PREPARE") {
      if (mode !== "OPTION") {
        return respond(nonce, { ok: false, error: "v029_prepare_mode_invalid", phase });
      }
      return respond(nonce, { ...prepareExactOptionSelection(), phase });
    }
    if (phase !== "SUBMIT") {
      return respond(nonce, { ok: false, error: "v029_bridge_phase_invalid", phase });
    }

    const validation = validate(mode);`,
    "hf73_main_prepare_phase",
  );

  next = replaceOnce(
    next,
    `  document.addEventListener(REQUEST_EVENT, (event) => {`,
    `  if (globalThis.__COMMERCE_OS_EXPOSE_A21_V029_TEST_HOOKS__ === true) {
    globalThis.__commerceOsA21V029TestHooks = {
      exactSemanticOptionControls,
      nativeCheckExactRadio,
      prepareExactOptionSelection,
    };
    return;
  }

  document.addEventListener(REQUEST_EVENT, (event) => {`,
    "hf73_main_test_hooks",
  );

  return next;
}
