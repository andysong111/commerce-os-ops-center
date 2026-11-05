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

export function patchHf69OpsSource(source: string) {
  const before = `    const job = {
      ...rawJob,
      goodsKeys: result.goodsKeys,
      stockStateApiApplied: true,
      optionApiApplied: String(rawJob?.productKind || "").toUpperCase() === "OPTION",
      productStatusApiApplied: String(rawJob?.productKind || "").toUpperCase() === "SINGLE",
      goodsKeySource: "SHOPLING_BCODE_API_INDEX",
      stockStateApiEvidence: result.receipts,
    };`;
  const after = `    const transmissions = Array.isArray(result.transmissions)
      ? result.transmissions
      : [];
    const transmissionByGoodsKey = new Map(
      transmissions.map((row) => [String(row?.goodsKey || ""), row]),
    );
    if (
      transmissions.length !== result.goodsKeys.length ||
      result.goodsKeys.some((goodsKey) => !transmissionByGoodsKey.has(String(goodsKey)))
    ) {
      throw new Error("Shopling API goods key별 전송 분기표가 완전하지 않습니다.");
    }
    const firstTransmission = transmissionByGoodsKey.get(String(result.goodsKeys[0]));
    const job = {
      ...rawJob,
      logicalProductKind: String(rawJob?.productKind || "").toUpperCase(),
      productKind: firstTransmission?.effectiveProductKind || rawJob?.productKind,
      goodsKeys: result.goodsKeys,
      stockStateTransmissions: transmissions,
      stockStateApiApplied: true,
      // HF69 intentionally restores one-goods-key-at-a-time A21 dispatch. The
      // background selects OPTION/SINGLE again before every key.
      optionApiApplied: false,
      productStatusApiApplied: transmissions.some(
        (row) => row?.transmissionKind === "PRODUCT_SALE_STATUS_SEND",
      ),
      goodsKeySource: "SHOPLING_BCODE_API_INDEX_AND_LIVE_OPTION_SHAPE",
      stockStateApiEvidence: result.receipts,
    };`;
  return replaceOnce(source, before, after, "hf69_ops_per_goods_key_plan");
}

export function patchHf69A21ContentSource(source: string) {
  let next = replaceOnce(
    source,
    'const VERSION = "0.2.5";',
    'const VERSION = "0.2.6";',
    "hf69_content_version",
  );
  const beforeMode = `  function semanticOptionMode() {
    const candidates = [];
    for (const node of document.querySelectorAll("td, th, label")) {
      const controls = controlInsideLabelOrCell(node);
      if (!isExactOptionModeCell(node.textContent, controls.length)) continue;
      if (controls.length === 1) candidates.push(controls[0]);
    }
    const unique = uniqueControls(candidates);
    return unique.length === 1 ? unique[0] : null;
  }`;
  const afterMode = `  function optionModeEvidence(control) {
    const chunks = [];
    if (control?.id) {
      for (const label of document.querySelectorAll("label")) {
        if (label.htmlFor === control.id) chunks.push(label.textContent || "");
      }
    }
    const wrapping = control?.closest?.("label");
    if (wrapping) chunks.push(wrapping.textContent || "");
    for (const node of [
      control?.previousSibling,
      control?.nextSibling,
      control?.previousElementSibling,
      control?.nextElementSibling,
      control?.parentElement,
      control?.closest?.("td,th"),
      control?.closest?.("tr"),
    ]) {
      if (node) chunks.push(node.textContent || node.nodeValue || "");
    }
    return compact(chunks.join(" | "));
  }

  function isVisibleOptionModeEvidence(text) {
    const value = compact(text);
    return value.includes("옵션송신") &&
      !value.includes("선택") &&
      !value.includes("추가상품송신") &&
      !value.includes("옵션+추가상품송신");
  }

  function semanticOptionMode() {
    const candidates = uniqueControls([
      ...document.querySelectorAll('input[type="radio"]'),
    ]).filter((control) => isVisibleOptionModeEvidence(optionModeEvidence(control)));
    // This restores the proven pre-HF68 behavior: choose the visible top mode
    // control by page order, click it, then locate the lower option-only row.
    candidates.sort(
      (left, right) =>
        left.getBoundingClientRect().top - right.getBoundingClientRect().top ||
        left.getBoundingClientRect().left - right.getBoundingClientRect().left,
    );
    return candidates[0] || null;
  }`;
  next = replaceOnce(next, beforeMode, afterMode, "hf69_content_visible_mode");

  const beforeConfigure = `  async function configureOption() {
    status("옵션 전송 form 설정 중");
    if (await chooseMode("goods_stock")) {
      await sleep(180);
      if (await selectRadio("trsmt_env_mody_opt", "1") && verifyOptionContract()) {
        markExactOptionControls();
        return { ok: true, locator: "FORM_CONTRACT" };
      }
    }
    if (!await configureOptionByVisibleLabels()) {
      return {
        ok: false,
        code: "V025_OPTION_VISIBLE_LABELS",
        message: "상단 '옵션송신' 모드와 하단 '옵션송신-선택' 단추를 정확히 구분해 선택하지 못했습니다.",
      };
    }
    return { ok: true, locator: "EXACT_VISIBLE_LABELS" };
  }`;
  const afterConfigure = `  async function configureOption() {
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
      code: "V026_OPTION_VISIBLE_AND_FORM_CONTRACT",
      message: "상단 '옵션송신'과 하단 옵션 전용 '선택' 단추를 실제 화면에서 클릭하지 못했습니다.",
    };
  }`;
  next = replaceOnce(next, beforeConfigure, afterConfigure, "hf69_content_visible_first");
  return next;
}

export function patchHf69A21MainSource(source: string) {
  let next = replaceOnce(
    source,
    'const VERSION = "0.2.5";',
    'const VERSION = "0.2.6";',
    "hf69_main_version",
  );
  const before = `  function semanticModeMatches(control) {
    for (const node of document.querySelectorAll("td, th, label")) {
      if (compact(node.textContent) !== "옵션송신") continue;
      if (node.contains(control)) return true;
      if (node instanceof HTMLLabelElement && node.htmlFor && document.getElementById(node.htmlFor) === control) return true;
    }
    return false;
  }`;
  const after = `  function semanticModeMatches(control) {
    const chunks = [];
    if (control?.id) {
      for (const label of document.querySelectorAll("label")) {
        if (label.htmlFor === control.id) chunks.push(label.textContent || "");
      }
    }
    for (const node of [
      control?.closest?.("label"),
      control?.previousSibling,
      control?.nextSibling,
      control?.previousElementSibling,
      control?.nextElementSibling,
      control?.parentElement,
      control?.closest?.("td,th"),
      control?.closest?.("tr"),
    ]) {
      if (node) chunks.push(node.textContent || node.nodeValue || "");
    }
    const evidence = compact(chunks.join(" | "));
    return evidence.includes("옵션송신") &&
      !evidence.includes("선택") &&
      !evidence.includes("추가상품송신") &&
      !evidence.includes("옵션+추가상품송신");
  }`;
  next = replaceOnce(next, before, after, "hf69_main_visible_mode_readback");
  return next;
}

