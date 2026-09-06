// Compose the unchanged mutation template with the tested 2024 search policy.
// v0.4.1 keeps the API+A21 cutover and hardens A21 search binding so the local
// 검색항목 row is selected, the global Shopling header search is never used, and
// one execution can submit Search at most once.
export function buildStockWorkerV030(base, policy) {
  function once(source, before, after) {
    if (source.split(before).length !== 2) throw new Error(`stock_worker_template_mismatch:${before.slice(0,70)}`);
    return source.replace(before, after);
  }
  let source = once(base, 'const VERSION = "0.1.8";', 'const VERSION = "0.4.1";\n  if (globalThis.__commerceStockWorkerV041) return;\n  globalThis.__commerceStockWorkerV041 = true;\n  let executionContext = {};');
  const start = '  async function searchExact(fieldLabel, token) {';
  const end = '  async function searchGoodsKey(goodsKey) {';
  if (source.split(start).length !== 2 || source.split(end).length !== 2) throw new Error('stock_search_template_mismatch');
  source = source.slice(0, source.indexOf(start)) + `  function searchFieldV041(label) {
    const candidates = selectWithOption(label).map((select, index) => {
      const labels = [...select.options].map((option) => norm(option.textContent));
      const row = select.closest("tr");
      const context = norm(row?.textContent || select.parentElement?.textContent || "");
      const localInputs = row
        ? [...row.querySelectorAll('input[type="text"], input:not([type]), input[type="search"]')].filter(visible)
        : [];
      let score = 0;
      if (labels.includes(label)) score += 80;
      if (labels.includes("검색항목")) score += 220;
      if (/검색\\s*항목/.test(context)) score += 180;
      if (localInputs.length) score += 120;
      if (/화면출력|내림차순|오름차순/.test(context)) score -= 500;
      return { select, index, score };
    });
    candidates.sort((left, right) => right.score - left.score || left.index - right.index);
    const best = candidates[0] || null;
    return best && best.score >= 200 ? best.select : null;
  }

  function searchInputV041(field) {
    const row = field?.closest("tr");
    if (!row) return null;
    const fieldRect = field.getBoundingClientRect();
    const inputs = [...row.querySelectorAll('input[type="text"], input:not([type]), input[type="search"]')]
      .filter((input) => visible(input) && !input.disabled)
      .map((input, index) => {
        const rect = input.getBoundingClientRect();
        let score = 0;
        if (rect.left >= fieldRect.right - 8) score += 120;
        score += Math.max(0, 80 - Math.abs(rect.top - fieldRect.top) * 4);
        score += Math.min(80, rect.width / 4);
        return { input, index, score };
      })
      .sort((left, right) => right.score - left.score || left.index - right.index);
    return inputs[0]?.input || null;
  }

  async function searchExact(fieldLabel, token) {
    return globalThis.CommerceStockSearchV023.search(fieldLabel, token, {
      scope: [executionContext.jobId, executionContext.executionId, executionContext.stage].join(":"),
      getField: searchFieldV041,
      selectField: selectByText, findInput: searchInputV041, setInput,
      clickSearch, rows: matchingRows, waitFor, sleep,
      resultCount: () => {
        const match = bodyText().match(/총\\s*조회수\\s*[:：]?\\s*([\\d,]+)\\s*건/i);
        return match ? Number(match[1].replace(/,/g, "")) : null;
      },
    });
  }\n\n` + source.slice(source.indexOf(end));
  source = once(source, '    const job = message.job || {};', '    const job = message.job || {};\n    executionContext = { jobId: job.jobId, executionId: job.executionId, stage: message.stage };');
  source = once(source, '${job.jobId || "unknown"}:${stage}:${goodsKey}:${location.href}', '${job.jobId || "unknown"}:${job.executionId || ""}:${stage}:${goodsKey}:${location.href}');
  // Price-resend worker does not reject a legacy <tr> just because getBoundingClientRect/offsetParent is odd.
  // Keep exact-token + checkbox gates, only remove the visibility prerequisite.
  source = once(
    source,
    '      .filter((row) => visible(row) && regex.test(norm(row.textContent).toUpperCase()))',
    '      .filter((row) => regex.test(norm(row.textContent).toUpperCase()))',
  );
  // Legacy A6 mutation code remains in the shared single-product template for backward compatibility,
  // but v0.4.x OPTION jobs never dispatch A6 because background-v040 requires A21 only.
  const oldA6Status = `    const targetLabel = desiredKorean(job.desiredStatus);
    const selector = selectWithOption("옵션상태")[0] || null;
    if (!selector || !selectByText(selector, "옵션상태")) {
      return { ok: false, code: "A6_OPTION_STATUS_FIELD_NOT_FOUND", message: "A6 선택정보의 옵션상태를 찾지 못했습니다." };
    }
    const targetSelects = selectWithOption(targetLabel).filter((select) => select !== selector);
    targetSelects.sort((left, right) => {
      const base = selector.getBoundingClientRect();
      return Math.abs(left.getBoundingClientRect().top - base.top) - Math.abs(right.getBoundingClientRect().top - base.top);
    });
    const statusSelect = targetSelects[0] || null;
    if (!statusSelect || !selectByText(statusSelect, targetLabel, true)) {
      return { ok: false, code: "A6_TARGET_STATUS_NOT_FOUND", message: \`A6 옵션상태 \${targetLabel} 선택값을 찾지 못했습니다.\` };
    }
    const button = buttonByText(/^(?:일괄\\s*상태변경|상태\\s*일괄변경)$/i);`;
  const newA6Status = `    const targetLabel = desiredKorean(job.desiredStatus);
    const statusSelects = selectWithOption("옵션상태").filter((select) => {
      const labels = [...select.options].map((option) => norm(option.textContent));
      return labels.includes("옵션상태") && labels.includes("판매중") && labels.includes("품절");
    });
    const button = buttonByText(/^(?:일괄\\s*상태변경|상태\\s*일괄변경)$/i);
    if (!button) return { ok: false, code: "A6_BULK_STATUS_BUTTON_NOT_FOUND", message: "A6 상태 일괄변경 버튼을 찾지 못했습니다." };
    if (!statusSelects.length) {
      return { ok: false, code: "A6_OPTION_STATUS_FIELD_NOT_FOUND", message: "A6 옵션상태 변경 드롭다운(판매중/품절)을 찾지 못했습니다." };
    }
    const buttonRect = button.getBoundingClientRect();
    statusSelects.sort((left, right) => {
      const lr = left.getBoundingClientRect();
      const rr = right.getBoundingClientRect();
      const ls = Math.abs(lr.top - buttonRect.top) + Math.abs(lr.right - buttonRect.left) / 4;
      const rs = Math.abs(rr.top - buttonRect.top) + Math.abs(rr.right - buttonRect.left) / 4;
      return ls - rs;
    });
    const statusSelect = statusSelects[0];
    if (!selectByText(statusSelect, targetLabel, true)) {
      return { ok: false, code: "A6_TARGET_STATUS_NOT_FOUND", message: \`A6 옵션상태 드롭다운에서 \${targetLabel}을 선택하지 못했습니다.\` };
    }
    const selectedStatus = norm(statusSelect.options?.[statusSelect.selectedIndex]?.textContent);
    if (selectedStatus !== targetLabel) {
      return { ok: false, code: "A6_TARGET_STATUS_VERIFY_FAILED", message: \`A6 옵션상태가 \${targetLabel}로 유지되지 않아 일괄 변경을 차단했습니다.\`, evidence: { selectedStatus, targetLabel } };
    }`;
  source = once(source, oldA6Status, newA6Status);
  // Do not depend on A6 title/menu text living in the same legacy frame. The unique search option is the role contract.
  source = once(source, 'if (/옵션대량수정/i.test(text) && /(일괄\\s*상태변경|상태\\s*일괄변경)/i.test(text)) return "A6";', 'if (selectWithOption("옵션자체관리코드").length) return "A6";');
  source = once(source, '    const href = String(location.href || "");', `    const href = String(location.href || "");
    if (selectWithOption("옵션자체관리코드").length) return "A6";
    if (/검색항목/.test(text) && selectWithOption("샵플링상품코드").length) {
      if (/쇼핑몰상품수정|상품\\s*수정전송/i.test(text)) return "A21_LIST";
      if (/상품조회수정/i.test(text)) return "A4";
    }`);
  const oldListener = `    void execute(message)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, code: "STOCK_SYNC_EXECUTE_FAILED", message: norm(error?.message || error) }));
    return true;`;
  const newListener = `    sendResponse({ ok: true, accepted: true, version: VERSION });
    void execute(message).catch(() => null);
    return;`;
  source = once(source, oldListener, newListener);
  const output = `${policy}\n${source}`;
  new Function(output);
  return output;
}
