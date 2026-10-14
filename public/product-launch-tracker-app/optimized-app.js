import {
  buildShoplingPreview,
  DEFAULT_POLICY,
  hydrateLaunchItem,
  normalizeBarcode,
  normalizeModelNumber,
  normalizeOrderOptions,
  normalizePolicy,
  parsePastedRows,
  SHOPLING_CHANNELS,
  STATUS_OPTIONS,
  STAGES,
} from "./lib/tracker-core.mjs";
import {
  MAX_CHINA_PRODUCT_LINKS,
  normalizeChinaProductLinks,
  normalizeChinaProductUrl,
  promoteChinaProductLink,
} from "./lib/china-product-links.mjs";

const OPTIMIZED_API = "/api/product-launch-tracker/optimized";
const STATE_API = "/api/product-launch-tracker/state";
const STORAGE_KEY = "commerce-os-product-launch-tracker:v2";
const LEGACY_STORAGE_KEY = "commerce-os-product-launch-tracker:v1";
const RECOVERY_STORAGE_KEY = "commerce-os-product-launch-tracker:full-recovery:v1";
const BATCH_SELECTION_KEY = "productLaunchFlow.trackerBatchSelection.v1";
const MAX_PRODUCT_FLOW_SELECTION = 20;
const DEFAULT_PAGE_SIZE = 25;
const SEARCH_DELAY_MS = 260;
const PAGE_REFRESH_DELAY_MS = 500;
const EDITABLE_SELECTOR = [
  ".barcode-input",
  ".inline-model-number-editor",
  ".inline-product-name-editor",
  ".inline-category-editor",
  ".inline-options-editor",
  ".inline-option-location-input",
].join(", ");

const startupLocalState = selectNewestFullLocalState([
  safeJsonParse(localStorage.getItem(STORAGE_KEY)),
  safeJsonParse(localStorage.getItem(LEGACY_STORAGE_KEY)),
]);
let startupRecoveryChecked = false;

const state = {
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  pageCount: 1,
  total: 0,
  items: [],
  itemById: new Map(),
  counts: {},
  filterOptions: { batches: [], assignees: [] },
  policy: normalizePolicy(DEFAULT_POLICY),
  selectedIds: new Set(),
  sort: { key: "", direction: "desc" },
  filters: {
    search: "",
    batch: "",
    assignee: "",
    overall: "",
    unfinishedOnly: true,
  },
  detailItem: null,
  detailDraftOptions: [],
  detailMode: "edit",
  sourceImportedAt: null,
  updatedAt: null,
  requestController: null,
  requestSerial: 0,
  refreshTimer: null,
  searchTimer: null,
  externalSyncTimer: null,
  composing: false,
  initialized: false,
};

const itemMutationQueues = new Map();
let toastTimer = null;

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

installStyles();
installPaginationControls();
installBulkControls();
fillStaticOptions();
bindControls();
await loadPage();
state.initialized = true;

function bindControls() {
  elements.search?.addEventListener("input", (event) => {
    state.filters.search = event.target.value;
    window.clearTimeout(state.searchTimer);
    state.searchTimer = window.setTimeout(() => {
      state.page = 1;
      void loadPage();
    }, SEARCH_DELAY_MS);
  });
  elements.batch?.addEventListener("change", (event) => {
    state.filters.batch = event.target.value;
    state.page = 1;
    void loadPage();
  });
  elements.assignee?.addEventListener("change", (event) => {
    state.filters.assignee = event.target.value;
    state.page = 1;
    void loadPage();
  });
  elements.overall?.addEventListener("change", (event) => {
    state.filters.overall = event.target.value;
    if (["완료", "보관됨"].includes(event.target.value)) {
      state.filters.unfinishedOnly = false;
      if (elements.unfinishedOnly) elements.unfinishedOnly.checked = false;
    }
    state.page = 1;
    void loadPage();
  });
  elements.unfinishedOnly?.addEventListener("change", (event) => {
    state.filters.unfinishedOnly = event.target.checked;
    if (event.target.checked && ["완료", "보관됨"].includes(state.filters.overall)) {
      state.filters.overall = "";
      if (elements.overall) elements.overall.value = "";
    }
    state.page = 1;
    void loadPage();
  });

  document.querySelector("#add-items-button")?.addEventListener("click", () =>
    void openNewDetail(),
  );
  document.querySelector("#policy-button")?.addEventListener("click", openPolicyDialog);
  document.querySelector("#export-menu-button")?.addEventListener("click", () =>
    elements.exportDialog?.showModal(),
  );
  document.querySelector("#bulk-apply-button")?.addEventListener("click", () =>
    void applyBulkStatus(),
  );
  document.querySelector("#clear-selection-button")?.addEventListener("click", clearSelection);
  elements.selectVisible?.addEventListener("change", toggleVisibleSelection);
  elements.tableHead?.addEventListener("click", handleSortClick);
  elements.tableBody?.addEventListener("change", handleTableChange);
  elements.tableBody?.addEventListener("keydown", handleTableKeydown);
  elements.tableBody?.addEventListener("input", handleTableInput);
  elements.tableBody?.addEventListener("click", handleTableClick);

  document.addEventListener("compositionstart", (event) => {
    if (event.target instanceof Element && event.target.matches(EDITABLE_SELECTOR)) {
      state.composing = true;
    }
  }, true);
  document.addEventListener("compositionend", (event) => {
    if (event.target instanceof Element && event.target.matches(EDITABLE_SELECTOR)) {
      state.composing = false;
    }
  }, true);

  elements.detailForm?.addEventListener("submit", (event) => void saveDetailForm(event));
  elements.archiveButton?.addEventListener("click", () => void archiveCurrentItem());
  document.querySelector("#add-option-button")?.addEventListener("click", addOptionDraft);
  document.querySelector("#china-sync-button")?.addEventListener("click", () =>
    void syncChinaOrderOptions(),
  );
  document.querySelector("#preview-button")?.addEventListener("click", previewCurrentDetail);
  document.querySelector("#regenerate-code-button")?.addEventListener("click", regenerateCurrentCode);
  elements.detailOptions?.addEventListener("input", updateOptionDraftFromTable);
  elements.detailOptions?.addEventListener("click", handleOptionTableClick);
  elements.detailForm?.addEventListener("click", handleChinaLinkAction);
  elements.detailForm?.addEventListener("input", handleChinaLinkInput);
  elements.policyForm?.addEventListener("submit", (event) => void savePolicyForm(event));
  document.querySelector("#reset-policy-button")?.addEventListener("click", resetPolicyForm);
  elements.addForm?.addEventListener("submit", (event) => void savePastedItems(event));
  elements.addForm?.elements?.paste?.addEventListener("input", updatePastePreview);
  document.querySelector("#export-json-button")?.addEventListener("click", () =>
    void exportJson(),
  );
  document.querySelector("#export-csv-button")?.addEventListener("click", exportCsv);
  document.querySelector("#import-json-button")?.addEventListener("click", () =>
    elements.backupInput?.click(),
  );
  elements.backupInput?.addEventListener("change", (event) => void importBackup(event));
  document.querySelector("#reset-seed-button")?.addEventListener("click", () =>
    void resetToSeed(),
  );

  window.addEventListener("product-launch-tracker:external-state", () => {
    window.clearTimeout(state.externalSyncTimer);
    state.externalSyncTimer = window.setTimeout(() => void synchronizeLegacyPageChanges(), 120);
  });
  window.addEventListener("focus", () => {
    if (state.initialized && document.visibilityState === "visible") schedulePageRefresh();
  });
}

function fillStaticOptions() {
  if (elements.bulkStage) {
    elements.bulkStage.innerHTML = STAGES.map(
      ({ key, label }) => `<option value="${key}">${label}</option>`,
    ).join("");
  }
  if (elements.bulkStatus) {
    elements.bulkStatus.innerHTML = STATUS_OPTIONS.map(
      (status) => `<option value="${status}">${status}</option>`,
    ).join("");
  }
}

