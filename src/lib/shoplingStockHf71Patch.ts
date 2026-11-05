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

export function patchHf71A21ContentSource(source: string) {
  let next = replaceOnce(
    source,
    'const VERSION = "0.2.7";',
    'const VERSION = "0.2.8";',
    "hf71_content_version",
  );

  const beforeMode = `  function exactOptionModeOwner(control) {
    const candidates = [];
    if (control?.id) {
      for (const label of document.querySelectorAll("label")) {
        if (label.htmlFor === control.id) candidates.push(label);
      }
    }
    for (const node of [
      control?.closest?.("label"),
      control?.closest?.("td,th"),
      control?.parentElement,
    ]) {
      if (node) candidates.push(node);
    }
    return candidates.some((node) => {
      const controls = controlInsideLabelOrCell(node);
      return isExactOptionModeCell(node.textContent, controls.length) &&
        controls.length === 1 && controls[0] === control;
    });
  }

  function semanticOptionMode() {
    const candidates = uniqueControls([
      ...document.querySelectorAll('input[type="radio"]'),
    ]).filter((control) => visibleChoice(control) && exactOptionModeOwner(control));
    // Never inspect the whole top row here. That row contains all three mode
    // labels, which made the leftmost 일반내용수정 radio look like 옵션송신.
    return candidates.length === 1 ? candidates[0] : null;
  }`;
  const afterMode = `  function exactInlineModeTexts(control) {
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
    ]) {
      if (node) chunks.push(node.textContent || node.nodeValue || "");
    }
    return [...new Set(chunks.map(compact).filter(Boolean))].slice(0, 8);
  }

  function optionModeSnapshot(control, index) {
    const rect = control.getBoundingClientRect();
    return {
      control,
      index,
      id: String(control.id || "").slice(0, 80),
      name: String(control.name || "").slice(0, 80),
      value: String(control.value || "").slice(0, 80),
      checked: Boolean(control.checked),
      disabled: Boolean(control.disabled),
      visible: control.offsetParent !== null || rect.width > 0 || rect.height > 0,
      top: Math.round(Number(rect.top) || 0),
      left: Math.round(Number(rect.left) || 0),
      inlineTexts: exactInlineModeTexts(control),
      cellText: compact(control.closest?.("td,th")?.textContent || "").slice(0, 120),
    };
  }

  function chooseOptionModeSnapshot(snapshots) {
    const usable = snapshots.filter((row) => row.visible && !row.disabled);
    const exact = usable.filter((row) => row.inlineTexts.includes("옵션송신"));
    if (exact.length === 1) return exact[0].index;
    if (exact.length > 1) return -1;

    const ordered = [...usable].sort((left, right) => left.top - right.top || left.left - right.left);
    if (ordered.length < 3) return -1;
    const firstTop = ordered[0].top;
    const topRow = ordered
      .filter((row) => Math.abs(row.top - firstTop) <= 8)
      .sort((left, right) => left.left - right.left);
    if (topRow.length !== 3) return -1;
    const expected = ["일반내용수정", "상품판매상태송신", "옵션송신"];
    const exactHeaderOrder = topRow.every((row, position) =>
      row.inlineTexts.includes(expected[position]) || row.cellText.startsWith(expected[position]),
    );
    return exactHeaderOrder ? topRow[2].index : -1;
  }

  function safeOptionModeDiagnostics(snapshots) {
    return snapshots.slice(0, 12).map((row) => ({
      index: row.index,
      id: String(row.id || "").slice(0, 80),
      name: String(row.name || "").slice(0, 80),
      value: String(row.value || "").slice(0, 80),
      checked: row.checked,
      top: row.top,
      left: row.left,
      inlineTexts: (row.inlineTexts || []).slice(0, 8).map((text) => String(text).slice(0, 120)),
      cellText: String(row.cellText || "").slice(0, 120),
    }));
  }

  let lastOptionModeDiagnostic = "";

  function optionModeSnapshots() {
    return [...document.querySelectorAll('input[type="radio"]')]
      .filter((control) => control instanceof HTMLInputElement)
      .map(optionModeSnapshot);
  }

  function semanticOptionMode() {
    const snapshots = optionModeSnapshots();
    const selectedIndex = chooseOptionModeSnapshot(snapshots);
    lastOptionModeDiagnostic = JSON.stringify(safeOptionModeDiagnostics(snapshots)).slice(0, 1800);
    return selectedIndex < 0
      ? null
      : snapshots.find((row) => row.index === selectedIndex)?.control || null;
  }`;
  next = replaceOnce(next, beforeMode, afterMode, "hf71_content_mode_locator");

  const beforeSelect = `  async function selectMarkedChoice(target, marker) {
    if (!visibleChoice(target)) return false;
    for (const node of document.querySelectorAll(\`[\${marker}]\`)) node.removeAttribute(marker);
    target.setAttribute(marker, "true");
    if (!target.checked) target.click();
    await sleep(45);
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
    return target.checked;
  }`;
  const afterSelect = `  async function selectMarkedChoice(target, marker) {
    if (!visibleChoice(target)) return false;
    for (const node of document.querySelectorAll(\`[\${marker}]\`)) node.removeAttribute(marker);
    target.setAttribute(marker, "true");
    if (!target.checked) target.click();
    if (!target.checked) target.checked = true;
    if (marker === OPTION_MODE_MARKER) {
      const snapshots = optionModeSnapshots();
      const selectedIndex = chooseOptionModeSnapshot(snapshots);
      const selectedSnapshot = snapshots.find((row) => row.index === selectedIndex);
      for (const row of snapshots) {
        if (row.index !== selectedIndex && Math.abs(row.top - (selectedSnapshot?.top ?? -9999)) <= 8) {
          row.control.checked = false;
        }
      }
    }
    await sleep(45);
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
    return target.checked;
  }`;
  next = replaceOnce(next, beforeSelect, afterSelect, "hf71_content_force_checked");

  const beforeConfigure = `    return {
      ok: false,
      code: "V026_OPTION_VISIBLE_AND_FORM_CONTRACT",
      message: "상단 '옵션송신'과 하단 옵션 전용 '선택' 단추를 실제 화면에서 클릭하지 못했습니다.",
    };`;
  const afterConfigure = `    return {
      ok: false,
      code: "V028_OPTION_VISIBLE_AND_FORM_CONTRACT",
      message: \`상단 '옵션송신'과 하단 옵션 전용 '선택' 단추를 실제 화면에서 클릭하지 못했습니다. 라디오 진단=\${lastOptionModeDiagnostic || "없음"}\`,
    };`;
  next = replaceOnce(next, beforeConfigure, afterConfigure, "hf71_content_failure_diagnostic");

  const beforeHooks = `      isExactOptionModeCell,
      classifyOptionFieldRow,`;
  const afterHooks = `      isExactOptionModeCell,
      classifyOptionFieldRow,
      chooseOptionModeSnapshot,
      safeOptionModeDiagnostics,`;
  return replaceOnce(next, beforeHooks, afterHooks, "hf71_content_test_hooks");
}

