const STORAGE_KEYS = [
  "commerce-os-product-launch-tracker:v2",
  "commerce-os-product-launch-tracker:v1",
];
const MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1000;
const LOCK_SELECTOR = [
  "#search-input",
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

export function installStartupPageCachePreview() {
  const cached = newestCachedPage();
  const body = document.querySelector("#launch-table-body");
  if (!cached || !body) return false;

  let liveLoaded = false;
  let restoring = false;
  const cachedRows = renderRows(cached.items);

  renderCachedPage(cached, cachedRows);
  lockWrites(true);

  const onLivePage = () => {
    liveLoaded = true;
    observer.disconnect();
    lockWrites(false);
    body.removeAttribute("data-startup-cache-preview");
    body.style.removeProperty("pointer-events");
    body.style.removeProperty("opacity");
  };
  window.addEventListener("product-launch-tracker:page-loaded", onLivePage, {
    once: true,
  });

  const observer = new MutationObserver(() => {
    if (liveLoaded || restoring) return;
    const status = document.querySelector("#save-status")?.textContent || "";
    const failed =
      status.includes("목록 불러오기 실패") ||
      body.textContent?.includes("목록을 불러오지 못했습니다");
    if (!failed) return;

    restoring = true;
    renderCachedPage(cached, cachedRows);
    lockWrites(true);
    const saveStatus = document.querySelector("#save-status");
    if (saveStatus) {
      saveStatus.textContent = "최근 정상 목록 표시 · 서버 재연결 대기";
    }
    queueMicrotask(() => {
      restoring = false;
    });
  });
  observer.observe(body, { childList: true, subtree: true });
  return true;
}

function newestCachedPage() {
  const now = Date.now();
  return STORAGE_KEYS.map(readJson)
    .filter(
      (value) =>
        value &&
        value.partialPage === true &&
        Array.isArray(value.items) &&
        value.items.length > 0 &&
        now - timestamp(value.savedAt || value.updatedAt) <= MAX_CACHE_AGE_MS,
    )
    .sort(
      (left, right) =>
        timestamp(right.savedAt || right.updatedAt) -
        timestamp(left.savedAt || left.updatedAt),
    )[0] || null;
}

function renderCachedPage(cached, cachedRows) {
  const body = document.querySelector("#launch-table-body");
  if (!body) return;
  body.innerHTML = cachedRows;
  body.setAttribute("data-startup-cache-preview", "true");
  body.style.pointerEvents = "none";
  body.style.opacity = "0.78";

  const status = document.querySelector("#save-status");
  if (status && ["불러오는 중", "목록 불러오기 실패"].includes(status.textContent || "")) {
    status.textContent = "최근 정상 목록 먼저 표시 · 서버 최신상태 확인 중";
  }

  const visible = document.querySelector("#visible-count");
  if (visible) {
    const page = Math.max(1, Number(cached.page) || 1);
    const pageSize = Math.max(1, Number(cached.pageSize) || cached.items.length || 25);
    const total = Math.max(cached.items.length, Number(cached.total) || 0);
    const start = total ? (page - 1) * pageSize + 1 : 0;
    const end = Math.min(page * pageSize, total);
    visible.textContent = `${formatNumber(total)}건 · ${formatNumber(start)}-${formatNumber(end)}`;
  }

  renderSummary(cached.counts);
  renderFilterOptions("#batch-filter", "전체 작업 묶음", cached.filterOptions?.batches);
  renderFilterOptions("#assignee-filter", "전체 담당자", cached.filterOptions?.assignees);
}

function renderSummary(counts) {
  const summary = document.querySelector("#summary");
  if (!summary || !counts || typeof counts !== "object") return;
  const tones = ["", "emerald", "blue", "amber", "emerald"];
  summary.innerHTML = Object.entries(counts)
    .map(
      ([label, value], index) => `
        <article class="summary-card" data-tone="${tones[index] || ""}">
          <span>${escapeHtml(label)}</span><strong>${formatNumber(value)}</strong>
        </article>
      `,
    )
    .join("");
}

function renderFilterOptions(selector, allLabel, values) {
  const select = document.querySelector(selector);
  if (!(select instanceof HTMLSelectElement)) return;
  const options = Array.isArray(values) ? values : [];
  select.innerHTML = [
    `<option value="">${escapeHtml(allLabel)}</option>`,
    ...options.map(
      (value) =>
        `<option value="${escapeAttribute(value)}">${escapeHtml(value)}</option>`,
    ),
  ].join("");
}

function renderRows(items) {
  return items.map(renderRow).join("");
}

function renderRow(item) {
  const stages = item?.stages || {};
  const optionLabels = Array.isArray(item?.optionLabels) ? item.optionLabels : [];
  const optionLocations = Array.isArray(item?.optionLocations)
    ? item.optionLocations
    : [];
  const barcode = optionLocations.length > 1
    ? optionLocations
        .map((entry) => `${entry?.label || "옵션"} ${entry?.barcode || ""}`.trim())
        .filter(Boolean)
        .join(" · ")
    : item?.barcode || optionLocations[0]?.barcode || "";
  const readiness = item?.receiptPending
    ? "입고대기중"
    : item?.readiness?.ready
    ? "준비완료"
    : `준비필요 ${Number(item?.readiness?.errorCount || 0)}`;

  return `
    <tr class="startup-cache-row" aria-label="최근 정상 목록 캐시">
      <td class="check-column"><input type="checkbox" disabled aria-label="서버 확인 중" /></td>
      <td class="cell-truncate"><span class="optimized-row-number">#${formatNumber(item?.trackerRowNumber || 0)}</span>${escapeHtml(item?.workBatch || "")}</td>
      <td>${escapeHtml(barcode)}</td>
      <td>${escapeHtml(item?.modelNumber || "")}</td>
      <td class="product-name">${escapeHtml(item?.productName || "")}</td>
      <td class="category-cell">${escapeHtml(item?.shoplingCategory || "")}</td>
      <td class="options-cell">${escapeHtml(optionLabels.join(", "))}</td>
      <td>${cacheBadge(readiness)}</td>
      ${[
        "detailPage",
        "priceKeyword",
        "shoplingUpload",
        "marketRegistration",
        "orderMapping",
        "inventoryReflection",
      ]
        .map((key) => `<td>${cacheBadge(stages?.[key]?.status || "미시작")}</td>`)
        .join("")}
      <td class="next-stage">${escapeHtml(item?.nextStage || "")}<span class="progress-text">최근 정상 목록</span></td>
      <td class="row-actions">${cacheBadge("읽기 전용")}</td>
    </tr>
  `;
}

function cacheBadge(value) {
  return `<span style="display:inline-flex;align-items:center;min-height:28px;padding:4px 9px;border-radius:999px;background:#f1f5f9;color:#475569;font-size:11px;font-weight:800;white-space:nowrap">${escapeHtml(value)}</span>`;
}

function lockWrites(locked) {
  for (const element of document.querySelectorAll(LOCK_SELECTOR)) {
    if (
      element instanceof HTMLButtonElement ||
      element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement
    ) {
      element.disabled = locked;
    }
  }
}

function readJson(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "null");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function timestamp(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("ko-KR");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
