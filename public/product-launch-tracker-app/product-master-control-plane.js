const PRODUCT_MASTER_CORE_API = "/api/product-launch-tracker/product-master-core";
const WORKFLOW_API = "/api/product-launch-tracker/optimized";
const PRODUCT_MASTER_BASE_URL = "https://commerce-os-product-master.vercel.app";
const MASTER_FALLBACK_DELAY_MS = 0;
const MASTER_PAGE_SIZE = 25;
const MASTER_SEARCH_DELAY_MS = 280;
const WORKFLOW_PROBE_TIMEOUT_MS = 4_500;
const WORKFLOW_RECONNECT_DELAYS_MS = [5_000, 10_000, 20_000, 30_000];
const WORKFLOW_CACHE_KEY = "commerce-os-product-launch-workflow-last-known:v1";
const WORKFLOW_CACHE_MAX_ITEMS = 5_000;
const MASTER_DISABLED_SELECTOR = [
  "#batch-filter",
  "#assignee-filter",
  "#overall-filter",
  "#unfinished-only-filter",
  "#bulk-stage",
  "#bulk-status",
  "#bulk-apply-button",
  "#clear-selection-button",
  "#select-visible",
  "#add-items-button",
  "#policy-button",
].join(",");
const WORKFLOW_STAGES = [
  "detailPage",
  "priceKeyword",
  "shoplingUpload",
  "marketRegistration",
  "orderMapping",
  "inventoryReflection",
];

let livePageLoaded = false;
let masterFallbackActive = false;
let masterProducts = [];
let masterPage = 1;
let masterPageCount = 1;
let masterTotal = 0;
let fallbackRequest = null;
let fallbackController = null;
let fallbackRenderGuard = false;
let defaultMasterViewApplied = false;
let masterSearchTimer = null;
let reconnectTimer = null;
let reconnectAttempt = 0;
let reconnectInFlight = false;
let reconnectDueAt = 0;

upgradePageIdentity();
installProductMasterPerformanceStyles();
installProductMasterDetailLink();
installFallbackObserver();
installRecoverySignals();
bindMasterSearch();
scheduleMasterFallback();

window.addEventListener("product-launch-tracker:page-loaded", () => {
  livePageLoaded = true;
  captureWorkflowCache();
  deactivateMasterFallback();
  applyDefaultMasterView();
});

function upgradePageIdentity() {
  document.title = "상품마스터 · 출시관리";
  const title = document.querySelector(".topbar h1");
  if (title) title.textContent = "상품마스터 · 출시관리";
  const subtitle = document.querySelector(".topbar .subtitle");
  if (subtitle) {
    subtitle.textContent =
      "상품 핵심 원장은 Product Master에서 보호하고, 상세페이지·키워드·샵플링·재고 등 출시 Workflow를 한 화면에서 관리합니다.";
  }
  const notice = document.querySelector("main .notice strong");
  if (notice) {
    notice.textContent =
      "이 화면을 Commerce OS 상품마스터 메인 UI로 사용합니다. 상품 핵심 원장과 OPS 실행상태는 분리되어 장애가 서로 전파되지 않도록 운영합니다.";
  }
}

function installProductMasterPerformanceStyles() {
  if (document.querySelector("#product-master-performance-style")) return;
  const style = document.createElement("style");
  style.id = "product-master-performance-style";
  style.textContent = `
    .optimized-table-loading .table-wrap {
      cursor: default !important;
    }
  `;
  document.head.append(style);
}

function installProductMasterDetailLink() {
  const detailForm = document.querySelector("#detail-form");
  const previewButton = document.querySelector("#preview-button");
  if (!detailForm || !previewButton || document.querySelector("#product-master-core-button")) return;

  const button = document.createElement("button");
  button.id = "product-master-core-button";
  button.className = "button button-secondary";
  button.type = "button";
  button.textContent = "상품마스터에서 이 상품 핵심 원장 확인하기";
  previewButton.insertAdjacentElement("beforebegin", button);
  button.addEventListener("click", () => {
    const model = normalizeModelNumber(detailForm.elements?.modelNumber?.value);
    if (!model) {
      window.alert("상품마스터 핵심 원장을 열려면 정확한 AAA 모델번호가 필요합니다.");
      return;
    }
    window.open(productMasterCoreUrl(model), "_blank", "noopener,noreferrer");
  });
}

