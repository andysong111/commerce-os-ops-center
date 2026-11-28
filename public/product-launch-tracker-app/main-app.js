import {
  applyStageStatus,
  assignMissingSelfCodes,
  buildShoplingPreview,
  createLaunchItem,
  DEFAULT_POLICY,
  generateUniqueSelfCode,
  getNextStage,
  getOverallStatus,
  getProgress,
  getShoplingReadiness,
  hydrateLaunchItem,
  normalizeBarcode,
  normalizeModelNumber,
  normalizeOrderOptions,
  normalizePolicy,
  parsePastedRows,
  SHOPLING_CHANNELS,
  sortLaunchItems,
  STATUS_OPTIONS,
  STAGES,
  toCsv,
} from "./lib/tracker-core.mjs";

const STORAGE_KEY = "commerce-os-product-launch-tracker:v2";
const LEGACY_STORAGE_KEY = "commerce-os-product-launch-tracker:v1";
const state = {
  meta: null,
  seedItems: [],
  items: [],
  policy: normalizePolicy(DEFAULT_POLICY),
  selectedIds: new Set(),
  visibleItems: [],
  detailDraftOptions: [],
  sort: { key: null, direction: "desc" },
  filters: {
    search: "",
    batch: "",
    assignee: "",
    overall: "",
    unfinishedOnly: true,
  },
};

const elements = {
  summary: document.querySelector("#summary"),
  sourceMeta: document.querySelector("#source-meta"),
  saveStatus: document.querySelector("#save-status"),
  search: document.querySelector("#search-input"),
  batch: document.querySelector("#batch-filter"),
  assignee: document.querySelector("#assignee-filter"),
  overall: document.querySelector("#overall-filter"),
  unfinishedOnly: document.querySelector("#unfinished-only-filter"),
  visibleCount: document.querySelector("#visible-count"),
  selectedCount: document.querySelector("#selected-count"),
  bulkStage: document.querySelector("#bulk-stage"),
  bulkStatus: document.querySelector("#bulk-status"),
  tableBody: document.querySelector("#launch-table-body"),
  tableHead: document.querySelector("#launch-table-head"),
  emptyState: document.querySelector("#empty-state"),
  selectVisible: document.querySelector("#select-visible"),
  detailDialog: document.querySelector("#detail-dialog"),
  detailForm: document.querySelector("#detail-form"),
  detailTitle: document.querySelector("#detail-dialog-title"),
  detailStages: document.querySelector("#detail-stages"),
  detailSource: document.querySelector("#detail-source"),
  detailOptions: document.querySelector("#detail-options"),
  chinaSyncStatus: document.querySelector("#china-sync-status"),
  archiveButton: document.querySelector("#archive-button"),
  policyDialog: document.querySelector("#policy-dialog"),
  policyForm: document.querySelector("#policy-form"),
  previewDialog: document.querySelector("#preview-dialog"),
  previewTitle: document.querySelector("#preview-title"),
  previewContent: document.querySelector("#preview-content"),
  addDialog: document.querySelector("#add-dialog"),
  addForm: document.querySelector("#add-form"),
  pastePreview: document.querySelector("#paste-preview"),
  exportDialog: document.querySelector("#export-dialog"),
  backupInput: document.querySelector("#backup-file-input"),
  toast: document.querySelector("#toast"),
};

await bootstrap();

window.addEventListener("product-launch-tracker:external-state", () => {
  const stored = safeJsonParse(localStorage.getItem(STORAGE_KEY));
  if (!stored?.items || !Array.isArray(stored.items)) return;
  state.items = stored.items.map(hydrateLaunchItem);
  state.policy = normalizePolicy(stored.policy ?? state.policy);
  const validIds = new Set(state.items.map((item) => item.id));
  state.selectedIds = new Set(
    [...state.selectedIds].filter((id) => validIds.has(id)),
  );
  render();
});