async function loadPage(options = {}) {
  const requestSerial = ++state.requestSerial;
  state.requestController?.abort();
  state.requestController = new AbortController();
  setLoading(true, options.silent === true);

  const params = new URLSearchParams({
    mode: "page",
    page: String(state.page),
    pageSize: String(state.pageSize),
    search: state.filters.search.trim(),
    batch: state.filters.batch,
    assignee: state.filters.assignee,
    overall: state.filters.overall,
    unfinishedOnly: String(state.filters.unfinishedOnly),
    sort: state.sort.key,
    direction: state.sort.direction,
  });

  try {
    let body = await requestJson(`${OPTIMIZED_API}?${params.toString()}`, {
      signal: state.requestController.signal,
      cache: "no-store",
    });
    if (requestSerial !== state.requestSerial) return;
    if (body.stateExists === false) {
      await initializeServerState();
      body = await requestJson(`${OPTIMIZED_API}?${params.toString()}`, {
        signal: state.requestController.signal,
        cache: "no-store",
      });
    }
    if (requestSerial !== state.requestSerial) return;
    if (await recoverNewerStartupLocalState(body.updatedAt)) {
      body = await requestJson(`${OPTIMIZED_API}?${params.toString()}`, {
        signal: state.requestController.signal,
        cache: "no-store",
      });
    }
    if (requestSerial !== state.requestSerial) return;

    state.page = Number(body.page) || 1;
    state.pageSize = Number(body.pageSize) || DEFAULT_PAGE_SIZE;
    state.pageCount = Number(body.pageCount) || 1;
    state.total = Number(body.total) || 0;
    state.items = Array.isArray(body.items) ? body.items : [];
    state.itemById = new Map(state.items.map((item) => [String(item.id), item]));
    state.counts = body.counts ?? {};
    state.filterOptions = body.filterOptions ?? { batches: [], assignees: [] };
    state.policy = normalizePolicy(body.policy ?? state.policy);
    state.sourceImportedAt = body.sourceImportedAt ?? null;
    state.updatedAt = body.updatedAt ?? null;
    pruneSelection();
    renderSummary();
    renderFilters();
    renderTable();
    renderPagination();
    renderSourceMeta();
    syncLegacyPageCache();
    setSaveStatus("서버 최적화 목록 사용 중");
    window.dispatchEvent(
      new CustomEvent("product-launch-tracker:page-loaded", {
        detail: { page: state.page, pageSize: state.pageSize, total: state.total },
      }),
    );
  } catch (error) {
    if (error?.name === "AbortError") return;
    console.error(error);
    setSaveStatus("목록 불러오기 실패");
    showToast(error instanceof Error ? error.message : "목록을 불러오지 못했습니다.");
    if (elements.tableBody) {
      elements.tableBody.innerHTML = `
        <tr><td colspan="16" class="empty-state">목록을 불러오지 못했습니다. 새로고침해 주세요.</td></tr>
      `;
    }
  } finally {
    if (requestSerial === state.requestSerial) setLoading(false, options.silent === true);
  }
}

async function recoverNewerStartupLocalState(serverUpdatedAt) {
  if (startupRecoveryChecked) return false;
  startupRecoveryChecked = true;
  if (!startupLocalState) return false;
  const localTime = timestampOf(startupLocalState.savedAt);
  const serverTime = timestampOf(serverUpdatedAt);
  if (localTime <= serverTime) return false;

  try {
    setSaveStatus("이 브라우저의 최신 저장본 복구 중");
    await requestJson(STATE_API, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: startupLocalState }),
    });
    localStorage.removeItem(RECOVERY_STORAGE_KEY);
    return true;
  } catch (error) {
    localStorage.setItem(RECOVERY_STORAGE_KEY, JSON.stringify(startupLocalState));
    showToast(
      `서버보다 최신인 브라우저 저장본을 별도 복구키에 보존했습니다. ${
        error instanceof Error ? error.message : "자동 복구 실패"
      }`,
    );
    return false;
  }
}

function selectNewestFullLocalState(values) {
  return values
    .filter(
      (value) =>
        value &&
        value.partialPage !== true &&
        Array.isArray(value.items),
    )
    .sort((left, right) => timestampOf(right.savedAt) - timestampOf(left.savedAt))[0] ?? null;
}

function timestampOf(value) {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

async function initializeServerState() {
  setSaveStatus("최초 데이터 준비 중");
  const current = safeJsonParse(localStorage.getItem(STORAGE_KEY));
  const legacy = safeJsonParse(localStorage.getItem(LEGACY_STORAGE_KEY));
  let initial = current?.partialPage !== true && Array.isArray(current?.items) ? current : null;
  if (!initial && legacy?.partialPage !== true && Array.isArray(legacy?.items)) initial = legacy;
  if (!initial) {
    const response = await fetch("./data/launch-items.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`초기 데이터 응답 오류: ${response.status}`);
    const seed = await response.json();
    initial = {
      schemaVersion: 3,
      sourceImportedAt: seed?.meta?.importedAt ?? new Date().toISOString(),
      savedAt: new Date().toISOString(),
      policy: normalizePolicy(DEFAULT_POLICY),
      items: Array.isArray(seed?.items) ? seed.items : [],
    };
  }
  await requestJson(STATE_API, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state: initial }),
  });
}

function renderSummary() {
  if (!elements.summary) return;
  const tones = ["", "emerald", "blue", "amber", "emerald"];
  elements.summary.innerHTML = Object.entries(state.counts)
    .map(
      ([label, value], index) => `
        <article class="summary-card" data-tone="${tones[index] ?? ""}">
          <span>${escapeHtml(label)}</span><strong>${number(value)}</strong>
        </article>
      `,
    )
    .join("");
}

function renderFilters() {
  replaceSelectOptions(
    elements.batch,
    "전체 작업 묶음",
    state.filterOptions.batches ?? [],
    state.filters.batch,
  );
  replaceSelectOptions(
    elements.assignee,
    "전체 담당자",
    state.filterOptions.assignees ?? [],
    state.filters.assignee,
  );
}

function replaceSelectOptions(select, allLabel, values, current) {
  if (!select) return;
  const nextValues = Array.isArray(values) ? values : [];
  select.innerHTML = [
    `<option value="">${escapeHtml(allLabel)}</option>`,
    ...nextValues.map(
      (value) => `<option value="${escapeAttribute(value)}">${escapeHtml(value)}</option>`,
    ),
  ].join("");
  select.value = nextValues.includes(current) ? current : "";
}

function renderTable() {
  if (!elements.tableBody) return;
  elements.tableBody.innerHTML = state.items.map(renderRow).join("");
  updateSortHeaders();
  updateSelectionUi();
  if (elements.visibleCount) {
    const start = state.total ? (state.page - 1) * state.pageSize + 1 : 0;
    const end = Math.min(state.page * state.pageSize, state.total);
    elements.visibleCount.textContent = `${number(state.total)}건 · ${number(start)}-${number(end)}`;
  }
  if (elements.emptyState) elements.emptyState.hidden = state.items.length > 0;
}

function renderRow(item) {
  const receiptPending = item.receiptPending === true;
  const selected = state.selectedIds.has(item.id);
  const optionLabels = Array.isArray(item.optionLabels) ? item.optionLabels : [];
  const optionLocations = Array.isArray(item.optionLocations) ? item.optionLocations : [];
  const multiOption = optionLocations.length >= 2;
  const stages = item.stages ?? {};
  return `
    <tr data-id="${escapeAttribute(item.id)}" class="${selected ? "is-selected" : ""} ${item.archivedAt ? "is-archived" : ""} ${receiptPending ? "is-receipt-pending" : ""}">
      <td class="check-column" data-column-key="select"><input class="row-check" type="checkbox" ${selected ? "checked" : ""} aria-label="${escapeAttribute(`${item.modelNumber} 선택`)}" /></td>
      <td class="cell-truncate" data-column-key="workBatch" title="${escapeAttribute(item.workBatch)}"><span class="optimized-row-number">#${number(item.trackerRowNumber ?? 0)}</span>${escapeHtml(item.workBatch)}${receiptPending ? '<span class="receipt-pending-badge">입고대기중</span>' : ""}</td>
      <td data-column-key="barcode">
        ${multiOption ? "" : `<input class="barcode-input optimized-inline-input" value="${escapeAttribute(item.barcode)}" placeholder="BAA1-1" autocomplete="off" data-last-committed="${escapeAttribute(item.barcode)}" aria-label="${escapeAttribute(item.modelNumber)} 기준 바코드" />`}
        ${multiOption ? renderOptionLocations(optionLocations) : ""}
      </td>
      <td data-column-key="modelNumber"><input class="inline-model-number-editor optimized-inline-input" value="${escapeAttribute(item.modelNumber)}" data-last-committed="${escapeAttribute(item.modelNumber)}" aria-label="모델번호 수정" />${item.migrationReview ? '<span class="review-dot" title="이관 검토 표시"></span>' : ""}</td>
      <td class="product-name" data-column-key="productName"><input class="inline-product-name-editor optimized-inline-input" value="${escapeAttribute(item.productName)}" data-last-committed="${escapeAttribute(item.productName)}" aria-label="모델명 수정" /></td>
      <td class="category-cell" data-column-key="shoplingCategory">
        <input class="inline-table-editor inline-category-editor optimized-inline-input" value="${escapeAttribute(item.shoplingCategory)}" placeholder="샵플링 표준 카테고리" data-last-committed="${escapeAttribute(item.shoplingCategory)}" />
        ${renderAiSuggestion(item)}
      </td>
      <td class="options-cell" data-column-key="options"><input class="inline-table-editor inline-options-editor optimized-inline-input" value="${escapeAttribute(optionLabels.join(", "))}" placeholder="단품 또는 옵션1, 옵션2" data-last-committed="${escapeAttribute(optionLabels.join(", "))}" /></td>
      <td data-column-key="readiness"><button class="readiness-badge ${receiptPending ? "receipt-pending" : item.readiness?.ready ? "is-ready" : "needs-work"}" type="button" data-action="preview" title="${escapeAttribute(item.readiness?.firstError || "")}">${receiptPending ? "입고대기중" : item.readiness?.ready ? "준비완료" : `준비필요 ${number(item.readiness?.errorCount ?? 0)}`}</button></td>
      ${STAGES.map(({ key }) => statusSelect(stages[key]?.status, key, item.modelNumber)).join("")}
      <td class="next-stage" data-column-key="nextStage">${escapeHtml(item.nextStage)}<span class="progress-text">${number(item.progress?.completed ?? 0)}/${number(item.progress?.total ?? STAGES.length)} 완료</span></td>
      <td class="row-actions" data-column-key="manage"><button class="row-action" type="button" data-action="detail">${item.archivedAt ? "복구·수정" : "상품 상세"}</button></td>
    </tr>
  `;
}

