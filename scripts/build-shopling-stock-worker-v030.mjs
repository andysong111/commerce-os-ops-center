// Compose the unchanged mutation template with the tested maximum-range search policy.
// v0.5.3 keeps A6 as the live source of truth and fixes legacy result rows where
// B-code is rendered in an input value instead of row textContent.
export function buildStockWorkerV030(base, policy) {
  function once(source, before, after) {
    if (source.split(before).length !== 2) throw new Error(`stock_worker_template_mismatch:${before.slice(0,70)}`);
    return source.replace(before, after);
  }
  let source = once(base, 'const VERSION = "0.1.8";', 'const VERSION = "0.4.2";\n  if (globalThis.__commerceStockWorkerV042) return;\n  globalThis.__commerceStockWorkerV042 = true;\n  let executionContext = {};');
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
  source = once(
    source,
    '      .filter((row) => visible(row) && regex.test(norm(row.textContent).toUpperCase()))',
    '      .filter((row) => regex.test(norm(row.textContent).toUpperCase()))',
  );

  const oldMatchingRowsV053 = `  function matchingRows(token) {
    const regex = exactTokenRegex(token);
    return [...document.querySelectorAll("tr")]
      .filter((row) => regex.test(norm(row.textContent).toUpperCase()))
      .map((row) => ({ row, checkbox: row.querySelector('input[type="checkbox"]'), text: norm(row.textContent) }))
      .filter((entry) => entry.checkbox && !entry.checkbox.disabled);
  }`;
  const newMatchingRowsV053 = `  function rowEvidenceTextV053(row) {
    const values = [row?.textContent || ""];
    for (const control of row?.querySelectorAll?.("input,textarea,select") || []) {
      if ("value" in control) values.push(control.value || "");
      if (control instanceof HTMLSelectElement) values.push(control.options?.[control.selectedIndex]?.textContent || "");
    }
    return norm(values.join(" "));
  }

  function matchingRows(token) {
    const regex = exactTokenRegex(token);
    return [...document.querySelectorAll("tr")]
      .map((row) => ({ row, evidenceText: rowEvidenceTextV053(row) }))
      .filter(({ evidenceText }) => regex.test(evidenceText.toUpperCase()))
      .map(({ row, evidenceText }) => ({ row, checkbox: row.querySelector('input[type="checkbox"]'), text: evidenceText }))
      .filter((entry) => entry.checkbox && !entry.checkbox.disabled);
  }`;
  source = once(source, oldMatchingRowsV053, newMatchingRowsV053);

  const oldA21Start = '  async function runA21List(job, goodsKey) {';
  const newA21Start = `  function setA21PageSize200V042() {
    const candidate = [...document.querySelectorAll("select")].find((select) => {
      const labels = [...select.options].map((option) => norm(option.textContent));
      return labels.includes("200") && (labels.includes("25") || labels.includes("50") || labels.includes("100") || labels.includes("500"));
    });
    if (!candidate) return { ok: false, code: "A21_PAGE_SIZE_200_NOT_FOUND", message: "A21 화면출력 200개 선택값을 찾지 못했습니다." };
    const current = norm(candidate.options?.[candidate.selectedIndex]?.textContent);
    if (current !== "200" && !selectByText(candidate, "200", true)) return { ok: false, code: "A21_PAGE_SIZE_200_SET_FAILED", message: "A21 화면출력을 200개로 변경하지 못했습니다." };
    return norm(candidate.options?.[candidate.selectedIndex]?.textContent) === "200"
      ? { ok: true }
      : { ok: false, code: "A21_PAGE_SIZE_200_VERIFY_FAILED", message: "A21 화면출력 200개 설정이 유지되지 않았습니다." };
  }

  function a21TotalResultCountV042() {
    const match = bodyText().match(/총\\s*조회수\\s*[:：]?\\s*([\\d,]+)\\s*건/i);
    return match ? Number(match[1].replace(/,/g, "")) : null;
  }

  async function runA21List(job, goodsKey) {`;
  source = once(source, oldA21Start, newA21Start);
  const oldA21Selection = `    const search = await searchGoodsKey(goodsKey);
    if (!search.ok) return search;
    const selected = selectOnlyMatchingRows(goodsKey);
    if (!selected.ok || selected.count !== 1) {
      return { ok: false, code: "A21_EXACT_ROW_SELECTION_FAILED", message: \`${'${goodsKey}'} A21 정확 일치 행 1건을 단독 선택하지 못했습니다.\`, evidence: { selectedCount: selected.count, searchField: search.fieldLabel } };
    }
    const button = buttonByText(/^상품\\s*수정전송$/i);`;
  const newA21Selection = `    const pageSize = setA21PageSize200V042();
    if (!pageSize.ok) return pageSize;
    const search = await searchGoodsKey(goodsKey);
    if (!search.ok) return search;
    const totalResultCount = a21TotalResultCountV042();
    if (!Number.isInteger(totalResultCount) || totalResultCount <= 0) return { ok: false, code: "A21_RESULT_COUNT_INVALID", message: \`${'${goodsKey}'} A21 조회결과 건수를 확인하지 못했습니다.\`, evidence: { totalResultCount, searchField: search.fieldLabel } };
    if (totalResultCount > 200) return { ok: false, code: "A21_RESULT_OVER_200_BATCH_LIMIT", message: \`${'${goodsKey}'} A21 조회결과가 ${'${totalResultCount}'}건으로 200건을 초과해 부분 전송을 차단했습니다.\`, evidence: { totalResultCount, batchLimit: 200, searchField: search.fieldLabel } };
    const selected = selectOnlyMatchingRows(goodsKey);
    if (!selected.ok || selected.count !== totalResultCount) return { ok: false, code: "A21_EXACT_BATCH_SELECTION_FAILED", message: \`${'${goodsKey}'} A21 조회 ${'${totalResultCount}'}건 중 정확 goods key 행 ${'${selected.count}'}건만 선택되어 전송을 차단했습니다.\`, evidence: { selectedCount: selected.count, totalResultCount, batchLimit: 200, searchField: search.fieldLabel } };
    const button = buttonByText(/^상품\\s*수정전송$/i);`;
  source = once(source, oldA21Selection, newA21Selection);
  source = once(
    source,
    'message: `A21 goods key ${goodsKey} 정확 일치 상품의 수정전송 팝업을 열었습니다.`, evidence: { goodsKey, selectedRows: selected.count, searchField: search.fieldLabel, alerts: click.alerts }',
    'message: `A21 goods key ${goodsKey} 정확 일치 쇼핑몰 행 ${selected.count}건의 수정전송 팝업을 열었습니다.`, evidence: { goodsKey, selectedRows: selected.count, totalResultCount, batchLimit: 200, searchField: search.fieldLabel, alerts: click.alerts }',
  );

  // Live A6: one B-code may appear under several Shopling products. Select every exact B-code row,
  // parse every product-option pair, dedupe product goods keys, mutate all selected options together,
  // and return that live set to background before any A21 transmission starts.
  const oldA6Selection = `    const selected = selectOnlyMatchingRows(job.barcode);
    if (!selected.ok || selected.count !== 1) {
      return { ok: false, code: "A6_EXACT_ROW_SELECTION_FAILED", message: \`${'${job.barcode}'} 정확 일치 행 1건을 단독 선택하지 못했습니다.\`, evidence: { selectedCount: selected.count } };
    }
    const targetLabel = desiredKorean(job.desiredStatus);`;
  const newA6Selection = `    const selected = selectOnlyMatchingRows(job.barcode);
    if (!selected.ok || selected.count <= 0) {
      return { ok: false, code: "A6_EXACT_ROW_SELECTION_FAILED", message: \`${'${job.barcode}'} 정확 일치 행을 선택하지 못했습니다.\`, evidence: { selectedCount: selected.count } };
    }
    const totalMatch = bodyText().match(/총\\s*조회수\\s*[:：]?\\s*([\\d,]+)\\s*건/i);
    const totalResultCount = totalMatch ? Number(totalMatch[1].replace(/,/g, "")) : null;
    if (Number.isInteger(totalResultCount) && totalResultCount > 0 && selected.count !== totalResultCount) {
      return { ok: false, code: "A6_RESULT_PAGE_INCOMPLETE", message: \`${'${job.barcode}'} A6 조회 ${'${totalResultCount}'}건 중 정확 행 ${'${selected.count}'}건만 연결되어 일부 상품코드 누락 위험 때문에 중단했습니다.\`, evidence: { selectedCount: selected.count, totalResultCount } };
    }
    const discoveredPairs = [];
    for (const entry of selected.rows) {
      const rowText = norm(entry.text);
      const pairs = [...rowText.matchAll(/(^|[^0-9])(\\d{4,})-(\\d{4,})(?=[^0-9]|$)/g)];
      for (const match of pairs) discoveredPairs.push({ goodsKey: match[2], optionId: match[3], rowText: rowText.slice(0, 500) });
    }
    const discoveredGoodsKeys = [...new Set(discoveredPairs.map((pair) => pair.goodsKey))].sort((a, b) => Number(a) - Number(b));
    if (!discoveredGoodsKeys.length) {
      return { ok: false, code: "A6_BCODE_GOODSKEY_NOT_FOUND", message: \`${'${job.barcode}'} A6 정확 검색행에서 상품코드-옵션코드를 읽지 못해 A21 전송을 차단했습니다.\`, evidence: { selectedCount: selected.count, totalResultCount } };
    }
    const targetLabel = desiredKorean(job.desiredStatus);`;
  source = once(source, oldA6Selection, newA6Selection);

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
  const newA6Status = `    const statusSelects = selectWithOption("옵션상태").filter((select) => {
      const labels = [...select.options].map((option) => norm(option.textContent));
      return labels.includes("옵션상태") && labels.includes("판매중") && labels.includes("품절");
    });
    const button = buttonByText(/^(?:일괄\\s*상태변경|상태\\s*일괄변경)$/i);
    if (!button) return { ok: false, code: "A6_BULK_STATUS_BUTTON_NOT_FOUND", message: "A6 상태 일괄변경 버튼을 찾지 못했습니다." };
    if (!statusSelects.length) return { ok: false, code: "A6_OPTION_STATUS_FIELD_NOT_FOUND", message: "A6 옵션상태 변경 드롭다운(판매중/품절)을 찾지 못했습니다." };
    const buttonRect = button.getBoundingClientRect();
    statusSelects.sort((left, right) => {
      const lr = left.getBoundingClientRect(); const rr = right.getBoundingClientRect();
      return (Math.abs(lr.top - buttonRect.top) + Math.abs(lr.right - buttonRect.left) / 4) - (Math.abs(rr.top - buttonRect.top) + Math.abs(rr.right - buttonRect.left) / 4);
    });
    const statusSelect = statusSelects[0];
    if (!selectByText(statusSelect, targetLabel, true)) return { ok: false, code: "A6_TARGET_STATUS_NOT_FOUND", message: \`A6 옵션상태 드롭다운에서 \${targetLabel}을 선택하지 못했습니다.\` };
    const selectedStatus = norm(statusSelect.options?.[statusSelect.selectedIndex]?.textContent);
    if (selectedStatus !== targetLabel) return { ok: false, code: "A6_TARGET_STATUS_VERIFY_FAILED", message: \`A6 옵션상태가 \${targetLabel}로 유지되지 않아 일괄 변경을 차단했습니다.\`, evidence: { selectedStatus, targetLabel } };`;
  source = once(source, oldA6Status, newA6Status);
  source = once(
    source,
    'evidence: { selectedRows: selected.count, targetLabel, alerts: click.alerts }',
    'evidence: { selectedRows: selected.count, totalResultCount, targetLabel, alerts: click.alerts, discoveredGoodsKeys, discoveredPairs, goodsKeyCount: discoveredGoodsKeys.length, goodsKeySource: "A6_LIVE_OPTION_BARCODE" }',
  );

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