export function patchHf71A21MainSource(source: string) {
  let next = replaceOnce(
    source,
    'const VERSION = "0.2.7";',
    'const VERSION = "0.2.8";',
    "hf71_main_version",
  );
  const before = `  function semanticModeMatches(control) {
    const candidates = [];
    if (control?.id) {
      for (const label of document.querySelectorAll("label")) {
        if (label.htmlFor === control.id) candidates.push(label);
      }
    }
    for (const node of [
      control?.closest?.("label"),
      control?.closest?.("td,th"),
      control?.parentElement,
    ]) {
      if (node) candidates.push(node);
    }
    return candidates.some((node) => {
      const controls = [...node.querySelectorAll('input[type="radio"], input[type="checkbox"]')];
      if (node instanceof HTMLLabelElement && node.htmlFor) {
        const target = document.getElementById(node.htmlFor);
        if (target) controls.push(target);
      }
      const unique = [...new Set(controls)];
      return compact(node.textContent) === "옵션송신" &&
        unique.length === 1 && unique[0] === control;
    });
  }`;
  const after = `  function exactInlineModeTexts(control) {
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
    ]) {
      if (node) chunks.push(node.textContent || node.nodeValue || "");
    }
    return [...new Set(chunks.map(compact).filter(Boolean))].slice(0, 8);
  }

  function semanticModeMatches(control) {
    const radios = [...document.querySelectorAll('input[type="radio"]')]
      .filter((row) => row instanceof HTMLInputElement && !row.disabled)
      .map((row) => {
        const rect = row.getBoundingClientRect();
        return {
          control: row,
          visible: row.offsetParent !== null || rect.width > 0 || rect.height > 0,
          top: Math.round(Number(rect.top) || 0),
          left: Math.round(Number(rect.left) || 0),
          inlineTexts: exactInlineModeTexts(row),
          cellText: compact(row.closest?.("td,th")?.textContent || "").slice(0, 120),
        };
      })
      .filter((row) => row.visible)
      .sort((left, right) => left.top - right.top || left.left - right.left);
    const exact = radios.filter((row) => row.inlineTexts.includes("옵션송신"));
    if (exact.length > 0) return exact.length === 1 && exact[0].control === control;
    if (radios.length < 3) return false;
    const firstTop = radios[0].top;
    const topRow = radios.filter((row) => Math.abs(row.top - firstTop) <= 8)
      .sort((left, right) => left.left - right.left);
    if (topRow.length !== 3) return false;
    const expected = ["일반내용수정", "상품판매상태송신", "옵션송신"];
    return topRow.every((row, position) =>
      row.inlineTexts.includes(expected[position]) || row.cellText.startsWith(expected[position]),
    ) && topRow[2].control === control;
  }`;
  next = replaceOnce(next, before, after, "hf71_main_mode_locator");

  next = replaceOnce(
    next,
    'error: "v025_option_semantic_guard_invalid"',
    'error: `v028_option_semantic_guard_invalid:name=${String(mode?.name || "").slice(0, 80)}:value=${String(mode?.value || "").slice(0, 80)}:checked=${Boolean(mode?.checked)}`',
    "hf71_main_failure_diagnostic",
  );
  return next;
}