function renderOptionLocations(options) {
  return `
    <div class="inline-option-location-list" data-signature="optimized">
      <div class="inline-option-location-title">옵션별 위치코드</div>
      ${options
        .map(
          (option) => `
            <label class="inline-option-location-row">
              <input class="inline-option-location-input optimized-inline-input" value="${escapeAttribute(option.barcode)}" data-empty="${option.barcode ? "false" : "true"}" data-option-id="${escapeAttribute(option.id)}" data-option-index="${option.index}" data-option-label="${escapeAttribute(option.label)}" data-last-committed="${escapeAttribute(option.barcode)}" aria-label="${escapeAttribute(option.label)} 위치코드" />
              <span class="inline-option-location-label" title="${escapeAttribute(option.label)}">${escapeHtml(option.label)}</span>
            </label>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderAiSuggestion(item) {
  if (!item.categoryAiSuggestion || item.categoryAiStatus !== "review_required") return "";
  return `<button class="category-ai-suggestion-badge" type="button" data-action="apply-ai-category" data-suggestion="${escapeAttribute(item.categoryAiSuggestion)}" title="${escapeAttribute(item.categoryAiSuggestion)}">AI ${number(item.categoryAiConfidence || 0)}%</button>`;
}

function statusSelect(status, key, modelNumber) {
  const current = status || "미시작";
  return `
    <td data-column-key="${key}"><select class="status-select status-${current.replaceAll(" ", "-")}" data-stage="${key}" data-last-committed="${escapeAttribute(current)}" aria-label="${escapeAttribute(modelNumber)} ${key} 상태">
      ${STATUS_OPTIONS.map(
        (option) => `<option value="${option}" ${option === current ? "selected" : ""}>${option}</option>`,
      ).join("")}
    </select></td>
  `;
}

function handleSortClick(event) {
  const button = event.target.closest("button[data-sort-key]");
  if (!button) return;
  const key = button.dataset.sortKey || "";
  state.sort = {
    key,
    direction: state.sort.key === key && state.sort.direction === "asc" ? "desc" : "asc",
  };
  state.page = 1;
  void loadPage();
}

function updateSortHeaders() {
  for (const header of elements.tableHead?.querySelectorAll("th[data-sort-key]") ?? []) {
    const button = header.querySelector("button[data-sort-key]");
    const indicator = button?.querySelector(".sort-indicator");
    const active = header.dataset.sortKey === state.sort.key;
    const direction = active ? state.sort.direction : null;
    header.setAttribute(
      "aria-sort",
      direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none",
    );
    if (indicator) indicator.textContent = direction === "asc" ? "▲" : direction === "desc" ? "▼" : "↕";
  }
}

function handleTableChange(event) {
  const target = event.target;
  const row = target.closest?.("tr[data-id]");
  if (!row) return;
  const itemId = String(row.dataset.id ?? "");
  if (target.matches(".row-check")) {
    if (target.checked) state.selectedIds.add(itemId);
    else state.selectedIds.delete(itemId);
    row.classList.toggle("is-selected", target.checked);
    updateSelectionUi();
    return;
  }
  if (target.matches(".status-select")) {
    void commitStatusInput(target, itemId);
    return;
  }
  if (target.matches(EDITABLE_SELECTOR)) {
    if (target.dataset.enterCommitted === "true") {
      target.dataset.enterCommitted = "false";
      return;
    }
    void commitInlineInput(target, itemId);
  }
}

function handleTableKeydown(event) {
  if (
    event.key !== "Enter" ||
    event.isComposing ||
    state.composing ||
    !(event.target instanceof HTMLInputElement) ||
    !event.target.matches(EDITABLE_SELECTOR)
  ) {
    return;
  }
  event.preventDefault();
  event.target.dataset.enterCommitted = "true";
  const row = event.target.closest("tr[data-id]");
  if (row) void commitInlineInput(event.target, String(row.dataset.id ?? ""));
}

function handleTableInput(event) {
  if (!(event.target instanceof HTMLInputElement)) return;
  if (event.target.matches(".inline-option-location-input")) {
    event.target.dataset.empty = event.target.value.trim() ? "false" : "true";
  }
}

function handleTableClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const row = button.closest("tr[data-id]");
  if (!row) return;
  const itemId = String(row.dataset.id ?? "");
  if (button.dataset.action === "detail") void openDetail(itemId);
  if (button.dataset.action === "preview") void openPreview(itemId);
  if (button.dataset.action === "apply-ai-category") {
    void applyAiSuggestion(itemId, button.dataset.suggestion || "");
  }
}

async function commitInlineInput(input, itemId) {
  const previous = input.dataset.lastCommitted ?? "";
  let normalized = input.value;
  let payload = null;
  if (input.matches(".barcode-input")) {
    normalized = normalizeLocationCode(input.value);
    payload = { operation: "patch_item", itemId, patch: { barcode: normalized } };
  } else if (input.matches(".inline-model-number-editor")) {
    normalized = normalizeModelNumber(input.value);
    if (!normalized) return rejectEmpty(input, previous, "모델번호");
    payload = { operation: "patch_item", itemId, patch: { modelNumber: normalized } };
  } else if (input.matches(".inline-product-name-editor")) {
    normalized = input.value.trim();
    if (!normalized) return rejectEmpty(input, previous, "모델명");
    payload = { operation: "patch_item", itemId, patch: { productName: normalized } };
  } else if (input.matches(".inline-category-editor")) {
    normalized = input.value.trim();
    payload = { operation: "patch_item", itemId, patch: { shoplingCategory: normalized } };
  } else if (input.matches(".inline-options-editor")) {
    const labels = parseOptionLabels(input.value);
    normalized = labels.join(", ");
    payload = { operation: "patch_item", itemId, patch: { optionLabels: labels } };
  } else if (input.matches(".inline-option-location-input")) {
    normalized = normalizeLocationCode(input.value);
    payload = {
      operation: "patch_item",
      itemId,
      optionLocation: {
        optionId: input.dataset.optionId || "",
        optionIndex: Number(input.dataset.optionIndex),
        barcode: normalized,
      },
    };
  }
  if (!payload || normalized === previous) {
    input.value = normalized;
    return;
  }

  const saveVersion = Number(input.dataset.saveVersion || 0) + 1;
  input.dataset.saveVersion = String(saveVersion);
  input.value = normalized;
  input.dataset.lastCommitted = normalized;
  input.classList.add("is-saving");
  setSaveStatus("저장 중");
  try {
    const body = await enqueueItemMutation(itemId, payload);
    applyMutationResponse(body, itemId, input);
    if (Number(input.dataset.saveVersion || 0) === saveVersion) {
      input.classList.remove("is-saving");
      input.classList.add("is-saved");
      window.setTimeout(() => input.classList.remove("is-saved"), 700);
      setSaveStatus("서버에 저장됨");
    }
    if (input.matches(".inline-options-editor")) schedulePageRefresh();
  } catch (error) {
    if (Number(input.dataset.saveVersion || 0) === saveVersion) {
      if (input.value === normalized) input.value = previous;
      if (input.dataset.lastCommitted === normalized) {
        input.dataset.lastCommitted = previous;
      }
      input.classList.remove("is-saving");
      input.classList.add("is-error");
      window.setTimeout(() => input.classList.remove("is-error"), 1400);
      setSaveStatus("저장 실패");
    }
    showToast(error instanceof Error ? error.message : "저장하지 못했습니다.");
  }
}

async function commitStatusInput(select, itemId) {
  const previous = select.dataset.lastCommitted || "미시작";
  const status = select.value;
  let reason = "";
  if (status === "보류") {
    reason = window.prompt("보류 사유를 입력해 주세요.")?.trim() ?? "";
    if (!reason) {
      select.value = previous;
      return;
    }
  }
  select.disabled = true;
  try {
    const body = await enqueueItemMutation(itemId, {
      operation: "patch_item",
      itemId,
      stage: { stageKey: select.dataset.stage, status, reason },
    });
    select.dataset.lastCommitted = status;
    applyMutationResponse(body, itemId, select);
    schedulePageRefresh();
  } catch (error) {
    select.value = previous;
    showToast(error instanceof Error ? error.message : "상태를 저장하지 못했습니다.");
  } finally {
    select.disabled = false;
  }
}

function enqueueItemMutation(itemId, payload) {
  const previous = itemMutationQueues.get(itemId) ?? Promise.resolve();
  const current = previous.then(
    () => mutate(payload),
    () => mutate(payload),
  );
  itemMutationQueues.set(
    itemId,
    current.then(
      () => undefined,
      () => undefined,
    ),
  );
  return current;
}