function installFallbackObserver() {
  const status = document.querySelector("#save-status");
  const body = document.querySelector("#launch-table-body");
  if (!status || !body) return;

  const observer = new MutationObserver(() => {
    if (livePageLoaded) return;
    const statusText = status.textContent || "";
    const bodyText = body.textContent || "";
    if (
      statusText.includes("목록 불러오기 실패") ||
      statusText.includes("목록 응답 지연") ||
      bodyText.includes("목록을 불러오지 못했습니다")
    ) {
      void ensureMasterFallback();
    }
    if (
      masterFallbackActive &&
      !fallbackRenderGuard &&
      bodyText.includes("목록을 불러오지 못했습니다")
    ) {
      renderMasterFallback();
    }
  });
  observer.observe(status, { childList: true, subtree: true, characterData: true });
  observer.observe(body, { childList: true, subtree: true });
}

function installRecoverySignals() {
  window.addEventListener("online", () => {
    if (masterFallbackActive) scheduleWorkflowReconnect(800, true);
  });
  window.addEventListener("focus", (event) => {
    if (!event.isTrusted) return;
    if (masterFallbackActive && document.visibilityState === "visible") {
      scheduleWorkflowReconnect(1_000, true);
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (masterFallbackActive && document.visibilityState === "visible") {
      scheduleWorkflowReconnect(1_000, true);
    }
  });
}

function bindMasterSearch() {
  const search = document.querySelector("#search-input");
  if (!(search instanceof HTMLInputElement) || search.dataset.masterFallbackBound === "true") return;
  search.dataset.masterFallbackBound = "true";
  search.addEventListener("input", () => {
    if (!masterFallbackActive) return;
    window.clearTimeout(masterSearchTimer);
    masterSearchTimer = window.setTimeout(() => {
      masterPage = 1;
      void loadMasterPage();
    }, MASTER_SEARCH_DELAY_MS);
  });
}

function scheduleMasterFallback() {
  window.setTimeout(() => {
    if (!livePageLoaded) void ensureMasterFallback();
  }, MASTER_FALLBACK_DELAY_MS);
}

async function ensureMasterFallback() {
  if (livePageLoaded) return;
  masterFallbackActive = true;
  document.body.dataset.productMasterFallback = "true";
  lockWorkflowWrites(true);
  ensureMasterPager();
  await loadMasterPage();
  if (masterFallbackActive && !livePageLoaded) scheduleWorkflowReconnect();
}

async function loadMasterPage() {
  if (!masterFallbackActive || livePageLoaded) return;
  fallbackController?.abort();
  fallbackController = new AbortController();
  const search = currentMasterSearch();
  const params = new URLSearchParams({
    page: String(masterPage),
    pageSize: String(MASTER_PAGE_SIZE),
    search,
  });
  fallbackRequest = fetch(`${PRODUCT_MASTER_CORE_API}?${params.toString()}`, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    signal: fallbackController.signal,
  });
  try {
    const response = await fallbackRequest;
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok !== true || !Array.isArray(payload.products)) {
      throw new Error(payload?.message || `Product Master 응답 오류 (${response.status})`);
    }
    if (!masterFallbackActive || livePageLoaded) return;
    masterProducts = payload.products;
    masterPage = Math.max(1, Number(payload.page) || 1);
    masterPageCount = Math.max(1, Number(payload.pageCount) || 1);
    masterTotal = Math.max(0, Number(payload.total) || 0);
    renderMasterFallback();
  } catch (error) {
    if (error?.name === "AbortError") return;
    console.error("Product Master fallback failed", error);
    setFallbackStatus("Product Master 재연결 중 · 상품 원장 응답을 기다리는 중");
  } finally {
    fallbackRequest = null;
  }
}

