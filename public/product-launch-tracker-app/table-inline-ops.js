import {
  alignTableRow,
  applyInlineOptionLabels,
  DEFAULT_TABLE_COLUMN_ORDER,
  frozenColumnKeys,
  moveColumn,
  normalizeColumnOrder,
  parseInlineOptionLabels,
  TABLE_COLUMN_DEFINITIONS,
} from "./lib/table-inline-ops.mjs";

const TRACKER_STORAGE_KEY = "commerce-os-product-launch-tracker:v2";
const TRACKER_STATE_ENDPOINT = "/api/product-launch-tracker/state";
const COLUMN_LAYOUT_KEY = "commerce-os-product-launch-tracker:column-layout:v1";
const tableHead = document.querySelector("#launch-table-head");
const tableBody = document.querySelector("#launch-table-body");
const bulkControls = document.querySelector(".bulk-controls");
const detailDialog = document.querySelector("#detail-dialog");
const detailForm = document.querySelector("#detail-form");
const addOptionButton = document.querySelector("#add-option-button");
const detailOptions = document.querySelector("#detail-options");
const chinaSyncButton = document.querySelector("#china-sync-button");
let layout = readColumnLayout();
let enhanceQueued = false;
let applyingLayout = false;
let draggedColumnKey = "";
let bulkChinaSyncButton = null;
let freezeSelect = null;
const inlineBusyItems = new Set();

installStyles();
installTableOperationControls();
queueEnhanceTable();

if (tableHead) {
  const observer = new MutationObserver(queueEnhanceTable);
  observer.observe(tableHead, { childList: true, subtree: true });
}
if (tableBody) {
  const observer = new MutationObserver(() => {
    queueEnhanceTable();
    syncBulkChinaButton();
  });
  observer.observe(tableBody, { childList: true, subtree: true });
}

document.addEventListener(
  "change",
  (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.type !== "checkbox") return;
    if (target.id === "select-visible" || target.closest("#launch-table-body")) {
      window.setTimeout(syncBulkChinaButton, 0);
    }
  },
  true,
);

window.addEventListener("resize", () => queueEnhanceTable());

function installStyles() {
  if (document.querySelector("#table-inline-ops-styles")) return;
  const style = document.createElement("style");
  style.id = "table-inline-ops-styles";
  style.textContent = `
    .inline-table-editor {
      box-sizing: border-box;
      width: 100%;
      min-width: 150px;
      border: 1px solid #cbd5e1;
      border-radius: 7px;
      background: #fff;
      padding: 7px 8px;
      font: inherit;
      color: #0f172a;
    }
    .inline-table-editor:focus {
      outline: 2px solid #93c5fd;
      border-color: #2563eb;
    }
    .inline-table-editor[disabled] { opacity: .55; cursor: wait; }
    .column-drag-handle {
      display: inline-flex;
      margin-left: 5px;
      padding: 2px 3px;
      border-radius: 4px;
      color: #64748b;
      cursor: grab;
      user-select: none;
      vertical-align: middle;
    }
    .column-drag-handle:active { cursor: grabbing; background: #dbeafe; }
    th.column-drag-over { box-shadow: inset 3px 0 0 #2563eb; }
    .table-layout-controls {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      flex-wrap: wrap;
      padding-left: 4px;
    }
    .table-layout-controls label {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 12px;
      font-weight: 800;
      color: #334155;
    }
    .table-layout-controls select {
      min-height: 36px;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      background: #fff;
      padding: 0 8px;
      font: inherit;
    }
    .table-layout-hint { font-size: 11px; color: #64748b; font-weight: 700; }
    .is-frozen-table-column { background: #fff !important; }
    th.is-frozen-table-column { background: #eef4ff !important; }
    .is-last-frozen-table-column { box-shadow: 4px 0 8px rgba(15, 23, 42, .13); }
    #detail-dialog.inline-table-save-hidden { visibility: hidden !important; }
  `;
  document.head.append(style);
}

