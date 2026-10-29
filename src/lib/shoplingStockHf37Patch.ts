function replaceOnce(source: string, before: string, after: string, code: string) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${code}:anchor_missing`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${code}:anchor_not_unique`);
  }
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

const DATE_VALUE_FILTER_BEFORE = `      return /^20\\d{6}$|^201\\d{5}$/.test(digits(el.value)) && /일자|날짜|기간|등록일|date/i.test(\`${"${context}"} ${"${el.name || \"\"}"} ${"${el.id || \"\"}"}\`);`;

const DATE_VALUE_FILTER_AFTER = `      const metadata = \`${"${context}"} ${"${el.name || \"\"}"} ${"${el.id || \"\"}"} ${"${el.placeholder || \"\"}"}\`;
      const valueDigits = digits(el.value);
      const hasDateSemantics = /일자|날짜|기간|등록일|date/i.test(metadata);
      const hasDateValue = /^20\\d{6}$|^201\\d{5}$/.test(valueDigits);
      return hasDateSemantics && (hasDateValue || valueDigits.length === 0);`;

const DATE_PAIR_HEADER_BEFORE = `  function datePair(form) {
    const namedStarts = [...form.querySelectorAll('input[name="s_dt"], input#s_dt')];`;

const DATE_PAIR_HEADER_AFTER = `  function dateFieldDiagnostics(form) {
    return [...form.querySelectorAll("input")]
      .filter((el) => visible(el))
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const context = norm(el.closest("tr")?.textContent || el.parentElement?.textContent);
        return { name: String(el.name || ""), id: String(el.id || ""), type: String(el.type || ""), valueDigits: digits(el.value), context: context.slice(0, 120), top: Math.round(rect.top), left: Math.round(rect.left) };
      })
      .filter((item) => /일자|날짜|기간|등록일|date/i.test(\`${"${item.context}"} ${"${item.name}"} ${"${item.id}"}\`))
      .slice(0, 12);
  }
  function datePair(form) {
    const namedStarts = [...form.querySelectorAll('input[name="s_dt"], input#s_dt')];`;

const AMBIGUOUS_BEFORE = `    if (!pair) return { ok: false, code: "SEARCH_DATE_FIELDS_AMBIGUOUS", message: "검색 시작일·종료일을 정확히 특정하지 못해 검색을 차단했습니다." };`;
const AMBIGUOUS_AFTER = `    if (!pair) return { ok: false, code: "SEARCH_DATE_FIELDS_AMBIGUOUS", message: "검색 시작일·종료일을 정확히 특정하지 못해 검색을 차단했습니다.", evidence: { stage: "PRE_SEARCH_DATE_BINDING", mutationAttempted: false, dateCandidates: dateFieldDiagnostics(form) } };`;

export function patchShoplingStockHf37Worker(source: string) {
  let worker = source;
  worker = replaceOnce(
    worker,
    DATE_PAIR_HEADER_BEFORE,
    DATE_PAIR_HEADER_AFTER,
    "shopling_stock_hf37_date_diagnostics",
  );
  worker = replaceOnce(
    worker,
    DATE_VALUE_FILTER_BEFORE,
    DATE_VALUE_FILTER_AFTER,
    "shopling_stock_hf37_empty_date_controls",
  );
  worker = replaceOnce(
    worker,
    AMBIGUOUS_BEFORE,
    AMBIGUOUS_AFTER,
    "shopling_stock_hf37_ambiguous_date_evidence",
  );
  return worker;
}
