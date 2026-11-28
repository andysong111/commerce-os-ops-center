const STORAGE_KEY = "commerce-os-product-launch-tracker:v2";
const STATE_ENDPOINT = "/api/product-launch-tracker/state";
const STATUS_ENDPOINT = "/api/shopling-categories/status";
const REFRESH_ENDPOINT = "/api/shopling-categories/refresh";
const AI_ENDPOINT = "/api/product-launch-tracker/ai-category";
const bulkControls = document.querySelector(".bulk-controls");
const tableBody = document.querySelector("#launch-table-body");
let refreshButton = null;
let aiButton = null;
let statusBadge = null;
let statusTimer = null;

installCategoryControls();
void refreshCategoryStatus();
decorateCategorySuggestions();

if (tableBody) {
  const observer = new MutationObserver(() => {
    syncSelectionState();
    decorateCategorySuggestions();
  });
  observer.observe(tableBody, { childList: true, subtree: true });
}

document.addEventListener(
  "change",
  (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.type !== "checkbox") return;
    window.setTimeout(syncSelectionState, 0);
  },
  true,
);

function installCategoryControls() {
  if (!bulkControls || document.querySelector("#shopling-category-refresh-button")) return;

  statusBadge = document.createElement("span");
  statusBadge.id = "shopling-category-status-badge";
  statusBadge.textContent = "카테고리 상태 확인 중";
  statusBadge.style.fontSize = "11px";
  statusBadge.style.fontWeight = "700";
  statusBadge.style.color = "#475569";
  statusBadge.style.whiteSpace = "nowrap";

  refreshButton = document.createElement("button");
  refreshButton.id = "shopling-category-refresh-button";
  refreshButton.type = "button";
  refreshButton.className = "button button-ghost";
  refreshButton.textContent = "샵플링 카테고리 최신화";
  refreshButton.title = "샵플링 표준카테고리를 읽기 전용으로 다시 수집합니다.";
  refreshButton.addEventListener("click", () => void startCategoryRefresh());

  aiButton = document.createElement("button");
  aiButton.id = "shopling-category-ai-button";
  aiButton.type = "button";
  aiButton.className = "button button-primary";
  aiButton.textContent = "선택 AI 카테고리 후보 생성";
  aiButton.addEventListener("click", () => void runAiCategoryAssignment());

  const clearButton = bulkControls.querySelector("#clear-selection-button");
  const insertBefore = clearButton ?? null;
  bulkControls.insertBefore(statusBadge, insertBefore);
  bulkControls.insertBefore(refreshButton, insertBefore);
  bulkControls.insertBefore(aiButton, insertBefore);
  syncSelectionState();
}

function selectedItemIds() {
  return [...document.querySelectorAll("#launch-table-body tr[data-id]")]
    .filter((row) => row.querySelector("input.row-check:checked:not(:disabled)"))
    .map((row) => String(row.dataset.id ?? "").trim())
    .filter(Boolean);
}

function syncSelectionState() {
  if (!aiButton) return;
  const count = selectedItemIds().length;
  aiButton.disabled = count === 0;
  aiButton.textContent = count
    ? `선택 AI 카테고리 후보 생성 (${count}건)`
    : "선택 AI 카테고리 후보 생성";
}