async function bootstrap() {
  try {
    const response = await fetch("./data/launch-items.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`초기 데이터 응답 오류: ${response.status}`);
    const seed = await response.json();
    state.meta = seed.meta;
    state.seedItems = seed.items.map(hydrateLaunchItem);
    const stored = loadStoredState(seed);
    state.items = stored.items;
    state.policy = stored.policy;
    const assigned = assignMissingSelfCodes(state.items);
    state.items = assigned.items;
    bindControls();
    fillStaticOptions();
    render();
    if (assigned.changed || stored.migrated) persist();
    elements.saveStatus.textContent = "이 브라우저에 자동 저장";
  } catch (error) {
    console.error(error);
    elements.saveStatus.textContent = "데이터 불러오기 실패";
    elements.tableBody.innerHTML = `
      <tr><td colspan="16" class="empty-state">초기 데이터를 불러오지 못했습니다. 페이지를 새로고침해 주세요.</td></tr>
    `;
  }
}

function loadStoredState(seed) {
  const current = safeJsonParse(localStorage.getItem(STORAGE_KEY));
  const legacy = safeJsonParse(localStorage.getItem(LEGACY_STORAGE_KEY));
  const stored = current?.items ? current : legacy;
  if (!stored?.items || !Array.isArray(stored.items)) {
    return {
      items: structuredClone(seed.items).map(hydrateLaunchItem),
      policy: normalizePolicy(DEFAULT_POLICY),
      migrated: false,
    };
  }

  const storedById = new Map(stored.items.map((item) => [item.id, hydrateLaunchItem(item)]));
  const merged = seed.items.map((item) => hydrateLaunchItem(storedById.get(item.id) ?? item));
  const seedIds = new Set(seed.items.map((item) => item.id));
  for (const item of stored.items) {
    if (!seedIds.has(item.id)) merged.push(hydrateLaunchItem(item));
  }
  return {
    items: merged,
    policy: normalizePolicy(stored.policy ?? DEFAULT_POLICY),
    migrated: !current && Boolean(legacy),
  };
}

function bindControls() {
  elements.search.addEventListener("input", (event) => {
    state.filters.search = event.target.value;
    renderTable();
  });
  elements.batch.addEventListener("change", (event) => {
    state.filters.batch = event.target.value;
    renderTable();
  });
  elements.assignee.addEventListener("change", (event) => {
    state.filters.assignee = event.target.value;
    renderTable();
  });
  elements.overall.addEventListener("change", (event) => {
    state.filters.overall = event.target.value;
    if (["완료", "보관됨"].includes(event.target.value)) {
      state.filters.unfinishedOnly = false;
      elements.unfinishedOnly.checked = false;
    }
    renderTable();
  });
  elements.unfinishedOnly.addEventListener("change", (event) => {
    state.filters.unfinishedOnly = event.target.checked;
    if (event.target.checked && ["완료", "보관됨"].includes(state.filters.overall)) {
      state.filters.overall = "";
      elements.overall.value = "";
    }
    renderTable();
  });
  document.querySelector("#add-items-button").addEventListener("click", openAddDialog);
  document.querySelector("#policy-button").addEventListener("click", openPolicyDialog);
  document.querySelector("#export-menu-button").addEventListener("click", () => elements.exportDialog.showModal());
  document.querySelector("#bulk-apply-button").addEventListener("click", applyBulkStatus);
  document.querySelector("#clear-selection-button").addEventListener("click", clearSelection);
  elements.selectVisible.addEventListener("change", toggleVisibleSelection);
  elements.tableHead.addEventListener("click", handleSortClick);
  elements.tableBody.addEventListener("change", handleTableChange);
  elements.tableBody.addEventListener("keydown", handleTableKeydown);
  elements.tableBody.addEventListener("click", handleTableClick);
  elements.detailForm.addEventListener("submit", saveDetailForm);
  elements.archiveButton.addEventListener("click", archiveCurrentItem);
  document.querySelector("#add-option-button").addEventListener("click", () => addOptionDraft());
  document.querySelector("#china-sync-button").addEventListener("click", syncChinaOrderOptions);
  document.querySelector("#preview-button").addEventListener("click", previewCurrentDetail);
  document.querySelector("#regenerate-code-button").addEventListener("click", regenerateCurrentCode);
  elements.detailOptions.addEventListener("input", updateOptionDraftFromTable);
  elements.detailOptions.addEventListener("click", handleOptionTableClick);
  elements.policyForm.addEventListener("submit", savePolicyForm);
  document.querySelector("#reset-policy-button").addEventListener("click", resetPolicyForm);
  elements.addForm.addEventListener("submit", savePastedItems);
  elements.addForm.elements.paste.addEventListener("input", updatePastePreview);
  document.querySelector("#export-json-button").addEventListener("click", exportJson);
  document.querySelector("#export-csv-button").addEventListener("click", exportCsv);
  document.querySelector("#import-json-button").addEventListener("click", () => elements.backupInput.click());
  elements.backupInput.addEventListener("change", importBackup);
  document.querySelector("#reset-seed-button").addEventListener("click", resetToSeed);
}

function fillStaticOptions() {
  elements.bulkStage.innerHTML = STAGES.map(
    ({ key, label }) => `<option value="${key}">${label}</option>`,
  ).join("");
  elements.bulkStatus.innerHTML = STATUS_OPTIONS.map(
    (status) => `<option value="${status}">${status}</option>`,
  ).join("");
  refreshFilterOptions();
}

function refreshFilterOptions() {
  const currentBatch = elements.batch.value;
  const currentAssignee = elements.assignee.value;
  const batches = unique(state.items.map((item) => item.workBatch).filter(Boolean)).sort(localeSort);
  const assignees = unique(
    state.items.flatMap((item) => STAGES.map(({ key }) => item.stages[key]?.assignee).filter(Boolean)),
  ).sort(localeSort);
  elements.batch.innerHTML = optionList("전체 작업 묶음", batches);
  elements.assignee.innerHTML = optionList("전체 담당자", assignees);
  elements.batch.value = batches.includes(currentBatch) ? currentBatch : "";
  elements.assignee.value = assignees.includes(currentAssignee) ? currentAssignee : "";
}

function optionList(allLabel, values) {
  return [
    `<option value="">${allLabel}</option>`,
    ...values.map((value) => `<option value="${escapeAttribute(value)}">${escapeHtml(value)}</option>`),
  ].join("");
}

function render() {
  refreshFilterOptions();
  renderSummary();
  renderTable();
  elements.sourceMeta.textContent = `${state.meta.sourceFile} · 상품 ${number(state.meta.launchItemCount)}건 이관`;
}

function renderSummary() {
  const activeItems = state.items.filter((item) => !item.archivedAt);
  const counts = {
    전체: activeItems.length,
    "등록 준비": activeItems.filter((item) => getShoplingReadiness(item).ready).length,
    "진행 중": activeItems.filter((item) => getOverallStatus(item) === "진행 중").length,
    보류: activeItems.filter((item) => getOverallStatus(item) === "보류").length,
    완료: activeItems.filter((item) => getOverallStatus(item) === "완료").length,
  };
  const tones = ["", "emerald", "blue", "amber", "emerald"];
  elements.summary.innerHTML = Object.entries(counts)
    .map(
      ([label, value], index) => `
        <article class="summary-card" data-tone="${tones[index]}">
          <span>${label}</span><strong>${number(value)}</strong>
        </article>`,
    )
    .join("");
}

function renderTable() {
  const search = state.filters.search.trim().toLocaleLowerCase("ko-KR");
  state.visibleItems = sortLaunchItems(
    state.items.filter((item) => {
      const overall = getOverallStatus(item);
      if (state.filters.unfinishedOnly && ["완료", "보관됨"].includes(overall)) return false;
      if (state.filters.batch && item.workBatch !== state.filters.batch) return false;
      if (
        state.filters.assignee &&
        !STAGES.some(({ key }) => item.stages[key]?.assignee === state.filters.assignee)
      ) return false;
      if (state.filters.overall && overall !== state.filters.overall) return false;
      if (search && !searchableText(item).includes(search)) return false;
      return true;
    }),
    state.sort,
  );

  elements.tableBody.innerHTML = state.visibleItems.map(renderRow).join("");
  updateSortHeaders();
  elements.visibleCount.textContent = `${number(state.visibleItems.length)}건`;
  elements.selectedCount.textContent = `선택 ${number(state.selectedIds.size)}건`;
  elements.emptyState.hidden = state.visibleItems.length > 0;
  const visibleIds = state.visibleItems.map((item) => item.id);
  elements.selectVisible.checked = visibleIds.length > 0 && visibleIds.every((id) => state.selectedIds.has(id));
  elements.selectVisible.indeterminate =
    !elements.selectVisible.checked && visibleIds.some((id) => state.selectedIds.has(id));
}

function renderRow(item) {
  const selected = state.selectedIds.has(item.id);
  const progress = getProgress(item);
  const readiness = getShoplingReadiness(item);
  const optionLabels = item.orderOptions.map((option) => option.saleOption).filter(Boolean);
  return `
    <tr data-id="${escapeAttribute(item.id)}" class="${selected ? "is-selected" : ""} ${item.archivedAt ? "is-archived" : ""}">
      <td class="check-column"><input class="row-check" type="checkbox" ${selected ? "checked" : ""} aria-label="${escapeAttribute(item.modelNumber)} 선택" /></td>
      <td class="cell-truncate" title="${escapeAttribute(item.workBatch)}">${escapeHtml(item.workBatch)}</td>
      <td><input class="barcode-input" value="${escapeAttribute(item.barcode)}" placeholder="BAA1-1" autocomplete="off" aria-label="${escapeAttribute(item.modelNumber)} 기준 바코드" /></td>
      <td><span class="model-number">${escapeHtml(item.modelNumber)}</span>${item.migrationReview ? '<span class="review-dot" title="이관 검토 표시"></span>' : ""}</td>
      <td class="product-name cell-truncate" title="${escapeAttribute(item.productName)}">${escapeHtml(item.productName)}</td>
      <td class="category-cell cell-truncate" title="${escapeAttribute(item.shoplingCategory)}">${item.shoplingCategory ? escapeHtml(item.shoplingCategory) : muted("정확한 카테고리 필요")}</td>
      <td class="options-cell cell-truncate" title="${escapeAttribute(optionLabels.join(", "))}">${optionLabels.length ? `${escapeHtml(optionLabels.join(", "))}<span class="count-chip">${optionLabels.length}</span>` : muted("연동 필요")}</td>
      <td>${muted("재고 확인 대기")}</td>
      <td><button class="readiness-badge ${readiness.ready ? "is-ready" : "needs-work"}" type="button" data-action="preview" title="${escapeAttribute([...readiness.errors, ...readiness.warnings].join("\n"))}">${readiness.ready ? "준비완료" : `준비필요 ${readiness.errors.length}`}</button></td>
      ${STAGES.map(({ key }) => statusSelect(item, key)).join("")}
      <td class="next-stage">${escapeHtml(getNextStage(item))}<span class="progress-text">${progress.completed}/${progress.total} 완료</span></td>
      <td class="row-actions"><button class="row-action" type="button" data-action="detail">${item.archivedAt ? "복구·수정" : "상세"}</button></td>
    </tr>`;
}

function statusSelect(item, key) {
  const status = item.stages[key]?.status ?? "미시작";
  return `
    <td><select class="status-select status-${status.replaceAll(" ", "-")}" data-stage="${key}" aria-label="${escapeAttribute(item.modelNumber)} ${key} 상태">
      ${STATUS_OPTIONS.map((option) => `<option value="${option}" ${option === status ? "selected" : ""}>${option}</option>`).join("")}
    </select></td>`;
}

function handleSortClick(event) {
  const button = event.target.closest("button[data-sort-key]");
  if (!button) return;
  const key = button.dataset.sortKey;
  state.sort = {
    key,
    direction: state.sort.key === key && state.sort.direction === "asc" ? "desc" : "asc",
  };
  renderTable();
}

function updateSortHeaders() {
  for (const header of elements.tableHead.querySelectorAll("th[data-sort-key]")) {
    const button = header.querySelector("button[data-sort-key]");
    const indicator = button.querySelector(".sort-indicator");
    const active = header.dataset.sortKey === state.sort.key;
    const direction = active ? state.sort.direction : null;
    const nextDirection = direction === "asc" ? "내림차순" : "오름차순";
    header.setAttribute("aria-sort", direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none");
    indicator.textContent = direction === "asc" ? "▲" : direction === "desc" ? "▼" : "↕";
    button.title = `${nextDirection} 정렬`;
  }
}

function handleTableChange(event) {
  const row = event.target.closest("tr[data-id]");
  if (!row) return;
  const id = row.dataset.id;
  if (event.target.matches(".row-check")) {
    if (event.target.checked) state.selectedIds.add(id);
    else state.selectedIds.delete(id);
    renderTable();
    return;
  }
  if (event.target.matches(".barcode-input")) {
    const item = findItem(id);
    if (!item) return;
    const barcode = normalizeBarcode(event.target.value);
    if (barcode === item.barcode) {
      event.target.value = barcode;
      return;
    }
    replaceItem({ ...item, barcode, updatedAt: new Date().toISOString(), updatedBy: "승준" });
    showToast(`${item.modelNumber} 기준 바코드를 저장했습니다.`);
    return;
  }
  if (event.target.matches(".status-select")) {
    const item = findItem(id);
    if (!item) return;
    const status = event.target.value;
    const stageKey = event.target.dataset.stage;
    let reason = "";
    if (status === "보류") {
      reason = window.prompt("보류 사유를 입력해 주세요.", item.notes ?? "")?.trim() ?? "";
      if (!reason) {
        renderTable();
        showToast("보류 사유가 없어 변경하지 않았습니다.");
        return;
      }
    }
    const changed = applyStageStatus(item, stageKey, status);
    if (reason) {
      changed.stages[stageKey].note = reason;
      changed.notes = appendNote(changed.notes, reason);
    }
    replaceItem(changed);
  }
}

function handleTableKeydown(event) {
  if (event.key === "Enter" && event.target.matches(".barcode-input")) {
    event.preventDefault();
    event.target.blur();
  }
}

function handleTableClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const row = button.closest("tr[data-id]");
  if (!row) return;
  if (button.dataset.action === "detail") openDetail(row.dataset.id);
  if (button.dataset.action === "preview") openPreview(row.dataset.id);
}

function toggleVisibleSelection(event) {
  for (const item of state.visibleItems) {
    if (event.target.checked) state.selectedIds.add(item.id);
    else state.selectedIds.delete(item.id);
  }
  renderTable();
}

function clearSelection() {
  state.selectedIds.clear();
  renderTable();
}

function applyBulkStatus() {
  if (!state.selectedIds.size) {
    showToast("일괄 변경할 상품을 먼저 선택해 주세요.");
    return;
  }
  const stageKey = elements.bulkStage.value;
  const status = elements.bulkStatus.value;
  let reason = "";
  if (status === "보류") {
    reason = window.prompt("선택 항목에 공통으로 기록할 보류 사유를 입력해 주세요.")?.trim() ?? "";
    if (!reason) return;
  }
  state.items = state.items.map((item) => {
    if (!state.selectedIds.has(item.id)) return item;
    const changed = applyStageStatus(item, stageKey, status);
    if (reason) {
      changed.stages[stageKey].note = reason;
      changed.notes = appendNote(changed.notes, reason);
    }
    return changed;
  });
  persist();
  render();
  showToast(`${number(state.selectedIds.size)}건의 상태를 ${status}(으)로 변경했습니다.`);
}

function openDetail(id) {
  const item = findItem(id);
  if (!item) return;
  const form = elements.detailForm;
  for (const name of [
    "id",
    "workBatch",
    "warehouseLocation",
    "barcode",
    "modelNumber",
    "productName",
    "shoplingCategory",
    "selfCodeBase",
    "notes",
  ]) form.elements[name].value = item[name] ?? "";
  form.elements.detailHtml.value = item.detailPageAsset.html ?? "";
  form.elements.mainImageUrl.value = item.detailPageAsset.mainImageUrl ?? "";
  form.elements.additionalImageUrls.value = item.detailPageAsset.additionalImageUrls.join("\n");
  state.detailDraftOptions = structuredClone(item.orderOptions);
  renderOptionEditor();
  updateChinaSyncStatus(item);
  elements.detailTitle.textContent = `${item.modelNumber} · ${item.productName}`;
  elements.detailStages.innerHTML = STAGES.map(
    ({ key, label }) => `
      <section class="stage-card"><h3>${label}</h3>
        <label class="field"><span>상태</span><select name="stage.${key}.status">${STATUS_OPTIONS.map((status) => `<option value="${status}" ${item.stages[key].status === status ? "selected" : ""}>${status}</option>`).join("")}</select></label>
        <label class="field"><span>담당자</span><input name="stage.${key}.assignee" value="${escapeAttribute(item.stages[key].assignee)}" placeholder="예: 경주님" /></label>
      </section>`,
  ).join("");
  elements.detailSource.innerHTML = `
    <strong>원본 이력</strong><br />
    ${escapeHtml(item.source?.file ?? state.meta.sourceFile ?? "직접 추가")} · ${escapeHtml(item.source?.sheet ?? state.meta.sourceSheet ?? "")}<br />
    원본 행: ${escapeHtml((item.source?.rows ?? []).join(", ") || "없음")}
    ${item.source?.sheetRowRefs?.length ? `<br />기존 시트 행번호: ${escapeHtml(item.source.sheetRowRefs.join(", "))}` : ""}
    ${item.migrationReview ? "<br /><strong>같은 모델번호의 복수 출시 기록이 있어 검토 표시가 붙었습니다.</strong>" : ""}`;
  elements.archiveButton.textContent = item.archivedAt ? "보관에서 복구" : "보관 처리";
  elements.detailDialog.showModal();
}

function renderOptionEditor() {
  if (!state.detailDraftOptions.length) {
    elements.detailOptions.innerHTML = `<tr><td colspan="6" class="option-empty">발주·입고 데이터가 아직 연결되지 않았습니다.</td></tr>`;
    return;
  }
  elements.detailOptions.innerHTML = state.detailDraftOptions.map((option, index) => `
    <tr data-option-index="${index}">
      <td><input data-field="optionName" value="${escapeAttribute(option.optionName)}" placeholder="옵션" /></td>
      <td><input data-field="saleOption" value="${escapeAttribute(option.saleOption)}" placeholder="블랙" /></td>
      <td><input data-field="barcode" value="${escapeAttribute(option.barcode)}" placeholder="BAA1-1" /></td>
      <td><input data-field="baseSalePriceKrw" type="number" min="0" step="1" value="${option.baseSalePriceKrw || ""}" placeholder="10000" /></td>
      <td><input data-field="unitCostKrw" type="number" min="0" step="1" value="${option.unitCostKrw || ""}" placeholder="5000" /></td>
      <td><button class="option-remove" type="button" data-action="remove-option" aria-label="옵션 삭제">×</button></td>
    </tr>`).join("");
}

function addOptionDraft() {
  updateOptionDraftFromTable();
  state.detailDraftOptions.push({
    id: crypto.randomUUID(),
    optionName: "옵션",
    saleOption: "",
    chinaOption: "",
    barcode: "",
    baseSalePriceKrw: 0,
    unitCostKrw: 0,
    sourceOrderItemId: null,
  });
  renderOptionEditor();
}

function handleOptionTableClick(event) {
  const button = event.target.closest("button[data-action='remove-option']");
  if (!button) return;
  updateOptionDraftFromTable();
  const index = Number(button.closest("tr[data-option-index]")?.dataset.optionIndex);
  if (!Number.isInteger(index)) return;
  state.detailDraftOptions.splice(index, 1);
  renderOptionEditor();
}

function updateOptionDraftFromTable() {
  const rows = [...elements.detailOptions.querySelectorAll("tr[data-option-index]")];
  if (!rows.length) return;
  state.detailDraftOptions = rows.map((row, index) => {
    const previous = state.detailDraftOptions[index] ?? {};
    const get = (field) => row.querySelector(`[data-field='${field}']`)?.value ?? "";
    return {
      ...previous,
      id: previous.id ?? crypto.randomUUID(),
      optionName: get("optionName").trim() || "옵션",
      saleOption: get("saleOption").trim(),
      barcode: normalizeBarcode(get("barcode")),
      baseSalePriceKrw: Math.max(0, Math.ceil(Number(get("baseSalePriceKrw")) || 0)),
      unitCostKrw: Math.max(0, Math.ceil(Number(get("unitCostKrw")) || 0)),
    };
  });
}

async function syncChinaOrderOptions() {
  const form = elements.detailForm;
  const barcode = normalizeBarcode(form.elements.barcode.value);
  const modelNumber = normalizeModelNumber(form.elements.modelNumber.value);
  if (!barcode && !modelNumber) {
    showToast("기준 바코드 또는 모델번호가 필요합니다.");
    return;
  }
  elements.chinaSyncStatus.textContent = "불러오는 중";
  try {
    const params = new URLSearchParams({ barcode, modelNumber });
    const response = await fetch(`/api/product-launch-tracker/china-order-options?${params.toString()}`, {
      cache: "no-store",
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.ok) throw new Error(body.message || `응답 오류 ${response.status}`);
    state.detailDraftOptions = normalizeOrderOptions(body.options);
    renderOptionEditor();
    elements.chinaSyncStatus.textContent = `${state.detailDraftOptions.length}개 연결`;
    elements.chinaSyncStatus.dataset.batchId = body.batchId ?? "";
    showToast(`발주·입고 옵션 ${state.detailDraftOptions.length}개를 불러왔습니다.`);
  } catch (error) {
    console.error(error);
    elements.chinaSyncStatus.textContent = "연결 필요";
    showToast(error instanceof Error ? error.message : "발주·입고 데이터를 불러오지 못했습니다.");
  }
}

function updateChinaSyncStatus(item) {
  const count = item.orderOptions.length;
  elements.chinaSyncStatus.textContent = count
    ? `${count}개 · ${item.chinaOrderLink.syncedAt ? formatDateTime(item.chinaOrderLink.syncedAt) : "저장 데이터"}`
    : "연결 필요";
  elements.chinaSyncStatus.dataset.batchId = item.chinaOrderLink.batchId ?? "";
}

function collectDetailDraft() {
  updateOptionDraftFromTable();
  const formData = new FormData(elements.detailForm);
  const id = String(formData.get("id") ?? "");
  const item = findItem(id);
  if (!item) return null;
  let changed = hydrateLaunchItem({
    ...item,
    workBatch: String(formData.get("workBatch") ?? "").trim(),
    warehouseLocation: String(formData.get("warehouseLocation") ?? "").trim(),
    barcode: normalizeBarcode(formData.get("barcode")),
    modelNumber: normalizeModelNumber(formData.get("modelNumber")),
    productName: String(formData.get("productName") ?? "").trim(),
    shoplingCategory: String(formData.get("shoplingCategory") ?? "").trim(),
    selfCodeBase: String(formData.get("selfCodeBase") ?? "").trim(),
    orderOptions: state.detailDraftOptions,
    notes: String(formData.get("notes") ?? "").trim(),
    chinaOrderLink: {
      status: state.detailDraftOptions.length ? "linked" : "not_linked",
      batchId: elements.chinaSyncStatus.dataset.batchId || item.chinaOrderLink.batchId,
      syncedAt: state.detailDraftOptions.length ? new Date().toISOString() : item.chinaOrderLink.syncedAt,
      message: "",
    },
    detailPageAsset: {
      ...item.detailPageAsset,
      status:
        String(formData.get("detailHtml") ?? "").trim() &&
        String(formData.get("mainImageUrl") ?? "").trim()
          ? "ready"
          : "not_linked",
      html: String(formData.get("detailHtml") ?? "").trim(),
      mainImageUrl: String(formData.get("mainImageUrl") ?? "").trim(),
      additionalImageUrls: splitLines(formData.get("additionalImageUrls")).slice(0, 10),
      syncedAt: new Date().toISOString(),
    },
    updatedAt: new Date().toISOString(),
    updatedBy: "승준",
  });
  for (const { key } of STAGES) {
    changed = applyStageStatus(changed, key, String(formData.get(`stage.${key}.status`) ?? "미시작"));
    changed.stages[key].assignee = String(formData.get(`stage.${key}.assignee`) ?? "").trim();
  }
  return changed;
}

function saveDetailForm(event) {
  event.preventDefault();
  if (event.submitter?.value !== "save") return;
  const changed = collectDetailDraft();
  if (!changed) return;
  if (
    STAGES.some(({ key }) => changed.stages[key].status === "보류") &&
    !changed.notes.trim()
  ) {
    showToast("보류 상태에는 비고·보류 사유가 필요합니다.");
    return;
  }
  replaceItem(changed);
  elements.detailDialog.close();
  showToast("상품 기록을 저장했습니다.");
}

function previewCurrentDetail() {
  const changed = collectDetailDraft();
  if (!changed) return;
  renderPreview(changed);
}

function openPreview(id) {
  const item = findItem(id);
  if (!item) return;
  renderPreview(item);
}

function renderPreview(item) {
  const preview = buildShoplingPreview(item, state.policy);
  elements.previewTitle.textContent = `${item.modelNumber} · 샵플링 등록 미리보기`;
  const issues = [
    ...preview.errors.map((message) => `<li class="error-text">${escapeHtml(message)}</li>`),
    ...preview.warnings.map((message) => `<li class="warning-text">${escapeHtml(message)}</li>`),
  ];
  elements.previewContent.innerHTML = `
    <div class="preview-summary ${preview.ready ? "ready" : "blocked"}">
      <strong>${preview.ready ? "6개 상품 등록 준비완료" : "등록 전 보완 필요"}</strong>
      <span>카테고리: ${preview.category ? escapeHtml(preview.category) : "미입력"} · 옵션 ${item.orderOptions.length}개 · 고시 코드 ${preview.goodsNotice.code}</span>
    </div>
    ${issues.length ? `<ul class="issue-list">${issues.join("")}</ul>` : ""}
    <div class="preview-table-wrap"><table class="preview-table">
      <thead><tr><th>그룹</th><th>최초 상품명</th><th>자사상품코드</th><th>판매가</th><th>소비자가</th><th>옵션 추가금</th></tr></thead>
      <tbody>${preview.channels.map((channel) => `<tr>
        <td>${channel.label}</td>
        <td>${escapeHtml(channel.productName)}</td>
        <td><code>${escapeHtml(channel.ptnGoodsCd)}</code></td>
        <td>${won(channel.salePrice)}</td>
        <td>${won(channel.listPrice)}</td>
        <td>${channel.options.map((option) => `${escapeHtml(option.saleOption)} ${won(option.additionalAmountKrw)}`).join("<br />")}</td>
      </tr>`).join("")}</tbody>
    </table></div>
    <details class="preview-details"><summary>통합정책·상세페이지 전송값 보기</summary>
      <pre>${escapeHtml(JSON.stringify({ fixedFields: preview.fixedFields, goodsNotice: preview.goodsNotice, optionPolicy: preview.optionPolicy, images: preview.images }, null, 2))}</pre>
    </details>`;
  elements.previewDialog.showModal();
}

function regenerateCurrentCode() {
  const id = elements.detailForm.elements.id.value;
  const current = findItem(id);
  const used = new Set(state.items.filter((item) => item.id !== id).map((item) => item.selfCodeBase));
  const next = generateUniqueSelfCode(used);
  elements.detailForm.elements.selfCodeBase.value = next;
  if (current?.selfCodeBase && !window.confirm("기존 자사상품코드를 새 코드로 바꿀까요? 아직 샵플링 등록 전인 상품에서만 변경하세요.")) {
    elements.detailForm.elements.selfCodeBase.value = current.selfCodeBase;
    return;
  }
  showToast("중복되지 않는 새 자사상품코드를 만들었습니다.");
}

function archiveCurrentItem() {
  const id = elements.detailForm.elements.id.value;
  const item = findItem(id);
  if (!item) return;
  const action = item.archivedAt ? "복구" : "보관";
  if (!window.confirm(`${item.modelNumber} 항목을 ${action}하시겠습니까?`)) return;
  replaceItem({
    ...item,
    archivedAt: item.archivedAt ? null : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updatedBy: "승준",
  });
  elements.detailDialog.close();
  showToast(`${item.modelNumber} 항목을 ${action}했습니다.`);
}

function openPolicyDialog() {
  const policy = normalizePolicy(state.policy);
  for (const channel of SHOPLING_CHANNELS) {
    elements.policyForm.elements[`multiplier.${channel.multiplierKey}`].value =
      policy.channelMultipliers[channel.multiplierKey];
  }
  for (const name of [
    "listPriceMultiplier",
    "makerName",
    "productWeight",
    "deliveryType",
    "deliveryCost",
    "retail1BrandName",
    "optionStatus",
    "optionQuantity",
    "optionVirtualQuantity",
    "goodsNoticeCode",
    "goodsNoticeValue",
    "shippingNoticeHtml",
  ]) elements.policyForm.elements[name].value = policy[name] ?? "";
  elements.policyDialog.showModal();
}

function savePolicyForm(event) {
  event.preventDefault();
  if (event.submitter?.value !== "save") return;
  const data = new FormData(elements.policyForm);
  state.policy = normalizePolicy({
    ...state.policy,
    version: Number(state.policy.version || 1) + 1,
    channelMultipliers: Object.fromEntries(
      SHOPLING_CHANNELS.map((channel) => [
        channel.multiplierKey,
        Number(data.get(`multiplier.${channel.multiplierKey}`)),
      ]),
    ),
    listPriceMultiplier: Number(data.get("listPriceMultiplier")),
    makerName: String(data.get("makerName") ?? "").trim(),
    productWeight: Number(data.get("productWeight")),
    deliveryType: String(data.get("deliveryType") ?? "").trim(),
    deliveryCost: Number(data.get("deliveryCost")),
    retail1BrandName: String(data.get("retail1BrandName") ?? "").trim(),
    optionStatus: String(data.get("optionStatus") ?? "").trim(),
    optionQuantity: Number(data.get("optionQuantity")),
    optionVirtualQuantity: Number(data.get("optionVirtualQuantity")),
    goodsNoticeCode: String(data.get("goodsNoticeCode") ?? "").trim(),
    goodsNoticeValue: String(data.get("goodsNoticeValue") ?? "").trim(),
    shippingNoticeHtml: String(data.get("shippingNoticeHtml") ?? "").trim(),
    updatedAt: new Date().toISOString(),
    updatedBy: "승준",
  });
  persist();
  renderSummary();
  elements.policyDialog.close();
  showToast(`통합정책 v${state.policy.version}을 저장했습니다.`);
}

function resetPolicyForm() {
  if (!window.confirm("화면의 정책값을 현재 기본정책으로 되돌릴까요? 저장 버튼을 눌러야 반영됩니다.")) return;
  state.policy = normalizePolicy(DEFAULT_POLICY);
  openPolicyDialog();
}

function openAddDialog() {
  elements.addForm.reset();
  updatePastePreview();
  elements.addDialog.showModal();
}

function updatePastePreview() {
  const parsed = parsePastedRows(elements.addForm.elements.paste.value);
  elements.pastePreview.textContent = `붙여넣은 상품 ${number(parsed.length)}건`;
}

function savePastedItems(event) {
  event.preventDefault();
  if (event.submitter?.value !== "save") return;
  const parsed = parsePastedRows(elements.addForm.elements.paste.value);
  if (!parsed.length) {
    showToast("추가할 상품이 없습니다.");
    return;
  }
  const used = new Set(state.items.map((item) => item.selfCodeBase));
  const created = parsed.map((row) => {
    const selfCodeBase = generateUniqueSelfCode(used);
    used.add(selfCodeBase);
    return createLaunchItem({ ...row, selfCodeBase, updatedBy: "승준", sourceFile: "직접 붙여넣기" });
  });
  state.items.push(...created);
  persist();
  render();
  elements.addDialog.close();
  showToast(`${number(created.length)}건을 추가했습니다.`);
}

function exportJson() {
  download(
    `신규상품출시진행관리_백업_${dateStamp()}.json`,
    JSON.stringify(
      {
        schemaVersion: 3,
        exportedAt: new Date().toISOString(),
        sourceMeta: state.meta,
        policy: state.policy,
        items: state.items,
      },
      null,
      2,
    ),
    "application/json;charset=utf-8",
  );
  showToast("상품·옵션·통합정책 백업을 내려받았습니다.");
}

function exportCsv() {
  download(
    `신규상품출시진행관리_${dateStamp()}.csv`,
    `\uFEFF${toCsv(state.visibleItems)}`,
    "text/csv;charset=utf-8",
  );
  showToast("현재 목록 CSV를 내려받았습니다.");
}

async function importBackup(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try {
    const backup = JSON.parse(await file.text());
    const items = Array.isArray(backup) ? backup : backup.items;
    if (!Array.isArray(items) || !items.length) throw new Error("items가 없습니다.");
    if (!window.confirm(`백업 상품 ${number(items.length)}건으로 현재 기록을 교체할까요?`)) return;
    state.items = items.map(hydrateLaunchItem);
    state.policy = normalizePolicy(backup.policy ?? state.policy);
    const assigned = assignMissingSelfCodes(state.items);
    state.items = assigned.items;
    state.selectedIds.clear();
    persist();
    render();
    elements.exportDialog.close();
    showToast("백업 파일을 복원했습니다.");
  } catch (error) {
    console.error(error);
    showToast("올바른 백업 파일이 아닙니다.");
  }
}

function resetToSeed() {
  if (!window.confirm("현재 수정 내용이 모두 사라집니다. 업로드된 엑셀의 최초 이관 상태로 되돌릴까요?")) return;
  const assigned = assignMissingSelfCodes(structuredClone(state.seedItems));
  state.items = assigned.items;
  state.policy = normalizePolicy(DEFAULT_POLICY);
  state.selectedIds.clear();
  persist();
  render();
  elements.exportDialog.close();
  showToast("최초 이관 데이터와 기본정책으로 되돌렸습니다.");
}

function findItem(id) {
  return state.items.find((candidate) => candidate.id === id);
}

function replaceItem(changed) {
  state.items = state.items.map((item) => (item.id === changed.id ? hydrateLaunchItem(changed) : item));
  persist();
  render();
}

function persist() {
  elements.saveStatus.textContent = "저장 중";
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      schemaVersion: 3,
      sourceImportedAt: state.meta.importedAt,
      savedAt: new Date().toISOString(),
      policy: state.policy,
      items: state.items,
    }),
  );
  window.setTimeout(() => {
    elements.saveStatus.textContent = "방금 저장됨";
  }, 80);
}