async function mutate(payload) {
  return requestJson(OPTIMIZED_API, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function applyMutationResponse(body, itemId, activeControl = null) {
  const updated = Array.isArray(body.items)
    ? body.items.find((item) => String(item.id) === String(itemId))
    : null;
  if (updated) {
    const index = state.items.findIndex((item) => String(item.id) === String(itemId));
    if (index >= 0) state.items[index] = updated;
    state.itemById.set(String(itemId), updated);
    const row = elements.tableBody?.querySelector(`tr[data-id="${cssEscape(itemId)}"]`);
    if (row && (!activeControl || !row.contains(document.activeElement))) {
      row.outerHTML = renderRow(updated);
    }
  }
  if (body.counts) {
    state.counts = body.counts;
    renderSummary();
  }
  if (body.filterOptions) state.filterOptions = body.filterOptions;
  state.updatedAt = body.updatedAt ?? state.updatedAt;
  syncLegacyPageCache();
  window.dispatchEvent(
    new CustomEvent("product-launch-tracker:item-patched", {
      detail: { itemId, item: updated ?? null, source: "optimized-api" },
    }),
  );
}

function rejectEmpty(input, previous, label) {
  input.value = previous;
  showToast(`${label}은 비워둘 수 없습니다.`);
}

function toggleVisibleSelection(event) {
  for (const item of state.items) {
    if (event.target.checked) state.selectedIds.add(item.id);
    else state.selectedIds.delete(item.id);
  }
  for (const checkbox of elements.tableBody?.querySelectorAll(".row-check") ?? []) {
    checkbox.checked = event.target.checked;
    checkbox.closest("tr")?.classList.toggle("is-selected", event.target.checked);
  }
  updateSelectionUi();
}

function clearSelection() {
  state.selectedIds.clear();
  for (const checkbox of elements.tableBody?.querySelectorAll(".row-check") ?? []) {
    checkbox.checked = false;
    checkbox.closest("tr")?.classList.remove("is-selected");
  }
  updateSelectionUi();
}

function updateSelectionUi() {
  if (elements.selectedCount) {
    elements.selectedCount.textContent = `선택 ${number(state.selectedIds.size)}건`;
  }
  const visibleIds = state.items.map((item) => item.id);
  if (elements.selectVisible) {
    elements.selectVisible.checked =
      visibleIds.length > 0 && visibleIds.every((id) => state.selectedIds.has(id));
    elements.selectVisible.indeterminate =
      !elements.selectVisible.checked && visibleIds.some((id) => state.selectedIds.has(id));
  }
  const deleteButton = document.querySelector("#optimized-delete-selected");
  if (deleteButton) deleteButton.disabled = state.selectedIds.size === 0;
  const flowButton = document.querySelector("#optimized-product-flow-batch");
  if (flowButton) {
    const count = state.selectedIds.size;
    flowButton.disabled = count < 1 || count > MAX_PRODUCT_FLOW_SELECTION;
    flowButton.textContent = count
      ? `선택 ${number(count)}개를 출시플로우로 등록 진행`
      : "선택 상품을 출시플로우로 등록 진행";
    flowButton.title = count > MAX_PRODUCT_FLOW_SELECTION
      ? `한 번에 최대 ${MAX_PRODUCT_FLOW_SELECTION}개까지 진행할 수 있습니다.`
      : "체크한 상품을 상품출시플로우로 전달합니다.";
  }
}

function pruneSelection() {
  const available = new Set(state.items.map((item) => item.id));
  state.selectedIds = new Set([...state.selectedIds].filter((id) => available.has(id)));
}

async function applyBulkStatus() {
  const itemIds = [...state.selectedIds];
  if (!itemIds.length) {
    showToast("일괄 변경할 상품을 먼저 선택해 주세요.");
    return;
  }
  const stageKey = elements.bulkStage?.value;
  const status = elements.bulkStatus?.value;
  let reason = "";
  if (status === "보류") {
    reason = window.prompt("선택 항목에 공통으로 기록할 보류 사유를 입력해 주세요.")?.trim() ?? "";
    if (!reason) return;
  }
  setSaveStatus("일괄 저장 중");
  try {
    await mutate({ operation: "bulk_stage", itemIds, stageKey, status, reason });
    clearSelection();
    await loadPage({ silent: true });
    showToast(`${number(itemIds.length)}건의 상태를 변경했습니다.`);
  } catch (error) {
    showToast(error instanceof Error ? error.message : "일괄 변경하지 못했습니다.");
  }
}

async function deleteSelected() {
  const itemIds = [...state.selectedIds];
  if (!itemIds.length) return;
  if (!window.confirm(`선택한 ${number(itemIds.length)}건을 진행관리에서 삭제할까요?`)) return;
  try {
    await mutate({ operation: "delete_items", itemIds });
    clearSelection();
    await loadPage({ silent: true });
    showToast(`${number(itemIds.length)}건을 삭제했습니다.`);
  } catch (error) {
    showToast(error instanceof Error ? error.message : "삭제하지 못했습니다.");
  }
}

async function openDetail(itemId) {
  showDetailLoading("상품 불러오는 중");
  try {
    const body = await requestJson(
      `${OPTIMIZED_API}?${new URLSearchParams({ mode: "item", id: itemId }).toString()}`,
      { cache: "no-store" },
    );
    fillDetailForm(hydrateLaunchItem(body.item), "edit");
  } catch (error) {
    elements.detailDialog?.close();
    showToast(error instanceof Error ? error.message : "상품 상세를 불러오지 못했습니다.");
  }
}

async function openNewDetail() {
  const now = new Date().toISOString();
  const blank = hydrateLaunchItem({
    id: crypto.randomUUID(),
    workBatch: "새 작업 묶음",
    warehouseLocation: "",
    barcode: "",
    modelNumber: "",
    productName: "",
    shoplingCategory: "",
    selfCodeBase: "",
    notes: "",
    orderOptions: [],
    detailPageAsset: {},
    stages: Object.fromEntries(
      STAGES.map(({ key }) => [key, { status: "미시작", assignee: "", note: "" }]),
    ),
    source: { file: "직접 추가", sheet: "", rows: [], sheetRowRefs: [] },
    createdAt: now,
    updatedAt: now,
    updatedBy: "승준",
  });
  fillDetailForm(blank, "create");
}

function showDetailLoading(title) {
  if (!elements.detailDialog) return;
  state.detailItem = null;
  state.detailDraftOptions = [];
  elements.detailTitle.textContent = title;
  elements.detailForm?.classList.add("is-loading-detail");
  if (!elements.detailDialog.open) elements.detailDialog.showModal();
}

function fillDetailForm(item, mode) {
  state.detailItem = item;
  state.detailMode = mode;
  state.detailDraftOptions = structuredClone(item.orderOptions ?? []);
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
  ]) {
    if (form?.elements?.[name]) form.elements[name].value = item[name] ?? "";
  }
  if (form?.elements?.detailHtml) form.elements.detailHtml.value = item.detailPageAsset?.html ?? "";
  if (form?.elements?.mainImageUrl) form.elements.mainImageUrl.value = item.detailPageAsset?.mainImageUrl ?? "";
  if (form?.elements?.additionalImageUrls) {
    form.elements.additionalImageUrls.value = (item.detailPageAsset?.additionalImageUrls ?? []).join("\n");
  }
  renderOptionEditor();
  renderChinaProductLinks(item.chinaProductLinks ?? []);
  updateChinaSyncStatus(item);
  elements.detailTitle.textContent =
    mode === "create" ? "새 상품 추가" : `${item.modelNumber} · ${item.productName}`;
  if (elements.detailStages) {
    elements.detailStages.innerHTML = STAGES.map(
      ({ key, label }) => `
        <section class="stage-card"><h3>${label}</h3>
          <label class="field"><span>상태</span><select name="stage.${key}.status">${STATUS_OPTIONS.map(
            (status) => `<option value="${status}" ${item.stages?.[key]?.status === status ? "selected" : ""}>${status}</option>`,
          ).join("")}</select></label>
          <label class="field"><span>담당자</span><input name="stage.${key}.assignee" value="${escapeAttribute(item.stages?.[key]?.assignee ?? "")}" /></label>
        </section>
      `,
    ).join("");
  }
  if (elements.detailSource) {
    elements.detailSource.innerHTML = `
      <strong>원본 이력</strong><br />
      ${escapeHtml(item.source?.file ?? "직접 추가")} · ${escapeHtml(item.source?.sheet ?? "")}<br />
      원본 행: ${escapeHtml((item.source?.rows ?? []).join(", ") || "없음")}
    `;
  }
  if (elements.archiveButton) {
    elements.archiveButton.hidden = mode === "create";
    elements.archiveButton.textContent = item.archivedAt ? "보관에서 복구" : "보관 처리";
  }
  elements.detailForm?.classList.remove("is-loading-detail");
  if (elements.detailDialog && !elements.detailDialog.open) elements.detailDialog.showModal();
}

async function saveDetailForm(event) {
  event.preventDefault();
  if (event.submitter?.value !== "save") return;
  const changed = collectDetailDraft();
  if (!changed) return;
  const saveButton = event.submitter;
  saveButton.disabled = true;
  setSaveStatus("상품 상세 저장 중");
  try {
    const body = await mutate(
      state.detailMode === "create"
        ? { operation: "create_items", items: [changed] }
        : { operation: "replace_item", itemId: changed.id, item: changed },
    );
    const savedId = state.detailMode === "create" ? body.createdIds?.[0] : changed.id;
    if (savedId) applyMutationResponse(body, savedId);
    elements.detailDialog?.close();
    await loadPage({ silent: true });
    showToast(state.detailMode === "create" ? "새 상품을 추가했습니다." : "상품 기록을 저장했습니다.");
  } catch (error) {
    showToast(error instanceof Error ? error.message : "상품을 저장하지 못했습니다.");
  } finally {
    saveButton.disabled = false;
  }
}