async function startCategoryRefresh() {
  if (!refreshButton) return;
  const previous = refreshButton.textContent;
  refreshButton.disabled = true;
  refreshButton.textContent = "최신화 요청 중...";
  try {
    const response = await fetch(REFRESH_ENDPOINT, {
      method: "POST",
      headers: { Accept: "application/json" },
      credentials: "same-origin",
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok !== true) {
      throw new Error(body?.message || "카테고리 최신화 작업을 시작하지 못했습니다.");
    }
    window.alert(
      "샵플링 카테고리 최신화를 시작했습니다.\n로그인 세션이 유효하면 자동 수집하고, 보안문자가 필요하면 수동 로그인 필요 상태로 안전하게 멈춥니다.",
    );
    scheduleStatusPolling();
  } catch (error) {
    window.alert(error instanceof Error ? error.message : "카테고리 최신화 요청에 실패했습니다.");
  } finally {
    refreshButton.disabled = false;
    refreshButton.textContent = previous;
  }
}

function scheduleStatusPolling() {
  window.clearInterval(statusTimer);
  let attempts = 0;
  statusTimer = window.setInterval(() => {
    attempts += 1;
    void refreshCategoryStatus();
    if (attempts >= 60) window.clearInterval(statusTimer);
  }, 10_000);
  void refreshCategoryStatus();
}

async function refreshCategoryStatus() {
  if (!statusBadge) return;
  try {
    const response = await fetch(STATUS_ENDPOINT, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      credentials: "same-origin",
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok !== true) {
      throw new Error(body?.message || "상태 확인 실패");
    }
    const runStatus = String(body.status?.status || "not_initialized");
    const count = Number(body.snapshot?.categoryCount || body.status?.categoryCount || 0);
    const date = body.snapshot?.collectedAt
      ? new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "short" }).format(
          new Date(body.snapshot.collectedAt),
        )
      : "";
    if (runStatus === "manual_login_required") {
      statusBadge.textContent = "카테고리: 수동 로그인 필요";
      statusBadge.style.color = "#b45309";
      statusBadge.title = String(body.status?.message || "보안문자 또는 로그인이 필요합니다.");
    } else if (runStatus === "failed") {
      statusBadge.textContent = "카테고리: 최신화 실패";
      statusBadge.style.color = "#b91c1c";
      statusBadge.title = String(body.status?.message || "카테고리 최신화에 실패했습니다.");
    } else if (count > 0) {
      statusBadge.textContent = `카테고리 ${count.toLocaleString("ko-KR")}개 · ${date}`;
      statusBadge.style.color = "#047857";
      statusBadge.title = "최신 샵플링 표준카테고리 스냅샷";
    } else {
      statusBadge.textContent = "카테고리: 최초 최신화 필요";
      statusBadge.style.color = "#475569";
    }
  } catch (error) {
    statusBadge.textContent = "카테고리 상태 확인 실패";
    statusBadge.style.color = "#b91c1c";
    statusBadge.title = error instanceof Error ? error.message : "상태 확인 실패";
  }
}

async function runAiCategoryAssignment() {
  if (!aiButton) return;
  const ids = selectedItemIds();
  if (!ids.length) {
    window.alert("AI 카테고리를 설정할 상품을 먼저 체크하세요.");
    return;
  }
  if (ids.length > 25) {
    window.alert("AI 카테고리는 한 번에 최대 25개까지 처리합니다.");
    return;
  }
  const state = readState();
  if (!state) {
    window.alert("신규 상품 출시 진행관리 저장본을 찾지 못했습니다.");
    return;
  }
  const selected = ids
    .map((id) => state.items.find((item) => String(item?.id ?? "") === id))
    .filter(Boolean);
  const previous = aiButton.textContent;
  aiButton.disabled = true;
  aiButton.textContent = `${selected.length}건 AI 분석 중...`;
  try {
    const response = await fetch(AI_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        items: selected.map((item) => ({
          itemId: item.id,
          modelNumber: item.modelNumber,
          productName: item.productName,
          optionLabels: Array.isArray(item.orderOptions)
            ? item.orderOptions.map((option) => option?.saleOption).filter(Boolean)
            : [],
          currentCategory: item.shoplingCategory || "",
          chinaProductLinks: Array.isArray(item.chinaProductLinks)
            ? item.chinaProductLinks
            : [],
        })),
      }),
      credentials: "same-origin",
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok !== true || !Array.isArray(body.results)) {
      throw new Error(body?.message || "AI 카테고리 결과를 받지 못했습니다.");
    }
    const preview = body.results
      .slice(0, 15)
      .map(
        (result) =>
          `${result.modelNumber || result.itemId}: ${result.selectedPath} (${result.confidence}%) · 검토 필요`,
      )
      .join("\n");
    const reviewCount = body.results.length;
    if (
      !window.confirm(
        [
          `AI 카테고리 결과 ${body.results.length}건`,
          `검토 필요 ${reviewCount}건`,
          "",
          preview,
          body.results.length > 15 ? `외 ${body.results.length - 15}건` : "",
          "",
          "모든 후보를 검토 이력으로 저장할까요?",
        ]
          .filter(Boolean)
          .join("\n"),
      )
    ) {
      return;
    }

    const resultById = new Map(body.results.map((result) => [String(result.itemId), result]));
    const now = new Date().toISOString();
    const nextState = {
      ...state,
      savedAt: now,
      items: state.items.map((item) => {
        const result = resultById.get(String(item?.id ?? ""));
        if (!result) return item;
        return {
          ...item,
          shoplingCategory: item.shoplingCategory,
          categoryAiSuggestion: result.selectedPath,
          categoryAiConfidence: result.confidence,
          categoryAiReason: result.reason,
          categoryAiAlternatives: result.alternatives,
          categoryAiMarketEvidence:
            result.marketEvidence && typeof result.marketEvidence === "object"
              ? result.marketEvidence
              : null,
          categoryAiStatus: "review_required",
          categoryAiSnapshotHash: body.snapshot?.hash || "",
          categoryAiUpdatedAt: now,
          updatedAt: now,
          updatedBy: item.updatedBy,
        };
      }),
    };
    await saveState(nextState);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
    window.alert(
      `AI 카테고리 후보 ${reviewCount}건을 검토함에 저장했습니다.`,
    );
    window.location.reload();
  } catch (error) {
    window.alert(error instanceof Error ? error.message : "AI 카테고리 자동설정에 실패했습니다.");
  } finally {
    aiButton.disabled = false;
    aiButton.textContent = previous;
    syncSelectionState();
  }
}

