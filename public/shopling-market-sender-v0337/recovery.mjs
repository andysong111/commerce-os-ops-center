(function () {
  "use strict";
  const constants = Object.freeze({
    version: "0.3.37",
    queue: "commerceOsShoplingMarketSelectionQueueV0337",
    intent: "commerceOsShoplingMarketSelectionIntentV0337",
    workerPrefix: "commerceOsShoplingParallelWorkerV0337:",
    meta: "commerceOsShoplingParallelWorkerMetaV0337",
    diagnostic: "commerceOsShoplingDiagnosticV0337",
    stop: "commerceOsShoplingStopV0337",
    startMessage: "commerce-os-shopling-diagnostic-start-v0337",
    stopMessage: "commerce-os-shopling-stop-v0337"
  });
  const norm = (value) => String(value == null ? "" : value).normalize("NFKC").replace(/\s+/g, " ").trim();
  const compact = (value) => norm(value).replace(/[\s\[\]]/g, "");
  const isDiagnostic = (runId) => /^canary-group-v030-diagnostic-/.test(String(runId || ""));
  function shown(element) {
    if (!element || !element.getBoundingClientRect) return false;
    const style = element.ownerDocument.defaultView.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  }
  function inspectBasics(doc) {
    const cells = [...doc.querySelectorAll("td, th")];
    const accountCell = cells.find((cell) => shown(cell) && /^선택된쇼핑몰\/?ID$/i.test(compact(cell.textContent)));
    const accountRow = accountCell && accountCell.closest("tr");
    const accountInputs = accountRow ? [...accountRow.querySelectorAll('input[type="radio"],input[type="checkbox"]')].filter(shown) : [];
    const checkedAccounts = accountInputs.filter((input) => input.checked);
    const header = cells.find((cell) => shown(cell) && /^필수쇼핑몰기본정보$/.test(compact(cell.textContent)));
    const missing = [];
    if (!accountInputs.length || checkedAccounts.length !== accountInputs.length) missing.push("선택된 쇼핑몰/ID 전체 확인 실패");
    if (!header) missing.push("필수 쇼핑몰기본정보 열 식별 실패");
    const grouped = new Map();
    if (header) {
      const bounds = header.getBoundingClientRect();
      for (const input of doc.querySelectorAll('input[type="radio"]')) {
        if (!shown(input)) continue;
        const rect = input.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        if (rect.top < bounds.bottom || x < bounds.left || x > bounds.right) continue;
        const name = norm(input.name);
        if (!name) { missing.push("기본정보 radio group 이름 없음"); continue; }
        const key = String([...doc.forms].indexOf(input.form)) + ":" + name;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(input);
      }
    }
    const groups = [...grouped].map(([key, controls]) => {
      const checked = controls.filter((input) => input.checked);
      const selected = checked.length === 1 ? checked[0] : null;
      return { key, choices: controls.length, checkedCount: checked.length,
        selectedValue: selected ? norm(selected.value) : "",
        selectedLabel: selected ? norm(selected.closest("tr")?.textContent).slice(0, 160) : "" };
    });
    if (!groups.length || groups.length !== checkedAccounts.length) missing.push("쇼핑몰 ID 수와 기본정보 선택그룹 수 불일치");
    for (const group of groups) if (group.checkedCount !== 1 || !group.selectedValue) missing.push(group.key + " 기본정보 미선택/중복");
    return { ok: missing.length === 0, accountCount: checkedAccounts.length, groupCount: groups.length, groups, missing };
  }
  function diagnosticTasks(item) {
    const profiles = { wholesale1: ["DM1", "도매1"], wholesale2: ["DM2", "도매2"], wholesale3: ["DM3", "도매3"], wholesale4: ["DM4", "도매4"], retail1: ["SM1", "소매1"], retail2: ["SM2", "소매2"] };
    if (!item || !item.isLatestBatch || item.uploadSuccessCount !== 6 || !item.launchItemId) throw new Error("검사 가능한 최신 6채널 업로드가 아닙니다.");
    const tasks = (item.channels || []).map((row) => {
      const mapping = profiles[row.channelKey];
      if (!mapping || !/^\d{5,9}$/.test(row.goodsKey) || !String(row.ptnGoodsCd || "").startsWith(mapping[0] + "_")) throw new Error("검사 상품 식별 불일치");
      return { goodsKey: row.goodsKey, ptnGoodsCd: row.ptnGoodsCd, launchItemId: item.launchItemId,
        modelNumber: item.modelNumber, productGroupKey: row.channelKey, searchCode: mapping[0], profile: mapping[1], registeredAt: item.completedAt };
    });
    if (tasks.length !== 6 || new Set(tasks.map((t) => t.goodsKey)).size !== 6 || new Set(tasks.map((t) => t.searchCode)).size !== 6) throw new Error("검사 대상은 정확히 한 상품의 6채널이어야 합니다.");
    return tasks;
  }
  globalThis.ShoplingRecoveryV0337 = Object.freeze({ constants, norm, isDiagnostic, inspectBasics, diagnosticTasks });
})();