function installTableOperationControls() {
  if (!bulkControls) return;

  if (!bulkControls.querySelector("#bulk-china-order-sync-button")) {
    const button = document.createElement("button");
    button.id = "bulk-china-order-sync-button";
    button.type = "button";
    button.className = "button button-secondary";
    button.textContent = "선택 발주·입고 불러오기";
    button.title = "체크한 상품의 옵션·바코드·원가·기준 판매가를 일괄 불러옵니다.";
    button.addEventListener("click", () => void syncSelectedChinaOrderData(button));
    const clearButton = bulkControls.querySelector("#clear-selection-button");
    if (clearButton) clearButton.before(button);
    else bulkControls.append(button);
    bulkChinaSyncButton = button;
  } else {
    bulkChinaSyncButton = bulkControls.querySelector("#bulk-china-order-sync-button");
  }

  if (!bulkControls.querySelector("#table-layout-controls")) {
    const controls = document.createElement("div");
    controls.id = "table-layout-controls";
    controls.className = "table-layout-controls";

    const label = document.createElement("label");
    label.append(document.createTextNode("열 고정"));
    const select = document.createElement("select");
    select.id = "freeze-through-column";
    select.setAttribute("aria-label", "어느 열까지 고정할지 선택");
    label.append(select);
    freezeSelect = select;

    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "button button-ghost";
    reset.textContent = "열 순서 초기화";
    reset.addEventListener("click", () => {
      layout = { order: [...DEFAULT_TABLE_COLUMN_ORDER], frozenThrough: "" };
      saveColumnLayout();
      renderFreezeOptions();
      queueEnhanceTable();
    });

    const hint = document.createElement("span");
    hint.className = "table-layout-hint";
    hint.textContent = "열 제목의 ⠿를 드래그해 순서 변경";

    select.addEventListener("change", () => {
      layout.frozenThrough = select.value;
      saveColumnLayout();
      queueEnhanceTable();
    });

    controls.append(label, reset, hint);
    bulkControls.append(controls);
  } else {
    freezeSelect = bulkControls.querySelector("#freeze-through-column");
  }

  renderFreezeOptions();
  syncBulkChinaButton();
}

function renderFreezeOptions() {
  if (!freezeSelect) return;
  const definitions = new Map(
    TABLE_COLUMN_DEFINITIONS.map((column) => [column.key, column]),
  );
  const current = layout.frozenThrough;
  freezeSelect.innerHTML = [
    '<option value="">고정 안 함</option>',
    ...layout.order.map((key) => {
      const label = definitions.get(key)?.label ?? key;
      return `<option value="${escapeAttribute(key)}">${escapeHtml(label)}까지</option>`;
    }),
  ].join("");
  freezeSelect.value = layout.order.includes(current) ? current : "";
}

function queueEnhanceTable() {
  if (enhanceQueued) return;
  enhanceQueued = true;
  window.requestAnimationFrame(() => {
    enhanceQueued = false;
    enhanceTable();
  });
}

function enhanceTable() {
  if (applyingLayout || !tableHead || !tableBody) return;
  applyingLayout = true;
  try {
    assignColumnKeys();
    applyColumnOrder();
    installHeaderDragHandles();
    installInlineEditors();
    applyFrozenColumns();
  } finally {
    applyingLayout = false;
  }
}

function assignColumnKeys() {
  const headRow = tableHead.querySelector("tr");
  if (headRow) {
    [...headRow.children].forEach((cell, index) => {
      if (!cell.dataset.columnKey) {
        cell.dataset.columnKey = cell.dataset.sortKey ?? DEFAULT_TABLE_COLUMN_ORDER[index] ?? `unknown-${index}`;
      }
    });
  }
  for (const row of renderableTableRows()) {
    [...row.children].forEach((cell, index) => {
      if (!cell.dataset.columnKey) {
        cell.dataset.columnKey = DEFAULT_TABLE_COLUMN_ORDER[index] ?? `unknown-${index}`;
      }
    });
  }
}