function decorateCategorySuggestions() {
  const state = readState();
  if (!state || !tableBody) return;
  const itemById = new Map(state.items.map((item) => [String(item?.id ?? ""), item]));
  for (const row of tableBody.querySelectorAll("tr[data-id]")) {
    const item = itemById.get(String(row.dataset.id ?? ""));
    const suggestion = String(item?.categoryAiSuggestion || "").trim();
    if (!suggestion || item?.categoryAiStatus !== "review_required") continue;
    const editor = row.querySelector(".inline-category-editor");
    if (!editor || editor.parentElement?.querySelector(".category-ai-suggestion-badge")) continue;
    const badge = document.createElement("button");
    badge.type = "button";
    badge.className = "category-ai-suggestion-badge";
    badge.textContent = `AI ${Number(item.categoryAiConfidence || 0)}%`;
    badge.title = `${suggestion}\n${String(item.categoryAiReason || "")}`;
    badge.style.marginLeft = "4px";
    badge.style.fontSize = "10px";
    badge.style.fontWeight = "800";
    badge.style.color = "#92400e";
    badge.style.border = "1px solid #f59e0b";
    badge.style.borderRadius = "999px";
    badge.style.background = "#fffbeb";
    badge.addEventListener("click", () => void applyOneSuggestion(String(item.id), suggestion));
    editor.insertAdjacentElement("afterend", badge);
  }
}

async function applyOneSuggestion(itemId, suggestion) {
  if (!window.confirm(`AI 추천 카테고리를 적용할까요?\n${suggestion}`)) return;
  const state = readState();
  if (!state) return;
  const now = new Date().toISOString();
  const nextState = {
    ...state,
    savedAt: now,
    items: state.items.map((item) =>
      String(item?.id ?? "") === itemId
        ? {
            ...item,
            shoplingCategory: suggestion,
            categoryAiStatus: "manually_applied",
            categoryAiUpdatedAt: now,
            updatedAt: now,
            updatedBy: "AI 추천 수동 적용",
          }
        : item,
    ),
  };
  await saveState(nextState);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
  window.location.reload();
}

function readState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return parsed && Array.isArray(parsed.items) ? parsed : null;
  } catch {
    return null;
  }
}

async function saveState(state) {
  const response = await fetch(STATE_ENDPOINT, {
    method: "PUT",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ state }),
    credentials: "same-origin",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok !== true) {
    throw new Error(body?.message || "AI 카테고리 결과를 서버에 저장하지 못했습니다.");
  }
}
