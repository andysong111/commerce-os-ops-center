// Read-only search policy. No product/option mutation occurs in this module.
(() => {
  const START = "20240101";
  const documentToken = `${Date.now()}-${Math.random()}`;
  const completed = new Map();
  const norm = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
  const digits = (v) => String(v ?? "").replace(/\D/g, "");
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  function todayKst(now = new Date()) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    return ["year", "month", "day"].map((type) => parts.find((p) => p.type === type).value).join("");
  }
  function dateValue(input, value) {
    const old = String(input.value || "");
    const sep = input.type === "date" || old.includes("-") ? "-" : old.includes("/") ? "/" : old.includes(".") ? "." : "";
    return [value.slice(0, 4), value.slice(4, 6), value.slice(6)].join(sep);
  }
  function datePair(form) {
    const inputs = [...form.querySelectorAll("input")].filter((el) => {
      const type = String(el.type || "text").toLowerCase();
      if (!["text", "date", "search"].includes(type) || !visible(el)) return false;
      const context = norm(el.closest("tr")?.textContent || el.parentElement?.textContent);
      return /^20\d{6}$/.test(digits(el.value)) && /일자|날짜|기간|등록일|date/i.test(`${context} ${el.name || ""} ${el.id || ""}`);
    });
    const pairs = [];
    for (let i = 0; i < inputs.length; i++) for (let j = i + 1; j < inputs.length; j++) {
      const a = inputs[i], b = inputs[j], ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
      if (Math.abs(ar.top - br.top) <= 18 && (a.closest("tr") === b.closest("tr") || Math.abs(ar.left - br.left) < 240)) {
        pairs.push(ar.left <= br.left ? [a, b] : [b, a]);
      }
    }
    return pairs.length === 1 ? pairs[0] : null;
  }
  function applyPeriod(form, setInput, now = new Date()) {
    const pair = datePair(form);
    if (!pair) return { ok: false, code: "SEARCH_DATE_FIELDS_AMBIGUOUS", message: "검색 시작일·종료일을 정확히 특정하지 못해 검색을 차단했습니다." };
    const end = todayKst(now);
    if (pair.some((el) => el.disabled)) return { ok: false, code: "SEARCH_DATE_DISABLED", message: "검색 날짜 입력칸이 비활성화되어 검색을 차단했습니다." };
    for (const [index, value] of [START, end].entries()) {
      if (digits(pair[index].value) !== value) setInput(pair[index], dateValue(pair[index], value));
    }
    const evidence = { start: digits(pair[0].value), end: digits(pair[1].value), expectedStart: START, expectedEnd: end };
    if (evidence.start !== START || evidence.end !== end) return { ok: false, code: "SEARCH_DATE_VERIFY_FAILED", message: "2024-01-01~오늘 검색기간 설정값 검증에 실패했습니다.", evidence };
    return { ok: true, evidence };
  }
  function resultEvidence(api) {
    const total = typeof api.resultCount === "function" ? api.resultCount() : null;
    return { totalResultCount: Number.isFinite(total) ? total : null };
  }
  async function awaitRows(token, api, timeoutMs) {
    return api.waitFor(() => {
      const found = api.rows(token);
      return found.length ? found : null;
    }, timeoutMs, 200);
  }
  function bindingEvidence(fieldLabel, token, field, input) {
    return {
      expectedFieldLabel: fieldLabel,
      selectedFieldLabel: norm(field?.options?.[field.selectedIndex]?.textContent),
      expectedToken: norm(token).toUpperCase(),
      inputToken: norm(input?.value).toUpperCase(),
    };
  }
  function bindingMatches(evidence) {
    return evidence.selectedFieldLabel === evidence.expectedFieldLabel && evidence.inputToken === evidence.expectedToken;
  }
  async function search(fieldLabel, token, api) {
    let field = api.getField(fieldLabel);
    if (!field) return { ok: false, code: "SEARCH_FIELD_NOT_FOUND", message: `${fieldLabel} 검색항목을 찾지 못했습니다.` };
    let input = api.findInput(field);
    const scope = `${api.scope}:${location.pathname}:${fieldLabel}:${token}`;
    const key = `commerce-stock-search-v041:${scope}`;
    let ticket = null;
    try { ticket = JSON.parse(sessionStorage.getItem(key) || "null"); } catch { /* no usable ticket */ }
    const inDateRange = (e) => e?.start === START && e?.end === todayKst();
    const form = field.form || field.closest("form") || document;
    const pair = datePair(form);
    const currentPeriod = pair ? { start: digits(pair[0].value), end: digits(pair[1].value) } : null;
    const initialBinding = bindingEvidence(fieldLabel, token, field, input);
    const queryMatches = bindingMatches(initialBinding) && inDateRange(currentPeriod);
    // v0.4.1: a successful click ticket is a one-click guard even when Shopling updates
    // the same document/AJAX frame. The previous documentToken inequality retried Search forever.
    const resumed = Boolean(
      ticket &&
      Date.now() - Number(ticket.at || 0) < 90_000 &&
      ticket.fieldLabel === fieldLabel &&
      String(ticket.token || "").toUpperCase() === norm(token).toUpperCase() &&
      queryMatches,
    );
    if (resumed || (completed.has(scope) && queryMatches)) {
      const rows = await awaitRows(token, api, 20_000);
      if (!rows?.length) {
        const evidence = { ...currentPeriod, ...resultEvidence(api), binding: initialBinding, oneClickGuard: resumed };
        const code = Number(evidence.totalResultCount || 0) > 0 ? "EXACT_RESULT_ROW_NOT_BOUND" : "EXACT_RESULT_NOT_FOUND";
        const message = Number(evidence.totalResultCount || 0) > 0
          ? `${token} 조회결과 ${evidence.totalResultCount}건은 확인했지만 정확 행을 worker가 연결하지 못했습니다.`
          : `${token} 정확 일치 검색결과가 없습니다. 동일 작업에서 검색 버튼을 다시 누르지 않았습니다.`;
        return { ok: false, code, message, evidence };
      }
      completed.set(scope, true);
      return { ok: true, rows, fieldLabel, period: currentPeriod };
    }
    if (!api.selectField(field, fieldLabel)) return { ok: false, code: "SEARCH_FIELD_NOT_FOUND", message: `${fieldLabel} 검색항목을 선택하지 못했습니다.` };
    input = await api.waitFor(() => {
      field = api.getField(fieldLabel) || field;
      return api.findInput(field);
    }, 6_000, 120);
    if (!input) {
      return { ok: false, code: "SEARCH_INPUT_NOT_BOUND", message: `${fieldLabel}과 같은 검색행의 입력칸을 찾지 못해 검색을 차단했습니다.` };
    }
    if (!api.setInput(input, token)) return { ok: false, code: "SEARCH_INPUT_SET_FAILED", message: `${fieldLabel} 검색어 ${token}을 입력하지 못했습니다.` };
    field = api.getField(fieldLabel) || field;
    input = api.findInput(field) || input;
    const verifiedBinding = bindingEvidence(fieldLabel, token, field, input);
    if (!bindingMatches(verifiedBinding)) {
      return {
        ok: false,
        code: "SEARCH_BINDING_MISMATCH",
        message: `${fieldLabel} 검색항목과 검색어 입력칸의 결합 검증에 실패해 검색 버튼을 누르지 않았습니다.`,
        evidence: verifiedBinding,
      };
    }
    const period = applyPeriod(input.form || form, api.setInput);
    if (!period.ok) return period;
    await api.sleep(120);
    const livePair = datePair(input.form || form);
    const finalBinding = bindingEvidence(fieldLabel, token, field, input);
    if (!bindingMatches(finalBinding)) {
      return { ok: false, code: "SEARCH_BINDING_MISMATCH", message: "검색 직전 검색항목 또는 검색어가 변경되어 실행을 차단했습니다.", evidence: finalBinding };
    }
    if (!livePair || digits(livePair[0].value) !== START || digits(livePair[1].value) !== todayKst()) {
      return { ok: false, code: "SEARCH_DATE_VERIFY_FAILED", message: "검색 직전 날짜가 변경되어 실행을 차단했습니다." };
    }
    try {
      sessionStorage.setItem(key, JSON.stringify({
        at: Date.now(),
        documentToken,
        fieldLabel,
        token: norm(token).toUpperCase(),
        period: period.evidence,
        submitted: true,
      }));
    } catch {
      return { ok: false, code: "SEARCH_CONTINUATION_STORAGE_FAILED", message: "검색 후 화면 복구정보를 저장하지 못해 실행을 차단했습니다." };
    }
    if (!api.clickSearch(input)) return { ok: false, code: "SEARCH_BUTTON_NOT_FOUND", message: "검색 버튼을 찾지 못했습니다." };
    const rows = await awaitRows(token, api, 30_000);
    if (!rows?.length) {
      const evidence = { ...period.evidence, ...resultEvidence(api), binding: finalBinding, oneClickGuard: true };
      const code = Number(evidence.totalResultCount || 0) > 0 ? "EXACT_RESULT_ROW_NOT_BOUND" : "EXACT_RESULT_NOT_FOUND";
      const message = Number(evidence.totalResultCount || 0) > 0
        ? `${token} 조회결과 ${evidence.totalResultCount}건은 확인했지만 정확 행을 worker가 연결하지 못했습니다.`
        : `${token} 정확 일치 검색결과가 없습니다. 동일 작업에서 검색 버튼을 다시 누르지 않습니다.`;
      return { ok: false, code, message, evidence };
    }
    completed.set(scope, true);
    return { ok: true, rows, fieldLabel, period: period.evidence };
  }
  globalThis.CommerceStockSearchV023 = { search, applyPeriod, datePair, todayKst };
})();
