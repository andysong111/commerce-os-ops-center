const CACHE_KEYS = [
  "commerce-os-product-launch-tracker:v2",
  "commerce-os-product-launch-tracker:v1",
  "commerce-os-product-launch-tracker:full-recovery:v1",
];
const MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1000;
const NORMALIZED_ITEM_PATH = "/api/product-launch-tracker/normalized-optimized";

let observer = null;
let cachedById = new Map();
let cachedByModel = new Map();
let installedFetchBridge = false;

function text(value) {
  return String(value ?? "").normalize("NFKC").trim();
}

function normalizeModelNumber(value) {
  const candidate = text(value).toUpperCase().replace(/\s+/g, "");
  const match = candidate.match(/^AAA0*(\d+)$/);
  if (!match) return /^AAA\d{3,}$/.test(candidate) ? candidate : "";
  return `AAA${match[1].padStart(3, "0")}`;
}

function timestamp(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function readJson(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function cacheTimestamp(payload) {
  return Math.max(
    timestamp(payload?.savedAt),
    timestamp(payload?.updatedAt),
    timestamp(payload?.generatedAt),
    timestamp(payload?.sourceSavedAt),
  );
}

function refreshCacheIndex() {
  const now = Date.now();
  const candidates = CACHE_KEYS.map((key) => ({ key, payload: readJson(key) }))
    .filter(({ payload }) => payload && Array.isArray(payload.items) && payload.items.length > 0)
    .map((entry) => ({ ...entry, cachedAt: cacheTimestamp(entry.payload) }))
    .filter(({ cachedAt }) => cachedAt > 0 && now - cachedAt <= MAX_CACHE_AGE_MS)
    .sort((left, right) => right.cachedAt - left.cachedAt);

  const byId = new Map();
  const byModel = new Map();
  for (const { payload, cachedAt } of candidates) {
    for (const raw of payload.items) {
      if (!raw || typeof raw !== "object") continue;
      const id = text(raw.id || raw.item_id || raw.itemId);
      const model = normalizeModelNumber(raw.modelNumber || raw.model_number);
      if (!id || !model) continue;
      const item = { ...raw, __commerceCachedAt: cachedAt };
      if (!byId.has(id)) byId.set(id, item);
      if (!byModel.has(model)) byModel.set(model, item);
    }
  }
  cachedById = byId;
  cachedByModel = byModel;
}

function enhanceMasterFallbackRows() {
  if (document.body.dataset.productMasterFallback !== "true") return;
  refreshCacheIndex();
  let selectable = 0;
  for (const row of document.querySelectorAll("#launch-table-body tr.master-core-fallback-row")) {
    const model = normalizeModelNumber(row.dataset.masterModel);
    const cached = model ? cachedByModel.get(model) : null;
    const checkbox = row.querySelector("td.check-column input[type='checkbox']");
    if (!(checkbox instanceof HTMLInputElement)) continue;
    if (!cached) {
      checkbox.disabled = true;
      checkbox.classList.remove("row-check");
      row.removeAttribute("data-id");
      checkbox.setAttribute("aria-label", "OPS 캐시 없음 · 읽기 전용");
      continue;
    }
    row.dataset.id = text(cached.id || cached.item_id || cached.itemId);
    checkbox.disabled = false;
    checkbox.classList.add("row-check");
    checkbox.dataset.cachedSeoSelection = "true";
    checkbox.setAttribute("aria-label", `${model} SEO 선택 · 최근 정상 OPS 캐시`);
    checkbox.title = "Supabase 장애 중 최근 정상 OPS 캐시를 사용해 SEO 클라우드 선택만 허용합니다.";
    selectable += 1;
  }

  const selectedCount = document.querySelector("#selected-count");
  if (selectedCount && selectable > 0 && !document.querySelector(".row-check:checked")) {
    selectedCount.textContent = `SEO 선택 가능 ${selectable}`;
  }
  const sourceMeta = document.querySelector("#source-meta");
  if (sourceMeta && selectable > 0) {
    sourceMeta.textContent = "Product Master 서버 페이지 · SEO 선택은 최근 정상 OPS 캐시 · 변경 작업은 재연결 후";
  }
}

function installObserver() {
  const body = document.querySelector("#launch-table-body");
  if (!body) return;
  enhanceMasterFallbackRows();
  observer = new MutationObserver(() => enhanceMasterFallbackRows());
  observer.observe(body, { childList: true, subtree: true });
}

function installCachedItemFetchBridge() {
  if (installedFetchBridge) return;
  installedFetchBridge = true;
  const originalFetch = window.fetch;
  window.fetch = async function commerceFallbackCachedItemFetch(input, init = {}) {
    const request = input instanceof Request ? input : null;
    const method = String(init.method || request?.method || "GET").toUpperCase();
    const url = new URL(request?.url || String(input), window.location.href);
    if (
      document.body.dataset.productMasterFallback === "true" &&
      method === "GET" &&
      url.origin === window.location.origin &&
      url.pathname === NORMALIZED_ITEM_PATH &&
      url.searchParams.get("mode") === "item"
    ) {
      refreshCacheIndex();
      const id = text(url.searchParams.get("id"));
      const item = id ? cachedById.get(id) : null;
      if (item) {
        return new Response(
          JSON.stringify({
            ok: true,
            stateExists: true,
            item,
            itemSource: "browser-last-known-good-cache",
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "X-Commerce-Product-Launch-Cache": "last-known-good",
            },
          },
        );
      }
    }
    return originalFetch.call(window, input, init);
  };
}

installCachedItemFetchBridge();
installObserver();
window.addEventListener("storage", enhanceMasterFallbackRows);
window.addEventListener("focus", enhanceMasterFallbackRows);
window.addEventListener(
  "pagehide",
  () => {
    observer?.disconnect();
    window.removeEventListener("storage", enhanceMasterFallbackRows);
    window.removeEventListener("focus", enhanceMasterFallbackRows);
  },
  { once: true },
);