function renderableTableRows() {
  return tableBody.querySelectorAll("tr[data-id], tr.master-core-fallback-row, tr.startup-cache-row");
}

function applyColumnOrder() {
  const order = normalizeColumnOrder(layout.order);
  layout.order = order;
  const rows = [tableHead.querySelector("tr"), ...renderableTableRows()].filter(Boolean);
  for (const row of rows) alignTableRow(row, order);
}

function installHeaderDragHandles() {
  const headRow = tableHead.querySelector("tr");
  if (!headRow) return;
  for (const header of headRow.children) {
    const key = header.dataset.columnKey;
    if (!key || key === "select") continue;
    if (!header.querySelector(".column-drag-handle")) {
      const handle = document.createElement("span");
      handle.className = "column-drag-handle";
      handle.textContent = "⠿";
      handle.title = "드래그하여 열 순서 변경";
      handle.draggable = true;
      handle.addEventListener("dragstart", (event) => {
        draggedColumnKey = key;
        event.dataTransfer?.setData("text/plain", key);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      });
      handle.addEventListener("dragend", () => {
        draggedColumnKey = "";
        clearDragOverHeaders();
      });
      header.append(handle);
    }
    if (header.dataset.columnDropBound !== "true") {
      header.dataset.columnDropBound = "true";
      header.addEventListener("dragover", (event) => {
        if (!draggedColumnKey) return;
        event.preventDefault();
        clearDragOverHeaders();
        header.classList.add("column-drag-over");
      });
      header.addEventListener("dragleave", () => header.classList.remove("column-drag-over"));
      header.addEventListener("drop", (event) => {
        event.preventDefault();
        const source = draggedColumnKey || event.dataTransfer?.getData("text/plain") || "";
        const target = header.dataset.columnKey || "";
        clearDragOverHeaders();
        const next = moveColumn(layout.order, source, target);
        if (next.join("|") === layout.order.join("|")) return;
        layout.order = next;
        saveColumnLayout();
        renderFreezeOptions();
        queueEnhanceTable();
      });
    }
  }
}

function clearDragOverHeaders() {
  for (const header of tableHead?.querySelectorAll(".column-drag-over") ?? []) {
    header.classList.remove("column-drag-over");
  }
}

function installInlineEditors() {
  const trackerState = readTrackerState();
  const items = Array.isArray(trackerState?.items) ? trackerState.items : [];
  const itemById = new Map(items.map((item) => [String(item?.id ?? ""), item]));

  for (const row of tableBody.querySelectorAll("tr[data-id]")) {
    const itemId = String(row.dataset.id ?? "");
    const item = itemById.get(itemId);
    if (!item) continue;

    const categoryCell = row.querySelector("[data-column-key='shoplingCategory']");
    if (categoryCell && !categoryCell.querySelector(".inline-category-editor")) {
      const input = document.createElement("input");
      input.className = "inline-table-editor inline-category-editor";
      input.value = String(item.shoplingCategory ?? "");
      input.placeholder = "샵플링 표준 카테고리";
      input.title = "수정 후 Enter 또는 바깥을 클릭하면 저장됩니다.";
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          input.blur();
        }
      });
      input.addEventListener("change", () =>
        void saveInlineThroughDetail(itemId, "category", input.value, input),
      );
      categoryCell.replaceChildren(input);
    }

    const optionsCell = row.querySelector("[data-column-key='options']");
    if (optionsCell && !optionsCell.querySelector(".inline-options-editor")) {
      const input = document.createElement("input");
      input.className = "inline-table-editor inline-options-editor";
      input.value = (Array.isArray(item.orderOptions) ? item.orderOptions : [])
        .map((option) => String(option?.saleOption ?? "").trim())
        .filter(Boolean)
        .join(", ");
      input.placeholder = "단품 또는 옵션1, 옵션2";
      input.title = "쉼표로 구분합니다. 기존 옵션의 바코드·가격은 같은 순서로 유지됩니다.";
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          input.blur();
        }
      });
      input.addEventListener("change", () =>
        void saveInlineThroughDetail(itemId, "options", input.value, input),
      );
      optionsCell.replaceChildren(input);
    }
  }
}

