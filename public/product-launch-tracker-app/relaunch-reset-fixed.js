import {
  PRODUCT_LAUNCH_SIMPLE_SESSION_KEY,
  PRODUCT_LAUNCH_TRACKER_HANDOFF_KEY,
} from "./lib/product-launch-flow-handoff.mjs";
import {
  canResetForRelaunch,
  resetLaunchItemForRelaunch,
} from "./lib/relaunch-reset.mjs";

const TRACKER_STORAGE_KEY = "commerce-os-product-launch-tracker:v2";
const TRACKER_STATE_ENDPOINT = "/api/product-launch-tracker/state";
const detailDialog = document.querySelector("#detail-dialog");
const detailForm = document.querySelector("#detail-form");
const tableBody = document.querySelector("#launch-table-body");
const bulkControls = document.querySelector(".bulk-controls");
let bulkResetButton = null;
let detailDecorationTimers = [];

if (detailDialog && detailForm) {
  document.addEventListener(
    "click",
    (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("button[data-action='detail']")) {
        scheduleDetailDecoration();
      }
    },
    true,
  );

  detailDialog.addEventListener("close", () => {
    clearDetailDecorationTimers();
    document.querySelector("#relaunch-reset-history-panel")?.remove();
  });
}

installBulkResetButton();

if (tableBody) {
  const observer = new MutationObserver(() => syncBulkResetButton());
  observer.observe(tableBody, { childList: true, subtree: true });
}

document.addEventListener(
  "change",
  (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.type !== "checkbox") {
      return;
    }
    if (target.id === "select-visible" || target.closest("#launch-table-body")) {
      window.setTimeout(() => syncBulkResetButton(), 0);
    }
  },
  true,
);

function scheduleDetailDecoration() {
  clearDetailDecorationTimers();
  for (const delay of [0, 60, 180]) {
    detailDecorationTimers.push(
      window.setTimeout(() => decorateCurrentDetail(), delay),
    );
  }
}

function clearDetailDecorationTimers() {
  for (const timer of detailDecorationTimers) window.clearTimeout(timer);
  detailDecorationTimers = [];
}

function installBulkResetButton() {
  if (!bulkControls || bulkControls.querySelector("#bulk-relaunch-reset-button")) {
    return;
  }
  const button = document.createElement("button");
  button.id = "bulk-relaunch-reset-button";
  button.type = "button";
  button.className = "button button-ghost";
  button.textContent = "선택 재출시 초기화";
  button.style.borderColor = "#ef4444";
  button.style.color = "#b91c1c";
  button.title =
    "선택 상품의 기존 goods_key를 이력에 보존하고 새 자사상품코드로 처음부터 다시 출시합니다.";
  button.addEventListener("click", () => void resetSelectedForRelaunch(button));

  const clearButton = bulkControls.querySelector("#clear-selection-button");
  if (clearButton) clearButton.before(button);
  else bulkControls.append(button);
  bulkResetButton = button;
  syncBulkResetButton();
}

function syncBulkResetButton() {
  if (!bulkResetButton) return;
  const selectedIds = readSelectedRowIds();
  const state = readTrackerState();
  const eligibleCount = selectedIds.filter((itemId) => {
    const item = findItem(state, itemId);
    return item && canResetForRelaunch(item);
  }).length;
  bulkResetButton.disabled = selectedIds.length === 0;
  bulkResetButton.textContent = eligibleCount
    ? `선택 재출시 초기화 (${eligibleCount}건)`
    : "선택 재출시 초기화";
}

function decorateCurrentDetail() {
  if (!detailDialog?.open) return;
  const itemId = String(detailForm?.elements?.id?.value ?? "").trim();
  if (!itemId) return;
  const state = readTrackerState();
  const item = findItem(state, itemId);
  if (!item) return;

  renderResetHistory(item);
  if (!canResetForRelaunch(item)) return;

  const resultPanel = document.querySelector(
    "#shopling-registration-result-panel",
  );
  const titleRow = resultPanel?.querySelector(".section-title-row");
  if (!titleRow || titleRow.querySelector("[data-relaunch-reset-button]")) {
    return;
  }

  const actionWrap = document.createElement("div");
  actionWrap.style.display = "flex";
  actionWrap.style.flexDirection = "column";
  actionWrap.style.alignItems = "flex-end";
  actionWrap.style.gap = "6px";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "button button-ghost";
  button.dataset.relaunchResetButton = "true";
  button.textContent = "재출시 초기화";
  button.style.borderColor = "#ef4444";
  button.style.color = "#b91c1c";
  button.title =
    "기존 goods_key는 이력으로 보존하고 새 자사상품코드로 다시 출시합니다.";
  button.addEventListener("click", () => void resetForRelaunch(button, itemId));

  const help = document.createElement("span");
  help.textContent = "샵플링에서 기존 상품을 삭제한 경우에만 사용";
  help.style.fontSize = "11px";
  help.style.fontWeight = "700";
  help.style.color = "#991b1b";

  actionWrap.append(button, help);
  titleRow.append(actionWrap);
}