function collectDetailDraft() {
  const current = state.detailItem;
  const form = elements.detailForm;
  if (!current || !form) return null;
  updateOptionDraftFromTable();
  const data = new FormData(form);
  const modelNumber = normalizeModelNumber(data.get("modelNumber"));
  const productName = String(data.get("productName") ?? "").trim();
  if (!modelNumber || !productName) {
    showToast("모델번호와 모델명은 필수입니다.");
    return null;
  }
  let chinaProductLinks;
  try {
    chinaProductLinks = readChinaProductLinkInputs();
  } catch {
    return null;
  }
  const stages = Object.fromEntries(
    STAGES.map(({ key }) => [
      key,
      {
        ...(current.stages?.[key] ?? {}),
        status: String(data.get(`stage.${key}.status`) ?? "미시작"),
        assignee: String(data.get(`stage.${key}.assignee`) ?? "").trim(),
      },
    ]),
  );
  return hydrateLaunchItem({
    ...current,
    id: String(data.get("id") ?? current.id),
    workBatch: String(data.get("workBatch") ?? "").trim(),
    warehouseLocation: String(data.get("warehouseLocation") ?? "").trim(),
    barcode: normalizeBarcode(data.get("barcode")),
    modelNumber,
    productName,
    shoplingCategory: String(data.get("shoplingCategory") ?? "").trim(),
    selfCodeBase: String(data.get("selfCodeBase") ?? "").trim(),
    notes: String(data.get("notes") ?? "").trim(),
    orderOptions: normalizeOrderOptions(state.detailDraftOptions),
    chinaProductLinks,
    detailPageAsset: {
      ...(current.detailPageAsset ?? {}),
      html: String(data.get("detailHtml") ?? ""),
      mainImageUrl: String(data.get("mainImageUrl") ?? "").trim(),
      additionalImageUrls: splitLines(data.get("additionalImageUrls")),
    },
    stages,
    updatedAt: new Date().toISOString(),
    updatedBy: "승준",
  });
}

function ensureChinaProductLinksSection() {
  let section = elements.detailForm?.querySelector("#optimized-china-product-links-section");
  if (section) return section;
  const detailHtml = elements.detailForm?.querySelector("textarea[name='detailHtml']");
  const detailSection = detailHtml?.closest("section.integration-section");
  if (!detailSection) return null;
  section = document.createElement("section");
  section.id = "optimized-china-product-links-section";
  section.className = "integration-section";
  section.innerHTML = `
    <div class="section-title-row">
      <div>
        <h3>중국 상품링크</h3>
        <p>최대 5개까지 저장합니다. 1번 링크가 상세페이지 엔진의 기준 링크입니다.</p>
      </div>
      <span id="optimized-china-product-links-status" class="optimized-china-link-status"></span>
    </div>
    <div id="optimized-china-product-links-list" class="optimized-china-link-list"></div>
  `;
  detailSection.before(section);
  return section;
}

function renderChinaProductLinks(values) {
  const section = ensureChinaProductLinksSection();
  const list = section?.querySelector("#optimized-china-product-links-list");
  if (!list) return;
  let normalized = [];
  try {
    normalized = normalizeChinaProductLinks(values);
  } catch {
    normalized = Array.isArray(values) ? values.map((value) => String(value ?? "").trim()) : [];
  }
  const padded = [
    ...normalized,
    ...Array(Math.max(0, MAX_CHINA_PRODUCT_LINKS - normalized.length)).fill(""),
  ].slice(0, MAX_CHINA_PRODUCT_LINKS);
  list.innerHTML = padded.map((value, index) => `
    <div class="optimized-china-link-row" data-index="${index}">
      <span class="optimized-china-link-number ${index === 0 ? "is-primary" : ""}">${index === 0 ? "1번 · 엔진 기준" : `${index + 1}번 링크`}</span>
      <input class="optimized-china-link-input" data-china-link-input data-index="${index}" type="url" inputmode="url" autocomplete="off" placeholder="https://detail.1688.com/offer/..." value="${escapeAttribute(value)}" />
      <button class="optimized-china-link-action" type="button" data-china-link-action="open" data-index="${index}" ${value ? "" : "disabled"}>열기</button>
      <button class="optimized-china-link-action ${index === 0 ? "is-primary" : ""}" type="button" data-china-link-action="pin" data-index="${index}" ${index === 0 ? "disabled" : ""}>${index === 0 ? "1번 고정됨" : "1번으로 고정"}</button>
    </div>
  `).join("");
  setChinaLinkStatus(normalized.length ? "1번 링크를 기준으로 저장합니다." : "최대 5개까지 입력할 수 있습니다.");
}

function handleChinaLinkInput(event) {
  if (!(event.target instanceof HTMLInputElement) || !event.target.matches("[data-china-link-input]")) return;
  const row = event.target.closest(".optimized-china-link-row");
  const openButton = row?.querySelector("[data-china-link-action='open']");
  if (openButton) openButton.disabled = !event.target.value.trim();
  setChinaLinkStatus("상품 저장 버튼을 누르면 함께 저장됩니다.", "dirty");
}

function handleChinaLinkAction(event) {
  const button = event.target.closest?.("button[data-china-link-action]");
  if (!button) return;
  const action = button.dataset.chinaLinkAction;
  const index = Number(button.dataset.index);
  if (action === "open") {
    try {
      const url = normalizeChinaProductUrl(readChinaProductLinkInputs({ normalize: false })[index] ?? "");
      if (!url) throw new Error("열어볼 링크를 먼저 입력하세요.");
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setChinaLinkStatus(error instanceof Error ? error.message : "링크를 열지 못했습니다.", "error");
    }
    return;
  }
  if (action === "pin") {
    try {
      renderChinaProductLinks(promoteChinaProductLink(readChinaProductLinkInputs(), index));
      setChinaLinkStatus("선택한 링크를 1번으로 이동했습니다. 상품 저장 버튼을 누르세요.", "dirty");
    } catch (error) {
      setChinaLinkStatus(error instanceof Error ? error.message : "링크 순서를 바꾸지 못했습니다.", "error");
    }
  }
}

function readChinaProductLinkInputs(options = { normalize: true }) {
  const values = [...(elements.detailForm?.querySelectorAll("[data-china-link-input]") ?? [])]
    .map((input) => input.value);
  if (options.normalize === false) return values;
  try {
    return normalizeChinaProductLinks(values);
  } catch (error) {
    setChinaLinkStatus(error instanceof Error ? error.message : "중국 상품링크를 확인하세요.", "error");
    throw error;
  }
}

function setChinaLinkStatus(message, tone = "") {
  const status = elements.detailForm?.querySelector("#optimized-china-product-links-status");
  if (!status) return;
  status.textContent = message;
  status.dataset.tone = tone;
}

function renderOptionEditor() {
  if (!elements.detailOptions) return;
  if (!state.detailDraftOptions.length) {
    elements.detailOptions.innerHTML = `<tr><td colspan="6" class="option-empty">발주·입고 데이터가 아직 연결되지 않았습니다.</td></tr>`;
    return;
  }
  elements.detailOptions.innerHTML = state.detailDraftOptions
    .map(
      (option, index) => `
        <tr data-option-index="${index}">
          <td><input data-field="optionName" value="${escapeAttribute(option.optionName)}" placeholder="옵션" /></td>
          <td><input data-field="saleOption" value="${escapeAttribute(option.saleOption)}" placeholder="블랙" /></td>
          <td><input data-field="barcode" value="${escapeAttribute(option.barcode)}" placeholder="BAA1-1" /></td>
          <td><input data-field="baseSalePriceKrw" type="number" min="0" step="1" value="${option.baseSalePriceKrw || ""}" /></td>
          <td><input data-field="unitCostKrw" type="number" min="0" step="1" value="${option.unitCostKrw || ""}" /></td>
          <td><button class="option-remove" type="button" data-action="remove-option">×</button></td>
        </tr>
      `,
    )
    .join("");
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
  const rows = [...(elements.detailOptions?.querySelectorAll("tr[data-option-index]") ?? [])];
  if (!rows.length) return;
  state.detailDraftOptions = rows.map((row, index) => {
    const previous = state.detailDraftOptions[index] ?? {};
    const get = (field) => row.querySelector(`[data-field='${field}']`)?.value ?? "";
    return {
      ...previous,
      id: previous.id ?? crypto.randomUUID(),
      optionName: get("optionName").trim() || "옵션",
      saleOption: get("saleOption").trim(),
      barcode: normalizeLocationCode(get("barcode")),
      baseSalePriceKrw: Math.max(0, Math.ceil(Number(get("baseSalePriceKrw")) || 0)),
      unitCostKrw: Math.max(0, Math.ceil(Number(get("unitCostKrw")) || 0)),
    };
  });
}