function renderMasterFallback() {
  if (!masterFallbackActive || livePageLoaded) return;
  const body = document.querySelector("#launch-table-body");
  if (!body) return;
  const workflowCache = readWorkflowCache();

  fallbackRenderGuard = true;
  body.innerHTML = masterProducts
    .map((product, index) => renderMasterRow(product, index, workflowCache))
    .join("");
  fallbackRenderGuard = false;
  body.dataset.masterFallback = "true";

  updateReconnectStatus();
  const visibleCount = document.querySelector("#visible-count");
  if (visibleCount) {
    const start = masterTotal ? (masterPage - 1) * MASTER_PAGE_SIZE + 1 : 0;
    const end = Math.min(masterPage * MASTER_PAGE_SIZE, masterTotal);
    visibleCount.textContent = `${formatNumber(masterTotal)}개 상품 · ${formatNumber(start)}-${formatNumber(end)} · 핵심 원장`;
  }
  const selectedCount = document.querySelector("#selected-count");
  if (selectedCount) selectedCount.textContent = "읽기 전용";
  const sourceMeta = document.querySelector("#source-meta");
  if (sourceMeta) sourceMeta.textContent = "Product Master 서버 페이지 · OPS Workflow 백그라운드 재연결";

  renderMasterSummary();
  renderMasterPager();
  bindMasterRowButtons();
}

function renderMasterSummary() {
  const summary = document.querySelector("#summary");
  if (!summary) return;
  const skuCount = masterProducts.reduce(
    (sum, product) => sum + (Array.isArray(product.options) ? product.options.length : 0),
    0,
  );
  const withOptions = masterProducts.filter((product) => (product.options || []).length > 1).length;
  summary.innerHTML = [
    ["핵심 원장 상품", masterTotal],
    ["현재 페이지 SKU", skuCount],
    ["현재 페이지 복수옵션", withOptions],
    ["OPS Workflow", "재연결 중"],
  ]
    .map(
      ([label, value]) =>
        `<article class="summary-card"><span>${escapeHtml(label)}</span><strong>${typeof value === "number" ? formatNumber(value) : escapeHtml(value)}</strong></article>`,
    )
    .join("");
}

function renderMasterRow(product, index, workflowCache) {
  const barcodes = Array.isArray(product.barcodes) ? product.barcodes : [];
  const options = Array.isArray(product.optionLabels) ? product.optionLabels : [];
  const model = normalizeModelNumber(product.modelNumber);
  const cached = model ? workflowCache.items?.[model] : null;
  const barcodeCell = barcodes.length > 1
    ? `<div class="inline-option-location-list"><div class="inline-option-location-title">B-code</div>${barcodes.map((barcode) => `<div class="inline-option-location-row"><strong>${escapeHtml(barcode)}</strong></div>`).join("")}</div>`
    : `<strong>${escapeHtml(barcodes[0] || "미등록")}</strong>`;
  const stageCells = WORKFLOW_STAGES.map((stage) =>
    renderWorkflowStageCell(cached?.stages?.[stage], cached?.savedAt),
  ).join("");
  const rowNumber = (masterPage - 1) * MASTER_PAGE_SIZE + index + 1;
  return `
    <tr data-master-model="${escapeAttribute(model)}" class="master-core-fallback-row">
      <td class="check-column"><input type="checkbox" disabled aria-label="읽기 전용" /></td>
      <td class="cell-truncate"><span class="optimized-row-number">#M${formatNumber(rowNumber)}</span>상품마스터</td>
      <td>${barcodeCell}</td>
      <td><strong>${escapeHtml(model)}</strong></td>
      <td class="product-name"><strong>${escapeHtml(product.productName)}</strong></td>
      <td><span class="sync-status">핵심 원장</span></td>
      <td>${escapeHtml(options.join(", ") || "단품")}</td>
      <td><span class="sync-status">재고 확인 대기</span></td>
      <td><span class="readiness-badge is-ready">원장 확인</span></td>
      ${stageCells}
      <td class="next-stage">OPS 재연결<span class="progress-text">핵심 원장은 정상</span></td>
      <td class="row-actions"><button class="row-action" type="button" data-master-core-model="${escapeAttribute(model)}">핵심 원장</button></td>
    </tr>`;
}

function renderWorkflowStageCell(status, savedAt) {
  const safeStatus = String(status || "").trim();
  if (!safeStatus) {
    return '<td><span class="status-select" style="display:inline-flex;align-items:center;justify-content:center;min-width:72px;pointer-events:none">연결 대기</span></td>';
  }
  return `<td><span class="status-select status-${escapeAttribute(safeStatus.replaceAll(" ", "-"))}" title="마지막 정상 Workflow 상태 · ${escapeAttribute(formatCacheTime(savedAt))}" style="display:inline-flex;align-items:center;justify-content:center;min-width:72px;pointer-events:none">${escapeHtml(safeStatus)}</span></td>`;
}