async function resetForRelaunch(button, itemId) {
  const state = readTrackerState();
  const item = findItem(state, itemId);
  if (!state || !item) {
    window.alert("재출시 초기화할 상품 데이터를 찾지 못했습니다.");
    return;
  }

  const modelNumber = String(item.modelNumber ?? "").trim();
  if (!window.confirm(buildResetConfirmation([item], 0))) return;

  const previousText = button.textContent;
  button.disabled = true;
  button.textContent = "초기화 중...";
  try {
    const { nextState, resetItems } = buildResetState(state, [itemId]);
    await saveTrackerState(nextState);
    window.localStorage.setItem(TRACKER_STORAGE_KEY, JSON.stringify(nextState));
    clearRelatedProductLaunchFlow(itemId, modelNumber);

    window.alert(
      `${modelNumber} 재출시 초기화가 완료됐습니다.\n새 자사상품코드: ${resetItems[0]?.selfCodeBase ?? "생성 완료"}\n상품정보를 수정한 뒤 처음부터 다시 출시하세요.`,
    );
    window.location.reload();
  } catch (error) {
    console.error(error);
    button.disabled = false;
    button.textContent = previousText;
    window.alert(
      error instanceof Error
        ? error.message
        : "재출시 초기화를 완료하지 못했습니다.",
    );
  }
}

async function resetSelectedForRelaunch(button) {
  const state = readTrackerState();
  if (!state) {
    window.alert("진행관리 저장본을 찾지 못했습니다.");
    return;
  }
  const selectedIds = readSelectedRowIds();
  if (!selectedIds.length) {
    window.alert("재출시 초기화할 상품을 먼저 체크하세요.");
    return;
  }

  const selectedItems = selectedIds
    .map((itemId) => findItem(state, itemId))
    .filter(Boolean);
  const eligibleItems = selectedItems.filter(canResetForRelaunch);
  const skippedCount = selectedItems.length - eligibleItems.length;
  if (!eligibleItems.length) {
    window.alert(
      "선택한 상품 중 등록된 goods_key가 있는 상품이 없습니다. 이미 초기화된 행은 자동 제외됩니다.",
    );
    return;
  }

  if (!window.confirm(buildResetConfirmation(eligibleItems, skippedCount))) {
    return;
  }

  const previousText = button.textContent;
  button.disabled = true;
  button.textContent = `${eligibleItems.length}건 초기화 중...`;
  try {
    const eligibleIds = eligibleItems.map((item) => String(item.id ?? ""));
    const { nextState } = buildResetState(state, eligibleIds);
    await saveTrackerState(nextState);
    window.localStorage.setItem(TRACKER_STORAGE_KEY, JSON.stringify(nextState));
    for (const item of eligibleItems) {
      clearRelatedProductLaunchFlow(
        String(item.id ?? ""),
        String(item.modelNumber ?? "").trim(),
      );
    }

    window.alert(
      `${eligibleItems.length}건의 재출시 초기화를 완료했습니다.${
        skippedCount
          ? `\n등록 이력이 없는 ${skippedCount}건은 자동 제외했습니다.`
          : ""
      }\n기존 상품정보는 유지되고, 새 자사상품코드와 미시작 단계로 전환됐습니다.`,
    );
    window.location.reload();
  } catch (error) {
    console.error(error);
    button.disabled = false;
    button.textContent = previousText;
    window.alert(
      error instanceof Error
        ? error.message
        : "선택 상품 재출시 초기화를 완료하지 못했습니다.",
    );
  }
}

function buildResetState(state, itemIds) {
  const targetIds = new Set(itemIds.map(String));
  const now = new Date();
  let workingItems = [...state.items];
  const resetItems = [];

  for (const itemId of targetIds) {
    const current = workingItems.find(
      (candidate) => String(candidate?.id ?? "") === itemId,
    );
    if (!current || !canResetForRelaunch(current)) continue;
    const nextItem = resetLaunchItemForRelaunch(current, workingItems, {
      now,
      resetBy: "승준",
      reason: "샵플링 상품 수동 삭제 후 재출시 초기화",
    });
    workingItems = workingItems.map((candidate) =>
      String(candidate?.id ?? "") === itemId ? nextItem : candidate,
    );
    resetItems.push(nextItem);
  }

  if (!resetItems.length) {
    throw new Error("재출시 초기화할 등록 상품이 없습니다.");
  }

  return {
    resetItems,
    nextState: {
      ...state,
      items: workingItems,
      savedAt: now.toISOString(),
    },
  };
}