async function syncChinaOrderOptions() {
  const form = elements.detailForm;
  const barcode = normalizeBarcode(form?.elements?.barcode?.value);
  const modelNumber = normalizeModelNumber(form?.elements?.modelNumber?.value);
  if (!barcode && !modelNumber) {
    showToast("기준 바코드 또는 모델번호가 필요합니다.");
    return;
  }
  if (elements.chinaSyncStatus) elements.chinaSyncStatus.textContent = "불러오는 중";
  try {
    const params = new URLSearchParams({ barcode, modelNumber });
    const body = await requestJson(
      `/api/product-launch-tracker/china-order-options?${params.toString()}`,
      { cache: "no-store" },
    );
    state.detailDraftOptions = normalizeOrderOptions(body.options);
    renderOptionEditor();
    if (elements.chinaSyncStatus) {
      elements.chinaSyncStatus.textContent = `${number(state.detailDraftOptions.length)}개 연결`;
      elements.chinaSyncStatus.dataset.tone = "success";
    }
  } catch (error) {
    if (elements.chinaSyncStatus) {
      elements.chinaSyncStatus.textContent = "연결 실패";
      elements.chinaSyncStatus.dataset.tone = "error";
    }
    showToast(error instanceof Error ? error.message : "발주·입고 데이터를 불러오지 못했습니다.");
  }
}

function updateChinaSyncStatus(item) {
  if (!elements.chinaSyncStatus) return;
  elements.chinaSyncStatus.textContent = item.orderOptions?.length
    ? `${number(item.orderOptions.length)}개 연결됨`
    : "연동 전";
}

async function archiveCurrentItem() {
  const item = state.detailItem;
  if (!item) return;
  const archived = !item.archivedAt;
  if (!window.confirm(`${item.modelNumber} 항목을 ${archived ? "보관" : "복구"}할까요?`)) return;
  try {
    await mutate({ operation: "archive_items", itemIds: [item.id], archived });
    elements.detailDialog?.close();
    await loadPage({ silent: true });
  } catch (error) {
    showToast(error instanceof Error ? error.message : "보관 상태를 변경하지 못했습니다.");
  }
}

async function openPreview(itemId) {
  try {
    const body = await requestJson(
      `${OPTIMIZED_API}?${new URLSearchParams({ mode: "item", id: itemId }).toString()}`,
      { cache: "no-store" },
    );
    renderPreview(hydrateLaunchItem(body.item));
  } catch (error) {
    showToast(error instanceof Error ? error.message : "미리보기를 만들지 못했습니다.");
  }
}

function previewCurrentDetail() {
  const item = collectDetailDraft();
  if (item) renderPreview(item);
}

function renderPreview(item) {
  const preview = buildShoplingPreview(item, state.policy);
  if (elements.previewTitle) {
    elements.previewTitle.textContent = `${item.modelNumber} · 샵플링 등록 미리보기`;
  }
  const issues = [
    ...preview.errors.map((message) => `<li class="error-text">${escapeHtml(message)}</li>`),
    ...preview.warnings.map((message) => `<li class="warning-text">${escapeHtml(message)}</li>`),
  ];
  if (elements.previewContent) {
    elements.previewContent.innerHTML = `
      <div class="preview-summary ${preview.ready ? "ready" : "blocked"}">
        <strong>${preview.ready ? "6개 상품 등록 준비완료" : "등록 전 보완 필요"}</strong>
        <span>카테고리: ${preview.category ? escapeHtml(preview.category) : "미입력"} · 옵션 ${number(item.orderOptions.length)}개</span>
      </div>
      ${issues.length ? `<ul class="issue-list">${issues.join("")}</ul>` : ""}
      <div class="preview-table-wrap"><table class="preview-table">
        <thead><tr><th>그룹</th><th>최초 상품명</th><th>자사상품코드</th><th>판매가</th><th>소비자가</th></tr></thead>
        <tbody>${preview.channels
          .map(
            (channel) => `<tr><td>${channel.label}</td><td>${escapeHtml(channel.productName)}</td><td><code>${escapeHtml(channel.ptnGoodsCd)}</code></td><td>${won(channel.salePrice)}</td><td>${won(channel.listPrice)}</td></tr>`,
          )
          .join("")}</tbody>
      </table></div>
    `;
  }
  elements.previewDialog?.showModal();
}

function openPolicyDialog() {
  const policy = normalizePolicy(state.policy);
  for (const channel of SHOPLING_CHANNELS) {
    const field = elements.policyForm?.elements?.[`multiplier.${channel.multiplierKey}`];
    if (field) field.value = policy.channelMultipliers[channel.multiplierKey];
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
  ]) {
    if (elements.policyForm?.elements?.[name]) elements.policyForm.elements[name].value = policy[name] ?? "";
  }
  elements.policyDialog?.showModal();
}

async function savePolicyForm(event) {
  event.preventDefault();
  if (event.submitter?.value !== "save") return;
  const data = new FormData(elements.policyForm);
  const policy = normalizePolicy({
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
  try {
    await mutate({ operation: "update_policy", policy });
    state.policy = policy;
    elements.policyDialog?.close();
    syncLegacyPageCache();
    showToast(`통합정책 v${number(policy.version)}을 저장했습니다.`);
  } catch (error) {
    showToast(error instanceof Error ? error.message : "통합정책을 저장하지 못했습니다.");
  }
}

function resetPolicyForm() {
  if (!window.confirm("화면의 정책값을 기본정책으로 되돌릴까요? 저장 버튼을 눌러야 반영됩니다.")) return;
  state.policy = normalizePolicy(DEFAULT_POLICY);
  openPolicyDialog();
}

function regenerateCurrentCode() {
  if (!elements.detailForm?.elements?.selfCodeBase) return;
  elements.detailForm.elements.selfCodeBase.value = "";
  showToast("저장할 때 중복되지 않는 자사상품코드가 자동 생성됩니다.");
}

async function applyAiSuggestion(itemId, suggestion) {
  if (!suggestion || !window.confirm(`AI 추천 카테고리를 적용할까요?\n${suggestion}`)) return;
  try {
    const body = await mutate({
      operation: "patch_item",
      itemId,
      patch: {
        shoplingCategory: suggestion,
        categoryAiStatus: "manually_applied",
        categoryAiUpdatedAt: new Date().toISOString(),
      },
      updatedBy: "AI 추천 수동 적용",
    });
    applyMutationResponse(body, itemId);
  } catch (error) {
    showToast(error instanceof Error ? error.message : "AI 추천을 적용하지 못했습니다.");
  }
}

function updatePastePreview() {
  const parsed = parsePastedRows(elements.addForm?.elements?.paste?.value ?? "");
  if (elements.pastePreview) elements.pastePreview.textContent = `붙여넣은 상품 ${number(parsed.length)}건`;
}

async function savePastedItems(event) {
  event.preventDefault();
  if (event.submitter?.value !== "save") return;
  const parsed = parsePastedRows(elements.addForm?.elements?.paste?.value ?? "");
  if (!parsed.length) return showToast("추가할 상품이 없습니다.");
  event.submitter.disabled = true;
  try {
    await mutate({ operation: "create_items", items: parsed });
    elements.addDialog?.close();
    state.page = 1;
    await loadPage({ silent: true });
    showToast(`${number(parsed.length)}건을 추가했습니다.`);
  } catch (error) {
    showToast(error instanceof Error ? error.message : "상품을 추가하지 못했습니다.");
  } finally {
    event.submitter.disabled = false;
  }
}

async function exportJson() {
  try {
    const body = await requestJson(`${OPTIMIZED_API}?mode=export`, { cache: "no-store" });
    download(
      `신규상품출시진행관리_백업_${dateStamp()}.json`,
      JSON.stringify(
        {
          schemaVersion: body.schemaVersion ?? 3,
          exportedAt: new Date().toISOString(),
          ...body.state,
        },
        null,
        2,
      ),
      "application/json;charset=utf-8",
    );
    showToast("전체 백업 파일을 내려받았습니다.");
  } catch (error) {
    showToast(error instanceof Error ? error.message : "백업을 만들지 못했습니다.");
  }
}

function exportCsv() {
  const header = [
    "행번호",
    "작업 묶음",
    "기준 바코드",
    "모델번호",
    "모델명",
    "샵플링 표준 카테고리",
    "옵션",
    "전체 상태",
    "다음 작업",
  ];
  const rows = state.items.map((item) => [
    item.trackerRowNumber,
    item.workBatch,
    item.barcode,
    item.modelNumber,
    item.productName,
    item.shoplingCategory,
    item.optionLabels?.join(", "),
    item.overallStatus,
    item.nextStage,
  ]);
  download(
    `신규상품출시진행관리_현재페이지_${dateStamp()}.csv`,
    `\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}`,
    "text/csv;charset=utf-8",
  );
  showToast("현재 페이지 CSV를 내려받았습니다.");
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
    const fullState = Array.isArray(backup)
      ? { schemaVersion: 3, savedAt: new Date().toISOString(), policy: state.policy, items: backup }
      : { ...backup, partialPage: undefined, savedAt: new Date().toISOString() };
    await requestJson(STATE_API, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: fullState }),
    });
    state.page = 1;
    state.selectedIds.clear();
    elements.exportDialog?.close();
    await loadPage({ silent: true });
    showToast("백업 파일을 복원했습니다.");
  } catch (error) {
    showToast(error instanceof Error ? error.message : "올바른 백업 파일이 아닙니다.");
  }
}