function ensureMasterPager() {
  if (document.querySelector("#product-master-fallback-pager")) return;
  const visibleCount = document.querySelector("#visible-count");
  const host = visibleCount?.parentElement;
  if (!host) return;
  const pager = document.createElement("span");
  pager.id = "product-master-fallback-pager";
  pager.style.cssText = "display:none;align-items:center;gap:6px;margin-left:10px";
  pager.innerHTML = `
    <button type="button" class="button button-ghost" data-master-page-action="prev">이전</button>
    <strong data-master-page-label></strong>
    <button type="button" class="button button-ghost" data-master-page-action="next">다음</button>`;
  host.append(pager);
  pager.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-master-page-action]");
    if (!button || !masterFallbackActive) return;
    const nextPage = button.dataset.masterPageAction === "prev" ? masterPage - 1 : masterPage + 1;
    if (nextPage < 1 || nextPage > masterPageCount || nextPage === masterPage) return;
    masterPage = nextPage;
    void loadMasterPage();
  });
}

function renderMasterPager() {
  const pager = document.querySelector("#product-master-fallback-pager");
  if (!pager) return;
  pager.style.display = masterFallbackActive ? "inline-flex" : "none";
  const label = pager.querySelector("[data-master-page-label]");
  if (label) label.textContent = `${formatNumber(masterPage)} / ${formatNumber(masterPageCount)} 페이지`;
  const prev = pager.querySelector("[data-master-page-action='prev']");
  const next = pager.querySelector("[data-master-page-action='next']");
  if (prev) prev.disabled = masterPage <= 1;
  if (next) next.disabled = masterPage >= masterPageCount;
}

function bindMasterRowButtons() {
  for (const button of document.querySelectorAll("button[data-master-core-model]")) {
    if (button.dataset.masterBound === "true") continue;
    button.dataset.masterBound = "true";
    button.addEventListener("click", () => {
      const model = normalizeModelNumber(button.dataset.masterCoreModel);
      if (model) window.open(productMasterCoreUrl(model), "_blank", "noopener,noreferrer");
    });
  }
}

function scheduleWorkflowReconnect(delay, reset = false) {
  if (!masterFallbackActive || livePageLoaded) return;
  if (reset) reconnectAttempt = 0;
  window.clearTimeout(reconnectTimer);
  const reconnectDelay = Number.isFinite(delay)
    ? delay
    : WORKFLOW_RECONNECT_DELAYS_MS[
        Math.min(reconnectAttempt, WORKFLOW_RECONNECT_DELAYS_MS.length - 1)
      ];
  reconnectDueAt = Date.now() + reconnectDelay;
  reconnectTimer = window.setTimeout(() => void probeWorkflow(), reconnectDelay);
  updateReconnectStatus();
}

async function probeWorkflow() {
  if (!masterFallbackActive || livePageLoaded || reconnectInFlight) return;
  reconnectInFlight = true;
  reconnectDueAt = 0;
  updateReconnectStatus("OPS Workflow 연결 확인 중");
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), WORKFLOW_PROBE_TIMEOUT_MS);
  try {
    const params = new URLSearchParams({
      mode: "page",
      page: "1",
      pageSize: "1",
      unfinishedOnly: "false",
    });
    const response = await fetch(`${WORKFLOW_API}?${params.toString()}`, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok && body?.ok === true && body?.stateExists !== false) {
      reconnectAttempt = 0;
      setFallbackStatus("Product Master 핵심 원장 표시 · OPS Workflow 최신 상태 불러오는 중");
      window.dispatchEvent(new Event("focus"));
      scheduleWorkflowReconnect(10_000);
      return;
    }
  } catch (error) {
    if (error?.name !== "AbortError") console.debug("OPS Workflow reconnect deferred", error);
  } finally {
    window.clearTimeout(timer);
    reconnectInFlight = false;
  }
  reconnectAttempt += 1;
  scheduleWorkflowReconnect();
}