async function saveInlineThroughDetail(itemId, field, rawValue, input) {
  if (inlineBusyItems.has(itemId) || !detailDialog || !detailForm) return;
  const state = readTrackerState();
  const item = state?.items?.find((candidate) => String(candidate?.id ?? "") === itemId);
  if (!item) return;

  if (field === "category" && String(item.shoplingCategory ?? "") === String(rawValue).trim()) {
    return;
  }
  const labels = field === "options" ? parseInlineOptionLabels(rawValue) : [];
  const currentLabels = (Array.isArray(item.orderOptions) ? item.orderOptions : [])
    .map((option) => String(option?.saleOption ?? "").trim())
    .filter(Boolean);
  if (field === "options" && labels.join("|") === currentLabels.join("|")) return;

  const row = tableBody.querySelector(`tr[data-id="${cssEscape(itemId)}"]`);
  const detailButton = row?.querySelector("button[data-action='detail']");
  if (!detailButton) {
    showOpsMessage("상세 저장 기능을 찾지 못했습니다.");
    return;
  }

  inlineBusyItems.add(itemId);
  input.disabled = true;
  detailDialog.classList.add("inline-table-save-hidden");
  try {
    detailButton.click();
    await waitFor(
      () => detailDialog.open && String(detailForm.elements.id?.value ?? "") === itemId,
      1600,
    );

    if (field === "category") {
      detailForm.elements.shoplingCategory.value = String(rawValue).trim();
    } else {
      await setDetailOptionLabels(labels);
    }

    const saveButton = detailForm.querySelector("button[value='save']");
    if (!(saveButton instanceof HTMLButtonElement)) {
      throw new Error("상세 저장 버튼을 찾지 못했습니다.");
    }
    detailForm.requestSubmit(saveButton);
    await waitFor(() => !detailDialog.open, 1600);
    showOpsMessage(
      field === "category"
        ? `${item.modelNumber} 카테고리를 저장했습니다.`
        : `${item.modelNumber} 옵션을 저장했습니다.`,
    );
  } catch (error) {
    console.error(error);
    if (detailDialog.open) detailDialog.close();
    showOpsMessage(
      error instanceof Error ? error.message : "표에서 입력한 값을 저장하지 못했습니다.",
    );
    input.disabled = false;
  } finally {
    detailDialog.classList.remove("inline-table-save-hidden");
    inlineBusyItems.delete(itemId);
  }
}

async function setDetailOptionLabels(labels) {
  if (!detailOptions || !addOptionButton) {
    throw new Error("상세 옵션 입력 기능을 찾지 못했습니다.");
  }
  let rows = [...detailOptions.querySelectorAll("tr[data-option-index]")];
  while (rows.length < labels.length) {
    addOptionButton.click();
    await nextFrame();
    rows = [...detailOptions.querySelectorAll("tr[data-option-index]")];
  }
  while (rows.length > labels.length) {
    const remove = rows.at(-1)?.querySelector("button[data-action='remove-option']");
    if (!(remove instanceof HTMLButtonElement)) break;
    remove.click();
    await nextFrame();
    rows = [...detailOptions.querySelectorAll("tr[data-option-index]")];
  }
  rows.forEach((row, index) => {
    const saleOption = row.querySelector("[data-field='saleOption']");
    if (saleOption instanceof HTMLInputElement) saleOption.value = labels[index] ?? "";
  });
}