function buildResetConfirmation(items, skippedCount) {
  const models = items
    .map((item) => String(item?.modelNumber ?? "").trim())
    .filter(Boolean);
  const preview = models.slice(0, 8).join(", ");
  const remainder = Math.max(0, models.length - 8);
  return [
    `${items.length}개 상품을 재출시 초기화합니다.`,
    preview ? `대상: ${preview}${remainder ? ` 외 ${remainder}건` : ""}` : "",
    skippedCount ? `등록 이력이 없는 ${skippedCount}건은 자동 제외됩니다.` : "",
    "",
    "· 기존 goods_key와 자사상품코드는 재출시 이력에 보존",
    "· 중복되지 않는 새 자사상품코드 자동 생성",
    "· 상세페이지·옵션·원가·카테고리·바코드는 유지",
    "· 모든 출시 단계는 미시작으로 초기화",
    "",
    "샵플링에서 기존 상품을 삭제하지 않았다면 중복 상품이 생길 수 있습니다.",
    "계속하시겠습니까?",
  ]
    .filter(Boolean)
    .join("\n");
}

function readSelectedRowIds() {
  return [...document.querySelectorAll("#launch-table-body tr[data-id]")]
    .filter((row) => row.querySelector("input.row-check:checked:not(:disabled)"))
    .map((row) => String(row.dataset.id ?? "").trim())
    .filter(Boolean);
}

async function saveTrackerState(state) {
  const response = await fetch(TRACKER_STATE_ENDPOINT, {
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
    throw new Error(
      body?.message || "재출시 초기화 상태를 서버에 저장하지 못했습니다.",
    );
  }
}

function clearRelatedProductLaunchFlow(itemId, modelNumber) {
  const handoff = readJson(PRODUCT_LAUNCH_TRACKER_HANDOFF_KEY);
  const session = readJson(PRODUCT_LAUNCH_SIMPLE_SESSION_KEY);
  const handoffMatches = String(handoff?.itemId ?? "") === itemId;
  const sessionMatches =
    String(session?.rowExpression ?? "") === `진행관리:${modelNumber}`;
  if (handoffMatches) {
    window.localStorage.removeItem(PRODUCT_LAUNCH_TRACKER_HANDOFF_KEY);
  }
  if (handoffMatches || sessionMatches) {
    window.localStorage.removeItem(PRODUCT_LAUNCH_SIMPLE_SESSION_KEY);
  }
}

function renderResetHistory(item) {
  const history = Array.isArray(item.registrationResetHistory)
    ? item.registrationResetHistory
    : [];
  const existing = document.querySelector("#relaunch-reset-history-panel");
  if (!history.length) {
    existing?.remove();
    return;
  }

  const anchor = document.querySelector("#detail-stages");
  if (!anchor) return;
  const latest = history[history.length - 1] ?? {};
  const products = latest.previousProducts ?? {};
  const goodsKeys = Object.values(products)
    .map((product) => String(product?.goodsKey ?? "").trim())
    .filter(Boolean);
  const fingerprint = [
    history.length,
    latest.resetAt ?? "",
    latest.previousSelfCodeBase ?? "",
    goodsKeys.join(","),
    latest.reason ?? "",
  ].join("|");

  if (existing?.dataset.historyFingerprint === fingerprint) return;

  const section = existing ?? document.createElement("section");
  section.id = "relaunch-reset-history-panel";
  section.className = "integration-section";
  section.dataset.historyFingerprint = fingerprint;
  section.innerHTML = `
    <div class="section-title-row">
      <div>
        <h3>재출시 초기화 이력</h3>
        <p>총 ${history.length}회 · 최근 초기화 ${escapeHtml(formatDateTime(latest.resetAt))}</p>
      </div>
    </div>
    <div class="source-history">
      이전 자사상품코드: <strong>${escapeHtml(latest.previousSelfCodeBase || "-")}</strong><br />
      이전 goods_key: ${goodsKeys.length ? goodsKeys.map(escapeHtml).join(", ") : "없음"}<br />
      사유: ${escapeHtml(latest.reason || "-")}
    </div>`;
  if (!existing) anchor.before(section);
}

function readTrackerState() {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(TRACKER_STORAGE_KEY) ?? "null",
    );
    return parsed && typeof parsed === "object" && Array.isArray(parsed.items)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function findItem(state, itemId) {
  return state?.items?.find(
    (candidate) => String(candidate?.id ?? "") === itemId,
  );
}

function readJson(key) {
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value ?? "-");
  return new Intl.DateTimeFormat("ko-KR", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