function updateReconnectStatus(override) {
  if (override) {
    setFallbackStatus(override);
    return;
  }
  const seconds = reconnectDueAt > Date.now()
    ? Math.max(1, Math.ceil((reconnectDueAt - Date.now()) / 1000))
    : null;
  setFallbackStatus(
    seconds
      ? `Product Master 핵심 원장 표시 · OPS Workflow ${seconds}초 후 재연결`
      : "Product Master 핵심 원장 표시 · OPS Workflow 재연결 준비",
  );
}

function setFallbackStatus(message) {
  const status = document.querySelector("#save-status");
  if (status) {
    status.textContent = message;
    status.dataset.tone = "warning";
  }
}

function captureWorkflowCache() {
  window.setTimeout(() => {
    const previous = readWorkflowCache();
    const items = { ...(previous.items || {}) };
    const savedAt = new Date().toISOString();
    for (const row of document.querySelectorAll("#launch-table-body tr[data-id]")) {
      const model = normalizeModelNumber(
        row.querySelector(".inline-model-number-editor")?.value ||
          row.querySelector("[data-column-key='modelNumber']")?.textContent,
      );
      if (!model) continue;
      const stages = {};
      for (const select of row.querySelectorAll("select.status-select[data-stage]")) {
        if (WORKFLOW_STAGES.includes(select.dataset.stage)) {
          stages[select.dataset.stage] = select.value;
        }
      }
      items[model] = { savedAt, stages };
    }
    const ordered = Object.entries(items)
      .sort((left, right) => Date.parse(right[1]?.savedAt || "") - Date.parse(left[1]?.savedAt || ""))
      .slice(0, WORKFLOW_CACHE_MAX_ITEMS);
    try {
      localStorage.setItem(
        WORKFLOW_CACHE_KEY,
        JSON.stringify({ version: 1, savedAt, items: Object.fromEntries(ordered) }),
      );
    } catch {
      // Cache is optional; Product Master remains authoritative without it.
    }
  }, 0);
}

function readWorkflowCache() {
  try {
    const parsed = JSON.parse(localStorage.getItem(WORKFLOW_CACHE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function lockWorkflowWrites(locked) {
  for (const element of document.querySelectorAll(MASTER_DISABLED_SELECTOR)) {
    if (!(element instanceof HTMLButtonElement || element instanceof HTMLInputElement || element instanceof HTMLSelectElement)) continue;
    if (locked) {
      if (!element.disabled) element.dataset.masterFallbackDisabled = "true";
      element.disabled = true;
    } else if (element.dataset.masterFallbackDisabled === "true") {
      element.disabled = false;
      delete element.dataset.masterFallbackDisabled;
    }
  }
}

function deactivateMasterFallback() {
  masterFallbackActive = false;
  delete document.body.dataset.productMasterFallback;
  fallbackController?.abort();
  window.clearTimeout(reconnectTimer);
  reconnectDueAt = 0;
  lockWorkflowWrites(false);
  const pager = document.querySelector("#product-master-fallback-pager");
  if (pager) pager.style.display = "none";
}

function applyDefaultMasterView() {
  if (defaultMasterViewApplied) return;
  defaultMasterViewApplied = true;
  const unfinished = document.querySelector("#unfinished-only-filter");
  if (!(unfinished instanceof HTMLInputElement) || !unfinished.checked) return;
  unfinished.checked = false;
  unfinished.dispatchEvent(new Event("change", { bubbles: true }));
}

function currentMasterSearch() {
  return String(document.querySelector("#search-input")?.value || "")
    .normalize("NFKC")
    .trim()
    .slice(0, 160);
}

function productMasterCoreUrl(model) {
  return `${PRODUCT_MASTER_BASE_URL}/core/${encodeURIComponent(model)}`;
}

function normalizeModelNumber(value) {
  const candidate = String(value ?? "").normalize("NFKC").trim().toUpperCase().replace(/\s+/g, "");
  const match = candidate.match(/^AAA0*(\d+)$/);
  if (!match) return /^AAA\d{3,}$/.test(candidate) ? candidate : "";
  return `AAA${match[1].padStart(3, "0")}`;
}

function formatCacheTime(value) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) return "시간 미상";
  return new Date(parsed).toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatNumber(value) {
  return new Intl.NumberFormat("ko-KR").format(Number(value) || 0);
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