function applyFrozenColumns() {
  const headRow = tableHead.querySelector("tr");
  if (!headRow) return;
  const rows = [headRow, ...tableBody.querySelectorAll("tr[data-id]")];
  for (const row of rows) {
    for (const cell of row.children) {
      cell.classList.remove("is-frozen-table-column", "is-last-frozen-table-column");
      cell.style.removeProperty("position");
      cell.style.removeProperty("left");
      cell.style.removeProperty("z-index");
    }
  }

  const frozenKeys = frozenColumnKeys(layout.order, layout.frozenThrough);
  if (!frozenKeys.length) return;
  let left = 0;
  for (const key of frozenKeys) {
    const header = headRow.querySelector(`[data-column-key='${cssEscape(key)}']`);
    if (!header) continue;
    const width = Math.max(1, Math.ceil(header.getBoundingClientRect().width));
    for (const row of rows) {
      const cell = row.querySelector(`[data-column-key='${cssEscape(key)}']`);
      if (!cell) continue;
      cell.classList.add("is-frozen-table-column");
      cell.style.position = "sticky";
      cell.style.left = `${left}px`;
      cell.style.zIndex = row === headRow ? "9" : "4";
    }
    left += width;
  }
  const lastKey = frozenKeys.at(-1);
  for (const row of rows) {
    row.querySelector(`[data-column-key='${cssEscape(lastKey)}']`)?.classList.add(
      "is-last-frozen-table-column",
    );
  }
}

function syncBulkChinaButton() {
  if (!bulkChinaSyncButton) return;
  const selectedCount = selectedRowIds().length;
  bulkChinaSyncButton.disabled = selectedCount === 0;
  bulkChinaSyncButton.textContent = selectedCount
    ? `선택 발주·입고 불러오기 (${selectedCount}건)`
    : "선택 발주·입고 불러오기";
}

