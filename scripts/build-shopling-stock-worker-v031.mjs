import { buildStockWorkerV030 as buildLegacy } from "./build-shopling-stock-worker-v030-legacy.mjs";

export function buildStockWorkerV031(base, policy) {
  let source = buildLegacy(base, policy);
  const before = `    const selected = await selectA21HeaderAllV057(exactRows, totalResultCount);\n    if (!selected.ok || selected.count !== totalResultCount) return { ok: false, code: selected.code || "A21_HEADER_SELECT_ALL_FAILED", message: \`${'${goodsKey}'} A21 전체선택 후 ${'${totalResultCount}'}건 체크 검증에 실패했습니다.\`, evidence: { selectedCount: selected.count, totalResultCount, reportedResultCount, resultCountSource, boundRowCount: exactRows.length, batchLimit: 200, searchField: search.fieldLabel, selectionMode: selected.selectionMode, masterChecked: selected.masterChecked } };`;
  const after = `    const selected = (() => {\n      let count = 0;\n      const failures = [];\n      for (const entry of exactRows) {\n        const checkbox = entry.checkbox;\n        const ok = setCheck(checkbox, true);\n        if (ok && checkbox.checked) count += 1;\n        else failures.push(norm(entry.text).slice(0, 180));\n      }\n      return { ok: count === totalResultCount, count, rows: exactRows, selectionMode: "PROVEN_PRICE_ROW_CHECKBOX_DIRECT", failures };\n    })();\n    if (!selected.ok || selected.count !== totalResultCount) return { ok: false, code: "A21_PRICE_ROW_CHECKBOX_VERIFY_FAILED", message: \`${'${goodsKey}'} A21 가격조정 확장 방식으로 ${'${totalResultCount}'}건 중 ${'${selected.count}'}건만 체크되어 전송을 차단했습니다.\`, evidence: { selectedCount: selected.count, totalResultCount, reportedResultCount, resultCountSource, boundRowCount: exactRows.length, batchLimit: 200, searchField: search.fieldLabel, selectionMode: selected.selectionMode, failures: selected.failures } };`;
  if (source.split(before).length !== 2) throw new Error("stock_hf7_price_row_selection_source_mismatch");
  source = source.replace(before, after);
  source = source.replaceAll("전체선택 ${selected.count}건", "개별행 체크 ${selected.count}건");
  if (!source.includes("PROVEN_PRICE_ROW_CHECKBOX_DIRECT") || source.includes("const selected = await selectA21HeaderAllV057(exactRows, totalResultCount);")) {
    throw new Error("stock_hf7_price_row_selection_guard_missing");
  }
  new Function(source);
  return source;
}
