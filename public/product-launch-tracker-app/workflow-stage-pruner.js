const LEGACY_STAGE_KEYS = new Set([
  "priceKeyword",
  "marketRegistration",
  "orderMapping",
  "inventoryReflection",
]);
const LEGACY_STAGE_LABELS = new Set([
  "가격·키워드",
  "마켓 등록",
  "주문 매핑",
  "재고 반영",
]);
const WORKFLOW_API_PATHS = new Set([
  "/api/product-launch-tracker/optimized",
  "/api/product-launch-tracker/normalized-optimized",
]);

let installed = false;
let originalFetch = null;
let pruneQueued = false;

export function installTwoStageProductLaunchWorkflow() {
  if (installed) return;
  installed = true;
  document.documentElement.dataset.productLaunchActiveStages = "detailPage,shoplingUpload";
  installMutationDecorator();
  pruneNow();

  const observer = new MutationObserver(queuePrune);
  for (const target of [
    document.querySelector("#launch-table-head"),
    document.querySelector("#launch-table-body"),
    document.querySelector("#bulk-stage"),
    document.querySelector("#detail-stages"),
  ]) {
    if (target) observer.observe(target, { childList: true, subtree: true });
  }

  window.addEventListener("product-launch-tracker:page-loaded", queuePrune);
  window.addEventListener("pagehide", () => observer.disconnect(), { once: true });
}

function queuePrune() {
  if (pruneQueued) return;
  pruneQueued = true;
  queueMicrotask(() => {
    pruneQueued = false;
    pruneNow();
  });
}

function pruneNow() {
  pruneHeader();
  pruneRows();
  pruneBulkStageOptions();
  pruneDetailStageEditors();
  rewriteProgressLabels();
}

function pruneHeader() {
  const head = document.querySelector("#launch-table-head");
  if (!head) return;
  for (const key of LEGACY_STAGE_KEYS) {
    head.querySelector(`th[data-sort-key="${key}"]`)?.remove();
  }
}

function pruneRows() {
  const body = document.querySelector("#launch-table-body");
  if (!body) return;
  for (const row of body.rows) pruneLegacyWorkflowRow(row);
}

export function pruneLegacyWorkflowRow(row) {
  for (const cell of [...row.cells]) {
    const key = cell.dataset.columnKey || cell.querySelector("[data-stage]")?.dataset.stage;
    if (LEGACY_STAGE_KEYS.has(key)) cell.remove();
  }
}

function pruneBulkStageOptions() {
  const select = document.querySelector("#bulk-stage");
  if (!(select instanceof HTMLSelectElement)) return;
  for (const option of [...select.options]) {
    if (LEGACY_STAGE_KEYS.has(option.value)) option.remove();
  }
  if (LEGACY_STAGE_KEYS.has(select.value)) select.value = "detailPage";
}

function pruneDetailStageEditors() {
  const host = document.querySelector("#detail-stages");
  if (!host) return;
  for (const control of host.querySelectorAll("[data-stage]")) {
    const key = String(control.getAttribute("data-stage") || "");
    if (!LEGACY_STAGE_KEYS.has(key)) continue;
    const row =
      control.closest(".stage-row") ||
      control.closest(".stage-editor-row") ||
      control.closest(".stage-item") ||
      control.closest("label") ||
      control.parentElement;
    if (row && row !== host) row.remove();
  }

  for (const element of [...host.children]) {
    const text = String(element.textContent || "").trim();
    if ([...LEGACY_STAGE_LABELS].some((label) => text.includes(label))) {
      element.remove();
    }
  }
}

function rewriteProgressLabels() {
  for (const node of document.querySelectorAll(".progress-text")) {
    const text = String(node.textContent || "");
    const match = text.match(/(\d+)\s*\/\s*6/);
    if (!match) continue;
    const completed = Math.max(0, Math.min(2, Number(match[1]) - 4));
    node.textContent = text.replace(match[0], `${completed}/2`);
  }
}

function installMutationDecorator() {
  if (originalFetch) return;
  originalFetch = window.fetch.bind(window);
  window.fetch = async function commerceTwoStageWorkflowFetch(input, init = {}) {
    const request = input instanceof Request ? input : null;
    const method = String(init.method || request?.method || "GET").toUpperCase();
    const url = new URL(request?.url || String(input), window.location.href);
    if (
      method !== "PATCH" ||
      url.origin !== window.location.origin ||
      !WORKFLOW_API_PATHS.has(url.pathname) ||
      typeof init.body !== "string"
    ) {
      return originalFetch(input, init);
    }

    let payload;
    try {
      payload = JSON.parse(init.body);
    } catch {
      return originalFetch(input, init);
    }
    const decorated = decorateMutation(payload);
    return originalFetch(input, { ...init, body: JSON.stringify(decorated) });
  };
}

function decorateMutation(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  if (payload.operation === "create_items" && Array.isArray(payload.items)) {
    return { ...payload, items: payload.items.map(withLegacyStagesExcluded) };
  }
  if (payload.operation === "replace_item" && payload.item && typeof payload.item === "object") {
    return { ...payload, item: withLegacyStagesExcluded(payload.item) };
  }
  return payload;
}

function withLegacyStagesExcluded(item) {
  const currentStages = item?.stages && typeof item.stages === "object" && !Array.isArray(item.stages)
    ? item.stages
    : {};
  const stages = { ...currentStages };
  for (const key of LEGACY_STAGE_KEYS) {
    const current = stages[key] && typeof stages[key] === "object" ? stages[key] : {};
    stages[key] = {
      ...current,
      status: "제외",
      note: current.note || "활성 상품출시 워크플로에서 제거된 과거 단계",
    };
  }
  return { ...item, stages };
}