async function syncSelectedChinaOrderData(button) {
  const selectedIds = selectedRowIds();
  if (!selectedIds.length) {
    showOpsMessage("발주·입고 데이터를 불러올 상품을 먼저 체크하세요.");
    return;
  }
  if (
    !window.confirm(
      `선택한 ${selectedIds.length}개 상품의 발주·입고 옵션·바코드·원가·기준 판매가를 불러올까요?`,
    )
  ) {
    return;
  }

  const trackerState = readTrackerState();
  if (!trackerState || !Array.isArray(trackerState.items)) {
    showOpsMessage("진행관리 저장본을 찾지 못했습니다.");
    return;
  }
  const itemById = new Map(
    trackerState.items.map((item) => [String(item?.id ?? ""), item]),
  );
  const targets = selectedIds.map((id) => itemById.get(id)).filter(Boolean);
  if (!targets.length) return;

  const previousText = button.textContent;
  button.disabled = true;
  let completed = 0;
  const successes = [];
  const failures = [];
  try {
    await runWithConcurrency(targets, 3, async (item) => {
      try {
        const result = await fetchChinaOrderOptions(item);
        successes.push({ item, result });
      } catch (error) {
        failures.push({
          item,
          message: error instanceof Error ? error.message : "불러오기 실패",
        });
      } finally {
        completed += 1;
        button.textContent = `발주·입고 불러오는 중 ${completed}/${targets.length}`;
      }
    });

    if (successes.length) {
      const now = new Date().toISOString();
      const resultById = new Map(
        successes.map(({ item, result }) => [String(item.id), result]),
      );
      const nextState = {
        ...trackerState,
        savedAt: now,
        items: trackerState.items.map((item) => {
          const result = resultById.get(String(item?.id ?? ""));
          if (!result) return item;
          const orderOptions = applyInlineOptionLabels(result.options, result.options.map((option) => option.saleOption));
          return {
            ...item,
            options: orderOptions.map((option) => option.saleOption).filter(Boolean),
            orderOptions,
            chinaOrderLink: {
              status: "linked",
              batchId: result.batchId ?? item?.chinaOrderLink?.batchId ?? null,
              syncedAt: result.syncedAt ?? now,
              message: "목록 선택 일괄 불러오기",
            },
            updatedAt: now,
            updatedBy: "발주·입고 일괄 불러오기",
          };
        }),
      };
      await saveTrackerState(nextState);
      localStorage.setItem(TRACKER_STORAGE_KEY, JSON.stringify(nextState));
    }

    const failedSummary = failures
      .slice(0, 8)
      .map(({ item, message }) => `${item.modelNumber || item.id}: ${message}`)
      .join("\n");
    window.alert(
      [
        `발주·입고 데이터 불러오기 완료`,
        `성공 ${successes.length}건 · 실패 ${failures.length}건`,
        failedSummary ? `\n실패 사유\n${failedSummary}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
    if (successes.length) window.location.reload();
  } catch (error) {
    console.error(error);
    showOpsMessage(
      error instanceof Error ? error.message : "일괄 불러오기를 완료하지 못했습니다.",
    );
  } finally {
    button.disabled = false;
    button.textContent = previousText;
    syncBulkChinaButton();
  }
}

async function fetchChinaOrderOptions(item) {
  const barcode = String(item?.barcode ?? "").trim().toUpperCase();
  const modelNumber = String(item?.modelNumber ?? "").trim().toUpperCase();
  if (!barcode && !modelNumber) throw new Error("기준 바코드 또는 모델번호가 없습니다.");
  const params = new URLSearchParams({ barcode, modelNumber });
  const response = await fetch(
    `/api/product-launch-tracker/china-order-options?${params.toString()}`,
    { cache: "no-store", credentials: "same-origin" },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok !== true || !Array.isArray(body.options)) {
    throw new Error(body?.message || `응답 오류 ${response.status}`);
  }
  return body;
}

async function saveTrackerState(state) {
  const response = await fetch(TRACKER_STATE_ENDPOINT, {
    method: "PUT",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ state }),
    credentials: "same-origin",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok !== true) {
    throw new Error(body?.message || "진행관리 서버 저장에 실패했습니다.");
  }
}

function selectedRowIds() {
  return [...tableBody.querySelectorAll("tr[data-id]")]
    .filter((row) => row.querySelector("input.row-check:checked"))
    .map((row) => String(row.dataset.id ?? ""))
    .filter(Boolean);
}

async function runWithConcurrency(values, concurrency, worker) {
  let cursor = 0;
  async function run() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      await worker(values[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => run()),
  );
}

function readTrackerState() {
  try {
    const value = localStorage.getItem(TRACKER_STORAGE_KEY);
    const parsed = value ? JSON.parse(value) : null;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function readColumnLayout() {
  try {
    const parsed = JSON.parse(localStorage.getItem(COLUMN_LAYOUT_KEY) ?? "null");
    return {
      order: normalizeColumnOrder(parsed?.order),
      frozenThrough: String(parsed?.frozenThrough ?? ""),
    };
  } catch {
    return { order: [...DEFAULT_TABLE_COLUMN_ORDER], frozenThrough: "" };
  }
}

function saveColumnLayout() {
  localStorage.setItem(
    COLUMN_LAYOUT_KEY,
    JSON.stringify({
      order: normalizeColumnOrder(layout.order),
      frozenThrough: layout.frozenThrough || "",
      updatedAt: new Date().toISOString(),
    }),
  );
}

function showOpsMessage(message) {
  const toast = document.querySelector("#toast");
  if (toast) {
    toast.textContent = message;
    toast.hidden = false;
    window.setTimeout(() => {
      toast.hidden = true;
    }, 3600);
    return;
  }
  window.alert(message);
}

function waitFor(predicate, timeoutMs) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const inspect = () => {
      if (predicate()) {
        resolve(true);
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        reject(new Error("상세 입력 화면 응답이 지연되고 있습니다. 다시 시도하세요."));
        return;
      }
      window.setTimeout(inspect, 25);
    };
    inspect();
  });
}

function nextFrame() {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

function cssEscape(value) {
  return globalThis.CSS?.escape ? CSS.escape(String(value)) : String(value).replaceAll('"', '\\"');
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
