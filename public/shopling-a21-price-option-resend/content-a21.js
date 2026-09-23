(() => {
  const VERSION = "0.1.4";
  const MAX_VISIBLE_RESULTS = 500;
  const OPENER_PREFIX = "commerce-os-a21-v014:";
  const READY_MESSAGE = "A21_POPUP_READY_V013";
  const GENERAL_ROWS = ["상품명", "판매가", "카테고리", "상품이미지", "수수료", "상세설명", "키워드", "유료서비스", "쇼핑몰배송정보"];
  const normalize = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const bodyText = () => normalize(document.body?.innerText || document.body?.textContent || "");
  const handledListAssignments = new Set();
  const handledPopupAssignments = new Set();
  let autonomousPopupStarted = false;

  function role() {
    const text = bodyText();
    if (/상품수정\s*송신/i.test(text) && /일반내용수정/i.test(text) && /옵션송신/i.test(text)) return "A21_POPUP";
    if (/쇼핑몰상품수정/i.test(text) && /상품\s*수정전송/i.test(text) && /검색항목/i.test(text)) return "A21_LIST";
    if (/성공건수|실패건수|성공여부|수정\s*전송\s*결과|상품\s*등록\s*전송\s*결과/i.test(text)) return "A21_RESULT";
    return "OTHER";
  }

  function visible(element) {
    if (!(element instanceof HTMLElement)) return true;
    const rect = element.getBoundingClientRect();
    return element.offsetParent !== null || rect.width > 0 || rect.height > 0;
  }

  function controlText(element) {
    if (!element) return "";
    const chunks = [];
    if (element instanceof HTMLInputElement) {
      chunks.push(element.value || "", element.title || "", element.alt || "", element.name || "", element.getAttribute("aria-label") || "");
    } else {
      chunks.push(element.textContent || "", element.getAttribute?.("title") || "", element.getAttribute?.("alt") || "", element.getAttribute?.("aria-label") || "");
    }
    return normalize(chunks.join(" "));
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
    return normalize(chunks.join(" "));
  }

  function adjacentText(control) {
    return normalize(`${localControlText(control)} ${control?.parentElement?.textContent || ""}`);
  }

  function clickableText(element) {
    return controlText(element) || normalize(element?.textContent || "");
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
    const wanted = normalize(target);
    const candidates = [...document.querySelectorAll('input[type="radio"]')]
      .filter((radio) => visible(radio) && adjacentText(radio).includes(wanted));
    candidates.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    return candidates[0] || null;
  }

  function logicalGeneralRow(label) {
    const wanted = normalize(label);
    const rows = [...document.querySelectorAll("tr")]
      .filter((row) => {
        const text = normalize(row.textContent || "");
        const radios = row.querySelectorAll('input[type="radio"]');
        return radios.length === 2 && (text === wanted || text.startsWith(`${wanted} `));
      });
    if (rows.length) return rows[0];

    const exactNodes = [...document.querySelectorAll("td,th,div,span")].filter((node) => normalize(node.textContent || "") === wanted);
    for (const node of exactNodes) {
      let cursor = node.parentElement;
      for (let depth = 0; cursor && depth < 5; depth += 1, cursor = cursor.parentElement) {
        const radios = cursor.querySelectorAll('input[type="radio"]');
        if (radios.length === 2) return cursor;
        if (radios.length > 2) break;
      }
    }
    return null;
  }

  function selectGeneralRow(label, modify) {
    const row = logicalGeneralRow(label);
    if (!row) return false;
    const radios = [...row.querySelectorAll('input[type="radio"]')];
    if (radios.length !== 2) return false;
    const target = modify ? radios[0] : radios[1];
    if (!setControl(target, true)) return false;
    return target.checked && !radios[modify ? 1 : 0].checked;
  }

  function verifyPriceConfiguration() {
    const general = modeRadio("일반내용수정");
    if (!general?.checked) return false;
    for (const label of GENERAL_ROWS) {
      const row = logicalGeneralRow(label);
      if (!row) return false;
      const radios = [...row.querySelectorAll('input[type="radio"]')];
      if (radios.length !== 2) return false;
      const expectedIndex = label === "판매가" ? 0 : 1;
      if (!radios[expectedIndex].checked || radios[1 - expectedIndex].checked) return false;
    }
    return true;
  }

  function configurePricePopup() {
    const top = modeRadio("일반내용수정");
    if (!setControl(top, true)) return { ok: false, code: "A21_GENERAL_MODE_NOT_FOUND", message: "일반내용수정 모드를 찾지 못했습니다." };
    for (const label of GENERAL_ROWS) {
      if (!selectGeneralRow(label, label === "판매가")) {
        return { ok: false, code: "A21_GENERAL_ROW_SELECT_FAILED", message: `${label} 행을 정확히 설정하지 못했습니다.` };
      }
    }
    if (!verifyPriceConfiguration()) {
      return { ok: false, code: "A21_PRICE_CONFIGURATION_VERIFY_FAILED", message: "판매가만 수정, 나머지 일반항목은 수정안함 상태 검증에 실패했습니다." };
    }
    return { ok: true };
  }

  function optionSelectionControl() {
    const controls = [...document.querySelectorAll('input[type="radio"],input[type="checkbox"]')]
      .filter((item) => visible(item));
    const candidates = controls.filter((item) => {
      const text = adjacentText(item);
      return text.includes("옵션송신") && text.includes("선택") && !text.includes("추가상품송신") && !text.includes("옵션+추가상품송신");
    });
    candidates.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    return candidates[0] || null;
  }

  function configureOptionPopup() {
    const top = modeRadio("옵션송신");
    if (!setControl(top, true)) return { ok: false, code: "A21_OPTION_MODE_NOT_FOUND", message: "상단 옵션송신 모드를 찾지 못했습니다." };
    const control = optionSelectionControl();
    if (!setControl(control, true)) return { ok: false, code: "A21_OPTION_SELECT_NOT_FOUND", message: "옵션송신 선택 버튼을 찾지 못했습니다." };
    for (const item of document.querySelectorAll('input[type="checkbox"]')) {
      const text = adjacentText(item);
      if (text.includes("추가상품송신") || text.includes("옵션+추가상품송신")) setControl(item, false);
    }
    if (!top.checked || !control.checked) return { ok: false, code: "A21_OPTION_CONFIGURATION_VERIFY_FAILED", message: "옵션송신 단독 선택 상태 검증에 실패했습니다." };
    return { ok: true };
  }

  function selectOptionByText(select, text) {
    const target = normalize(text);
    const option = [...select.options].find((item) => normalize(item.textContent) === target)
      || [...select.options].find((item) => normalize(item.textContent).includes(target));
    if (!option) return false;
    select.value = option.value;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function setSearchFieldToGoodsKey() {
    const selects = [...document.querySelectorAll("select")].filter((select) =>
      [...select.options].some((option) => normalize(option.textContent).includes("샵플링상품코드")),
    );
    let changed = 0;
    for (const select of selects) if (selectOptionByText(select, "샵플링상품코드")) changed += 1;
    return changed > 0;
  }

  function setPageSize500() {
    const selects = [...document.querySelectorAll("select")];
    const candidate = selects.find((select) => {
      const labels = [...select.options].map((option) => normalize(option.textContent));
      return labels.includes("500") && (labels.includes("200") || labels.includes("100") || labels.includes("50") || labels.includes("25"));
    });
    return candidate ? selectOptionByText(candidate, "500") : false;
  }

  function findSearchInput() {
    const inputs = [...document.querySelectorAll('input[type="text"], textarea')].filter((input) => !input.disabled && visible(input));
    let best = null;
    let bestScore = -999;
    for (const input of inputs) {
      const row = input.closest("tr") || input.parentElement;
      const context = normalize(row?.textContent || input.parentElement?.textContent || "");
      let score = 0;
      if (context.includes("검색항목")) score += 10;
      if (context.includes("다중검색")) score += 10;
      if (context.includes("샵플링상품코드")) score += 8;
      if (context.includes("가격검색")) score -= 8;
      if (/^20\d{6}$/.test(normalize(input.value))) score -= 10;
      if (String(input.name || "").toLowerCase().includes("date")) score -= 10;
      if (score > bestScore) { best = input; bestScore = score; }
    }
    return bestScore >= 8 ? best : null;
  }

  function clickSearchNear(input) {
    const form = input?.form || input?.closest("form") || document;
    const candidates = [...form.querySelectorAll('button,input[type="button"],input[type="submit"],input[type="image"],a')]
      .filter((element) => clickableText(element) === "검색");
    if (!candidates.length) return false;
    const inputRect = input.getBoundingClientRect();
    candidates.sort((a, b) => Math.abs(a.getBoundingClientRect().top - inputRect.top) - Math.abs(b.getBoundingClientRect().top - inputRect.top));
    candidates[0].click();
    return true;
  }

  function selectMallSpecificPriceSource() {
    const radios = [...document.querySelectorAll('input[type="radio"]')];
    const candidate = radios.find((radio) => adjacentText(radio).includes("쇼핑몰별판매가"));
    return setControl(candidate, true);
  }

  function parseTotalCount() {
    const match = bodyText().match(/총\s*조회수\s*[:：]?\s*([\d,]+)\s*건/i);
    return match ? Number(match[1].replace(/,/g, "")) : 0;
  }

  function findResultRows(goodsKeys) {
    const target = new Set(goodsKeys.map(String));
    const rows = [...document.querySelectorAll("tr")].filter((row) => row.querySelector('input[type="checkbox"]'));
    const matched = [];
    const seen = new Set();
    for (const row of rows) {
      const text = normalize(row.textContent || "");
      const keys = goodsKeys.filter((key) => new RegExp(`(^|\\D)${String(key).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\D|$)`).test(text));
      if (!keys.length) continue;
      const checkbox = row.querySelector('input[type="checkbox"]');
      if (!checkbox || checkbox.disabled) continue;
      matched.push({ row, checkbox, keys });
      keys.forEach((key) => seen.add(String(key)));
    }
    return { matched, seen, target };
  }

  function clickModifySend() {
    const candidates = [...document.querySelectorAll('button,input[type="button"],input[type="submit"],input[type="image"],a,[onclick]')]
      .filter((element) => /상품\s*수정전송/.test(clickableText(element)));
    if (!candidates.length) return false;
    candidates[0].click();
    return true;
  }

  function submitButton() {
    const selector = 'button,input[type="button"],input[type="submit"],input[type="image"],a,[onclick],img[alt],img[title]';
    const nodes = [...document.querySelectorAll(selector)].filter((node) => visible(node));
    let candidate = nodes.find((element) => /상품수정\s*송신/.test(clickableText(element)));
    if (!candidate) candidate = nodes.find((element) => /상품수정\s*송신/.test(normalize(element.textContent || "")));
    if (!candidate) return null;
    if (candidate instanceof HTMLImageElement) return candidate.closest("a,button,input") || candidate;
    return candidate;
  }

  function clickSubmitButton(button) {
    if (!button) return false;
    try {
      button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
      button.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
      button.click();
      return true;
    } catch {
      return false;
    }
  }

  async function fail(jobId, code, message) {
    await chrome.runtime.sendMessage({ type: "A21_JOB_FAILURE", jobId, code, message }).catch(() => null);
  }

  async function stage(jobId, nextStage, extra = {}) {
    await chrome.runtime.sendMessage({ type: "A21_STAGE", jobId, stage: nextStage, ...extra }).catch(() => null);
  }

  function encodeAssignment(message) {
    try {
      return OPENER_PREFIX + encodeURIComponent(JSON.stringify({ jobId: String(message.jobId), mode: String(message.mode), runId: String(message.runId || ""), desiredSaleStatus: String(message.desiredSaleStatus || "") }));
    } catch {
      return "";
    }
  }

  function markWorker(message) {
    if (role() !== "A21_LIST" || !message?.jobId || !message?.mode) return;
    const marker = encodeAssignment(message);
    if (marker) window.name = marker;
  }

  function assignmentFromMarker(raw) {
    if (!raw?.startsWith(OPENER_PREFIX)) return null;
    try {
      const parsed = JSON.parse(decodeURIComponent(raw.slice(OPENER_PREFIX.length)));
      if (!parsed?.jobId || !["PRICE", "OPTION", "STATUS"].includes(parsed.mode)) return null;
      return { jobId: String(parsed.jobId), mode: String(parsed.mode), runId: String(parsed.runId || ""), desiredSaleStatus: String(parsed.desiredSaleStatus || "") };
    } catch {
      return null;
    }
  }

  function openerAssignment() {
    let own = "";
    try { own = String(window.name || ""); } catch { /* ignore */ }
    const fromOwn = assignmentFromMarker(own);
    if (fromOwn) return fromOwn;
    let opener = "";
    try { opener = String(window.opener?.name || ""); } catch { return null; }
    return assignmentFromMarker(opener);
  }

  function resultEvidence() {
    const text = bodyText();
    const successMatch = text.match(/성공건수\s*[:：]?\s*([\d,]+)/i);
    const failMatch = text.match(/실패건수\s*[:：]?\s*([\d,]+)/i);
    const success = successMatch ? Number(successMatch[1].replace(/,/g, "")) : 0;
    const failure = failMatch ? Number(failMatch[1].replace(/,/g, "")) : 0;
    const explicitSuccess = /성공여부\s*[:：]?\s*성공/i.test(text) || /정상적으로.*처리/i.test(text);
    const explicitFailure = /성공여부\s*[:：]?\s*실패/i.test(text);
    return { success, failure, explicitSuccess, explicitFailure };
  }

  async function waitForResult(assignment) {
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      const evidence = resultEvidence();
      if (evidence.failure > 0 || evidence.explicitFailure) {
        return fail(assignment.jobId, "A21_SHOPLING_RESULT_FAILURE", `Shopling 결과에서 실패 ${evidence.failure || 1}건을 확인했습니다.`);
      }
      if (evidence.success > 0 || evidence.explicitSuccess) {
        await chrome.runtime.sendMessage({ type: "A21_JOB_SUCCESS", jobId: assignment.jobId, message: `${assignment.mode === "PRICE" ? "판매가" : "옵션"} 수정전송 성공 확인` }).catch(() => null);
        return;
      }
      await sleep(1000);
    }
    return fail(assignment.jobId, "A21_RESULT_TIMEOUT", "상품수정 송신 후 180초 동안 확정 성공 결과를 확인하지 못했습니다.");
  }

  async function configureAndSearch(assignment) {
    if (role() !== "A21_LIST") return fail(assignment.jobId, "A21_LIST_NOT_DETECTED", "A21 목록 화면을 확인하지 못했습니다.");
    if (!Array.isArray(assignment.goodsKeys) || assignment.goodsKeys.length < 1 || assignment.goodsKeys.length > 200) {
      return fail(assignment.jobId, "A21_GOODSKEY_BATCH_INVALID", "검색 GOODSKEY 묶음이 1~200개 범위를 벗어났습니다.");
    }
    setPageSize500();
    if (!setSearchFieldToGoodsKey()) return fail(assignment.jobId, "A21_GOODSKEY_SEARCH_SELECT_NOT_FOUND", "검색항목의 샵플링상품코드 선택을 찾지 못했습니다.");
    if (assignment.mode !== "STATUS" && !selectMallSpecificPriceSource()) return fail(assignment.jobId, "A21_MALL_PRICE_SOURCE_NOT_FOUND", "쇼핑몰별판매가 버튼을 찾지 못했습니다.");
    const input = findSearchInput();
    if (!input) return fail(assignment.jobId, "A21_MULTI_SEARCH_INPUT_NOT_FOUND", "샵플링상품코드 다중검색 입력칸을 찾지 못했습니다.");
    input.value = assignment.goodsKeys.join(",");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await stage(assignment.jobId, "SEARCH_SUBMITTED", { message: `${assignment.goodsKeys.length}개 GOODSKEY 검색` });
    if (!clickSearchNear(input)) return fail(assignment.jobId, "A21_SEARCH_BUTTON_NOT_FOUND", "검색 버튼을 찾지 못했습니다.");
  }

  async function selectRowsAndOpenPopup(assignment) {
    if (role() !== "A21_LIST") return;
    await sleep(500);
    const total = parseTotalCount();
    if (total > MAX_VISIBLE_RESULTS) {
      await chrome.runtime.sendMessage({ type: "A21_SPLIT_REQUIRED", jobId: assignment.jobId, totalResultCount: total }).catch(() => null);
      return;
    }
    if (total <= 0) return fail(assignment.jobId, "A21_EMPTY_RESULT", "검색 결과가 0건이어서 전송하지 않았습니다.");
    if (assignment.mode !== "STATUS" && !selectMallSpecificPriceSource()) return fail(assignment.jobId, "A21_MALL_PRICE_SOURCE_RESET", "검색 후 쇼핑몰별판매가 선택이 유지되지 않아 전송을 차단했습니다.");
    const { matched, seen, target } = findResultRows(assignment.goodsKeys);
    const missing = [...target].filter((key) => !seen.has(key));
    if (missing.length) return fail(assignment.jobId, "A21_GOODSKEY_RESULT_MISSING", `검색 결과에 GOODSKEY ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? " 외" : ""}가 없습니다.`);
    if (matched.length !== total) return fail(assignment.jobId, "A21_VISIBLE_ROW_COUNT_MISMATCH", `조회수 ${total}건 중 안전하게 식별한 행은 ${matched.length}건이라 전송하지 않았습니다.`);
    for (const item of matched) setControl(item.checkbox, true);
    const checked = matched.filter((item) => item.checkbox.checked).length;
    if (checked !== total) return fail(assignment.jobId, "A21_ROW_SELECTION_MISMATCH", `${total}건 중 ${checked}건만 선택되어 전송을 차단했습니다.`);
    markWorker(assignment);
    await stage(assignment.jobId, "POPUP_OPENING", { selectedRowCount: checked, totalResultCount: total, message: `${checked}개 쇼핑몰 행 선택 완료` });
    if (!clickModifySend()) return fail(assignment.jobId, "A21_MODIFY_SEND_BUTTON_NOT_FOUND", "상품 수정전송 버튼을 찾지 못했습니다.");
  }

  async function configureAndSubmitPopup(assignment) {
    if (role() !== "A21_POPUP") return fail(assignment.jobId, "A21_POPUP_NOT_DETECTED", "상품수정 송신 팝업을 확인하지 못했습니다.");
    try { window.name = encodeAssignment(assignment); } catch { /* ignore */ }
    await chrome.runtime.sendMessage({ type: READY_MESSAGE, ...assignment, version: VERSION }).catch(() => null);
    const configured = assignment.mode === "PRICE" ? configurePricePopup() : configureOptionPopup();
    if (!configured.ok) return fail(assignment.jobId, configured.code || "A21_POPUP_CONFIG_FAILED", configured.message || "수정송신 팝업 설정 실패");
    await sleep(220);
    if (assignment.mode === "PRICE" && !verifyPriceConfiguration()) {
      return fail(assignment.jobId, "A21_PRICE_CONFIGURATION_CHANGED", "송신 직전 판매가 단독 수정 상태가 유지되지 않아 전송을 차단했습니다.");
    }
    const button = submitButton();
    if (!button) {
      const diagnostic = [...document.querySelectorAll('button,input,a,[onclick],img')].map(controlText).filter(Boolean).filter((text) => /송신|수정/.test(text)).slice(0, 12).join(" | ");
      return fail(assignment.jobId, "A21_SUBMIT_BUTTON_NOT_FOUND_V014", `상품수정 송신 버튼을 찾지 못했습니다.${diagnostic ? ` 후보: ${diagnostic}` : ""}`);
    }
    await stage(assignment.jobId, "SUBMIT_CLICKED", { message: `${assignment.mode === "PRICE" ? "판매가" : "옵션"} 단독 설정 검증 완료 · 상품수정 송신 클릭` });
    if (!clickSubmitButton(button)) return fail(assignment.jobId, "A21_SUBMIT_CLICK_FAILED_V014", "상품수정 송신 버튼 클릭 실행에 실패했습니다.");
    await stage(assignment.jobId, "RESULT_WAIT", { message: "Shopling 수정전송 결과 확인 중" });
    await sleep(800);
    if (role() === "A21_RESULT" || /성공건수|실패건수|성공여부/.test(bodyText())) void waitForResult(assignment);
  }

  async function autonomousPopup() {
    if (autonomousPopupStarted) return;
    const assignment = openerAssignment();
    if (!assignment) return;
    if (role() === "A21_RESULT") {
      autonomousPopupStarted = true;
      return waitForResult(assignment);
    }
    if (role() !== "A21_POPUP") return;
    autonomousPopupStarted = true;
    await sleep(180);
    return configureAndSubmitPopup(assignment);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    void (async () => {
      try {
        if (message?.type === "A21_IDENTIFY") {
          sendResponse({ ok: true, role: role(), version: VERSION });
          return;
        }
        if (message?.type === "A21_LIST_ASSIGNMENT") {
          markWorker(message);
          sendResponse({ ok: true, accepted: true });
          const key = `${message.jobId}:${message.stage}`;
          if (handledListAssignments.has(key)) return;
          handledListAssignments.add(key);
          if (message.stage === "SEARCH_SUBMITTED") await selectRowsAndOpenPopup(message);
          else if (["POPUP_OPENING", "POPUP_CONFIG", "SUBMIT_CLICKED", "RESULT_WAIT"].includes(message.stage)) return;
          else await configureAndSearch(message);
          return;
        }
        if (message?.type === "A21_POPUP_ASSIGNMENT") {
          sendResponse({ ok: true, accepted: true });
          const key = `${message.jobId}:submit`;
          if (handledPopupAssignments.has(key)) return;
          handledPopupAssignments.add(key);
          await configureAndSubmitPopup(message);
          return;
        }
        if (message?.type === "A21_POPUP_RESULT_ASSIGNMENT") {
          sendResponse({ ok: true, accepted: true });
          const key = `${message.jobId}:result`;
          if (handledPopupAssignments.has(key)) return;
          handledPopupAssignments.add(key);
          try { window.name = encodeAssignment(message); } catch { /* ignore */ }
          await waitForResult(message);
          return;
        }
        sendResponse({ ok: false, error: "unsupported_message" });
      } catch (error) {
        if (message?.jobId) await fail(message.jobId, "A21_CONTENT_EXCEPTION", error instanceof Error ? error.message : String(error));
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    })();
    return true;
  });

  setTimeout(() => void autonomousPopup(), 50);
  window.addEventListener("load", () => setTimeout(() => void autonomousPopup(), 80), { once: true });
})();