function searchableText(item) {
  return [
    item.workBatch,
    item.warehouseLocation,
    item.barcode,
    item.modelNumber,
    item.productName,
    item.shoplingCategory,
    item.selfCodeBase,
    item.orderOptions.map((option) => `${option.saleOption} ${option.barcode}`).join(" "),
    item.notes,
    ...Object.values(item.shoplingProducts).map((product) => product.goodsKey),
    ...STAGES.flatMap(({ key }) => [item.stages[key]?.status, item.stages[key]?.assignee]),
  ].join(" ").toLocaleLowerCase("ko-KR");
}

function appendNote(current, next) {
  if (!current) return next;
  if (current.includes(next)) return current;
  return `${current} · ${next}`;
}

function splitLines(value) {
  return String(value ?? "")
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function muted(text) {
  return `<span class="cell-muted">${text}</span>`;
}

function unique(values) {
  return [...new Set(values)];
}

function localeSort(left, right) {
  return String(left).localeCompare(String(right), "ko-KR", { numeric: true, sensitivity: "base" });
}

function number(value) {
  return new Intl.NumberFormat("ko-KR").format(value);
}

function won(value) {
  return `${number(Math.ceil(Number(value) || 0))}원`;
}

function formatDateTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function dateStamp() {
  const date = new Date();
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("");
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function safeJsonParse(value) {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("\n", " ");
}

let toastTimer;
function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, 3200);
}