async function resetToSeed() {
  if (!window.confirm("현재 수정 내용이 모두 사라집니다. 최초 이관 상태로 되돌릴까요?")) return;
  try {
    const response = await fetch("./data/launch-items.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`초기 데이터 응답 오류: ${response.status}`);
    const seed = await response.json();
    await requestJson(STATE_API, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        state: {
          schemaVersion: 3,
          sourceImportedAt: seed?.meta?.importedAt ?? new Date().toISOString(),
          savedAt: new Date().toISOString(),
          policy: normalizePolicy(DEFAULT_POLICY),
          items: seed?.items ?? [],
        },
      }),
    });
    state.page = 1;
    state.selectedIds.clear();
    elements.exportDialog?.close();
    await loadPage({ silent: true });
  } catch (error) {
    showToast(error instanceof Error ? error.message : "최초 데이터로 되돌리지 못했습니다.");
  }
}

function syncLegacyPageCache() {
  const legacyItems = state.items.map(summaryToLegacyItem);
  const payload = {
    schemaVersion: 3,
    partialPage: true,
    partialItemIds: legacyItems.map((item) => item.id),
    page: state.page,
    pageSize: state.pageSize,
    total: state.total,
    savedAt: state.updatedAt ?? new Date().toISOString(),
    sourceImportedAt: state.sourceImportedAt,
    policy: state.policy,
    items: legacyItems,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function summaryToLegacyItem(item) {
  return {
    id: item.id,
    trackerRowNumber: item.trackerRowNumber,
    workBatch: item.workBatch,
    warehouseLocation: item.warehouseLocation,
    barcode: item.barcode,
    modelNumber: item.modelNumber,
    productName: item.productName,
    shoplingCategory: item.shoplingCategory,
    selfCodeBase: item.selfCodeBase,
    options: item.optionLabels ?? [],
    orderOptions: item.orderOptions ?? [],
    stages: item.stages ?? {},
    source: item.source ?? {},
    shoplingProducts: item.shoplingProducts ?? {},
    chinaProductLinks: item.chinaProductLinks ?? [],
    detailPageAsset: item.detailPageAsset ?? {},
    archivedAt: item.archivedAt,
    migrationReview: item.migrationReview,
    categoryAiSuggestion: item.categoryAiSuggestion,
    categoryAiConfidence: item.categoryAiConfidence,
    categoryAiStatus: item.categoryAiStatus,
    updatedAt: item.updatedAt,
    updatedBy: item.updatedBy,
  };
}

async function synchronizeLegacyPageChanges() {
  const stored = safeJsonParse(localStorage.getItem(STORAGE_KEY));
  if (!stored?.partialPage || !Array.isArray(stored.items)) return;
  const operations = [];
  for (const localItem of stored.items) {
    const current = state.itemById.get(String(localItem?.id ?? ""));
    if (!current) continue;
    const patch = buildLegacyPatch(current, localItem);
    if (Object.keys(patch).length) {
      operations.push(
        enqueueItemMutation(current.id, {
          operation: "patch_item",
          itemId: current.id,
          patch,
          updatedBy: localItem.updatedBy || "승준",
        }),
      );
    }
  }
  if (!operations.length) return;
  try {
    await Promise.all(operations);
    await loadPage({ silent: true });
  } catch (error) {
    console.error(error);
  }
}

function buildLegacyPatch(current, localItem) {
  const patch = {};
  const fields = [
    "barcode",
    "modelNumber",
    "productName",
    "shoplingCategory",
    "workBatch",
    "warehouseLocation",
    "categoryAiSuggestion",
    "categoryAiConfidence",
    "categoryAiStatus",
    "categoryAiReason",
    "categoryAiAlternatives",
    "categoryAiMarketEvidence",
    "categoryAiSnapshotHash",
    "categoryAiUpdatedAt",
    "chinaProductLinks",
    "shoplingProducts",
    "stages",
  ];
  for (const field of fields) {
    if (!deepEqual(localItem?.[field], current?.[field]) && localItem?.[field] !== undefined) {
      patch[field] = localItem[field];
    }
  }
  if (!deepEqual(localItem?.orderOptions, current?.orderOptions) && Array.isArray(localItem?.orderOptions)) {
    patch.orderOptions = localItem.orderOptions;
  }
  if (localItem?.detailPageAsset?.html) patch.detailPageAsset = localItem.detailPageAsset;
  return patch;
}

async function handoffSelectedToProductLaunchFlow() {
  const itemIds = [...state.selectedIds];
  if (!itemIds.length) return showToast("상품출시플로우로 진행할 상품을 체크하세요.");
  if (itemIds.length > MAX_PRODUCT_FLOW_SELECTION) {
    return showToast(`한 번에 최대 ${MAX_PRODUCT_FLOW_SELECTION}개 상품까지만 진행할 수 있습니다.`);
  }
  const rowNumbers = itemIds
    .map((id) => Number(state.itemById.get(id)?.trackerRowNumber))
    .filter((value) => Number.isSafeInteger(value) && value > 0);
  if (rowNumbers.length !== itemIds.length) {
    return showToast("선택한 상품의 진행관리 행번호를 확인하지 못했습니다.");
  }
  const button = document.querySelector("#optimized-product-flow-batch");
  if (button) {
    button.disabled = true;
    button.textContent = "저장 확인 중...";
  }
  try {
    await Promise.all([...itemMutationQueues.values()]);
    localStorage.setItem(
      BATCH_SELECTION_KEY,
      JSON.stringify({
        version: 1,
        itemIds,
        rowExpression: compactRowExpression(rowNumbers),
        autoStart: true,
        selectedAt: new Date().toISOString(),
      }),
    );
    window.location.assign("/product-launch-flow");
  } catch (error) {
    showToast(error instanceof Error ? error.message : "상품출시플로우로 전달하지 못했습니다.");
    updateSelectionUi();
  }
}

function compactRowExpression(values) {
  const rows = [...new Set(values.map(Number).filter((value) => Number.isSafeInteger(value) && value > 0))]
    .sort((left, right) => left - right);
  if (!rows.length) return "";
  const parts = [];
  let start = rows[0];
  let previous = rows[0];
  for (const current of rows.slice(1)) {
    if (current === previous + 1) {
      previous = current;
      continue;
    }
    parts.push(start === previous ? String(start) : `${start}-${previous}`);
    start = current;
    previous = current;
  }
  parts.push(start === previous ? String(start) : `${start}-${previous}`);
  return parts.join(",");
}

function renderPagination() {
  const pageLabel = document.querySelector("#optimized-page-label");
  const first = document.querySelector("#optimized-page-first");
  const previous = document.querySelector("#optimized-page-prev");
  const next = document.querySelector("#optimized-page-next");
  const last = document.querySelector("#optimized-page-last");
  const size = document.querySelector("#optimized-page-size");
  if (pageLabel) pageLabel.textContent = `${number(state.page)} / ${number(state.pageCount)} 페이지`;
  if (first) first.disabled = state.page <= 1;
  if (previous) previous.disabled = state.page <= 1;
  if (next) next.disabled = state.page >= state.pageCount;
  if (last) last.disabled = state.page >= state.pageCount;
  if (size) size.value = String(state.pageSize);
}

function installPaginationControls() {
  const workspace = document.querySelector(".workspace-card");
  const emptyState = document.querySelector("#empty-state");
  if (!workspace || document.querySelector("#optimized-pagination")) return;
  const bar = document.createElement("div");
  bar.id = "optimized-pagination";
  bar.className = "optimized-pagination";
  bar.innerHTML = `
    <div class="optimized-pagination-info">
      <strong id="optimized-page-label">1 / 1 페이지</strong>
      <span>서버가 현재 페이지 데이터만 불러옵니다.</span>
    </div>
    <div class="optimized-pagination-actions">
      <label>페이지당 <select id="optimized-page-size"><option value="25" selected>25</option><option value="50">50</option><option value="100">100</option></select></label>
      <button id="optimized-page-first" class="button button-ghost" type="button">처음</button>
      <button id="optimized-page-prev" class="button button-ghost" type="button">이전</button>
      <button id="optimized-page-next" class="button button-ghost" type="button">다음</button>
      <button id="optimized-page-last" class="button button-ghost" type="button">마지막</button>
    </div>
  `;
  if (emptyState) emptyState.after(bar);
  else workspace.append(bar);
  document.querySelector("#optimized-page-first")?.addEventListener("click", () => goToPage(1));
  document.querySelector("#optimized-page-prev")?.addEventListener("click", () => goToPage(state.page - 1));
  document.querySelector("#optimized-page-next")?.addEventListener("click", () => goToPage(state.page + 1));
  document.querySelector("#optimized-page-last")?.addEventListener("click", () => goToPage(state.pageCount));
  document.querySelector("#optimized-page-size")?.addEventListener("change", (event) => {
    state.pageSize = Number(event.target.value) || DEFAULT_PAGE_SIZE;
    state.page = 1;
    void loadPage();
  });
}

function goToPage(page) {
  const next = Math.max(1, Math.min(state.pageCount, page));
  if (next === state.page) return;
  state.page = next;
  clearSelection();
  void loadPage();
}

function installBulkControls() {
  const controls = document.querySelector(".bulk-controls");
  if (!controls) return;
  if (!document.querySelector("#optimized-product-flow-batch")) {
    const flow = document.createElement("button");
    flow.id = "optimized-product-flow-batch";
    flow.type = "button";
    flow.className = "button button-primary";
    flow.textContent = "선택 상품을 출시플로우로 등록 진행";
    flow.disabled = true;
    flow.addEventListener("click", () => void handoffSelectedToProductLaunchFlow());
    controls.prepend(flow);
  }
  if (!document.querySelector("#optimized-bulk-add")) {
    const add = document.createElement("button");
    add.id = "optimized-bulk-add";
    add.type = "button";
    add.className = "button button-ghost";
    add.textContent = "엑셀 대량 추가";
    add.addEventListener("click", () => {
      elements.addForm?.reset();
      updatePastePreview();
      elements.addDialog?.showModal();
    });
    controls.append(add);
  }
  if (!document.querySelector("#optimized-delete-selected")) {
    const remove = document.createElement("button");
    remove.id = "optimized-delete-selected";
    remove.type = "button";
    remove.className = "button button-danger";
    remove.textContent = "선택 삭제";
    remove.disabled = true;
    remove.addEventListener("click", () => void deleteSelected());
    controls.append(remove);
  }
}

function renderSourceMeta() {
  if (!elements.sourceMeta) return;
  const date = state.sourceImportedAt ? formatDateTime(state.sourceImportedAt) : "서버 저장본";
  elements.sourceMeta.textContent = `${date} · 전체 ${number(state.total)}건 · 페이지당 ${number(state.pageSize)}건`;
}

function schedulePageRefresh() {
  window.clearTimeout(state.refreshTimer);
  state.refreshTimer = window.setTimeout(() => {
    if (document.activeElement?.matches?.(EDITABLE_SELECTOR)) {
      schedulePageRefresh();
      return;
    }
    void loadPage({ silent: true });
  }, PAGE_REFRESH_DELAY_MS);
}

function setLoading(loading, silent) {
  document.body.classList.toggle("optimized-table-loading", loading);
  if (loading && !silent && elements.tableBody && !state.items.length) {
    elements.tableBody.innerHTML = Array.from(
      { length: 6 },
      () => `<tr class="optimized-skeleton-row"><td colspan="16"><span></span></td></tr>`,
    ).join("");
  }
}

function setSaveStatus(message) {
  if (elements.saveStatus) elements.saveStatus.textContent = message;
}

async function requestJson(url, init = {}) {
  const { headers = {}, ...rest } = init;
  const response = await fetch(url, {
    credentials: "same-origin",
    ...rest,
    headers: { Accept: "application/json", ...headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok !== true) {
    throw new Error(body?.message || `요청에 실패했습니다. status=${response.status}`);
  }
  return body;
}

function parseOptionLabels(value) {
  return [...new Set(String(value ?? "").split(/[,/\n]+/).map((entry) => entry.trim()).filter(Boolean))];
}

function splitLines(value) {
  return String(value ?? "")
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeLocationCode(value) {
  return String(value ?? "").trim().replace(/\s+/g, "").toUpperCase();
}

function safeJsonParse(value) {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function deepEqual(left, right) {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return left === right;
  }
}

function number(value) {
  return new Intl.NumberFormat("ko-KR").format(Number(value) || 0);
}

function won(value) {
  return `${number(Math.ceil(Number(value) || 0))}원`;
}

function formatDateTime(value) {
  try {
    return new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "short" }).format(
      new Date(value),
    );
  } catch {
    return String(value ?? "");
  }
}

function dateStamp() {
  const date = new Date();
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("");
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

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function cssEscape(value) {
  return window.CSS?.escape ? window.CSS.escape(String(value)) : String(value).replace(/["\\]/g, "\\$&");
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

function showToast(message) {
  if (!elements.toast) return;
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  toastTimer = window.setTimeout(() => {
    if (elements.toast.textContent === message) elements.toast.hidden = true;
  }, 3_200);
}

function installStyles() {
  if (document.querySelector("#optimized-product-launch-styles")) return;
  const style = document.createElement("style");
  style.id = "optimized-product-launch-styles";
  style.textContent = `
    .optimized-pagination { display:flex; align-items:center; justify-content:space-between; gap:14px; flex-wrap:wrap; padding:14px 16px; border-top:1px solid #e2e8f0; background:#f8fafc; }
    .optimized-pagination-info { display:grid; gap:3px; color:#334155; }
    .optimized-pagination-info span { font-size:11px; color:#64748b; font-weight:700; }
    .optimized-pagination-actions { display:flex; align-items:center; gap:7px; flex-wrap:wrap; }
    .optimized-pagination-actions label { display:flex; align-items:center; gap:5px; font-size:12px; font-weight:800; color:#475569; }
    .optimized-pagination-actions select { min-height:36px; border:1px solid #cbd5e1; border-radius:8px; background:#fff; padding:0 8px; }
    .optimized-row-number { display:inline-block; margin-right:7px; border-radius:999px; background:#eef2ff; color:#3730a3; padding:2px 7px; font-size:10px; font-weight:900; font-variant-numeric:tabular-nums; }
    .optimized-inline-input { box-sizing:border-box; width:100%; min-width:0; border:1px solid transparent; border-radius:8px; background:transparent; padding:7px 8px; color:inherit; font:inherit; font-weight:700; }
    .optimized-inline-input:hover { border-color:#cbd5e1; background:#fff; }
    .optimized-inline-input:focus { outline:none; border-color:#2563eb; background:#fff; box-shadow:0 0 0 3px rgba(37,99,235,.14); }
    .optimized-inline-input.is-saving { border-color:#60a5fa; background:#eff6ff; }
    .optimized-inline-input.is-saved { border-color:#22c55e; background:#f0fdf4; }
    .optimized-inline-input.is-error { border-color:#ef4444; background:#fef2f2; }
    [data-column-key="barcode"] { min-width:270px; vertical-align:top; text-align:left; }
    .inline-option-location-list { display:grid; gap:6px; margin-top:8px; padding-top:8px; border-top:1px dashed #cbd5e1; }
    .inline-option-location-title { color:#475569; font-size:11px; font-weight:900; }
    .inline-option-location-row { display:grid; grid-template-columns:minmax(108px,1fr) minmax(94px,112px); gap:7px; align-items:center; }
    .inline-option-location-label { grid-column:1; grid-row:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#334155; font-size:11px; font-weight:800; }
    .inline-option-location-input { grid-column:2; grid-row:1; width:112px; border:1px solid #94a3b8; border-radius:7px; background:#fff; padding:6px 7px; font-size:11px; font-weight:800; text-transform:uppercase; }
    .inline-option-location-input[data-empty="true"] { border-color:#f97316; background:#fff7ed; }
    .category-ai-suggestion-badge { margin:4px 0 0 4px; border:1px solid #f59e0b; border-radius:999px; background:#fffbeb; color:#92400e; padding:2px 7px; font-size:10px; font-weight:800; }
    .optimized-china-link-list { display:grid; gap:10px; margin-top:14px; }
    .optimized-china-link-row { display:grid; grid-template-columns:minmax(105px,140px) minmax(260px,1fr) auto auto; gap:8px; align-items:center; }
    .optimized-china-link-number { font-size:12px; font-weight:900; color:#475569; }
    .optimized-china-link-number.is-primary { color:#1d4ed8; }
    .optimized-china-link-input { width:100%; min-width:0; border:1px solid #cbd5e1; border-radius:10px; padding:10px 12px; font-size:13px; background:#fff; }
    .optimized-china-link-input:focus { outline:2px solid #bfdbfe; border-color:#2563eb; }
    .optimized-china-link-action { white-space:nowrap; border:1px solid #cbd5e1; border-radius:9px; background:#fff; padding:9px 11px; font-size:12px; font-weight:800; cursor:pointer; }
    .optimized-china-link-action.is-primary { border-color:#93c5fd; background:#eff6ff; color:#1d4ed8; }
    .optimized-china-link-action:disabled { opacity:.45; cursor:not-allowed; }
    .optimized-china-link-status { font-size:12px; font-weight:800; color:#64748b; }
    .optimized-china-link-status[data-tone="dirty"] { color:#b45309; }
    .optimized-china-link-status[data-tone="error"] { color:#b91c1c; }
    .optimized-skeleton-row td { padding:14px; }
    .optimized-skeleton-row span { display:block; height:24px; border-radius:8px; background:linear-gradient(90deg,#f1f5f9,#e2e8f0,#f1f5f9); background-size:200% 100%; animation:optimizedSkeleton 1.1s linear infinite; }
    @keyframes optimizedSkeleton { to { background-position:-200% 0; } }
    .optimized-table-loading .table-wrap { cursor:progress; }
    #detail-form.is-loading-detail > *:not(.dialog-header) { opacity:.35; pointer-events:none; }
    @media (max-width:900px) { .optimized-pagination { align-items:flex-start; } }
  `;
  document.head.append(style);
}
