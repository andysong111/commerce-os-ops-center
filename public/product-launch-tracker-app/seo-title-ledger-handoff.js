const SEO_BULK_ROUTE = "/seo-bulk-cloud";
const SEO_BULK_BATCH_STORAGE_KEY = "commerceOs.seoBulkCloud.batch.v1";
const SEO_BULK_WINDOW_NAME = "commerce-os-seo-bulk-cloud";
const SEO_BULK_REVISION_PARAM = "rev";
const NORMALIZED_ITEM_API = "/api/product-launch-tracker/normalized-optimized";
const SEO_RUN_API = "/api/seo-run-jobs";
const CUSTOM_BLOCKED_STORAGE_KEY =
  "keywordEngineElonLab.step4.customBlockedTerms.v1";
const BUTTON_ID = "seo-title-ledger-handoff-button";
const DATA_GROUP_ID = "bulk-action-group-data";
const SEO_SHOPLING_ONE_CLICK_BUTTON_ID = "seo-shopling-one-click";
const SEO_SHOPLING_ONE_CLICK_EVENT = "product-launch-tracker:seo-shopling-one-click";
const MAX_INSTALL_ATTEMPTS = 40;
const MAX_BATCH_ITEMS = 50;
let installAttempt = 0;
let installTimer = null;
let healthPanelScheduled = false;

function text(value) {
  return String(value ?? "").trim();
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function list(value) {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function listOfRecords(value) {
  return Array.isArray(value) ? value.map(record) : [];
}

function newId(prefix) {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `${prefix}-${uuid || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`}`;
}

function readSelectedItemIds() {
  return [
    ...document.querySelectorAll("#launch-table-body tr[data-id] .row-check:checked"),
  ]
    .map((checkbox) => checkbox.closest("tr[data-id]")?.dataset.id || "")
    .filter(Boolean);
}

function firstSelectedReadinessBlocker() {
  for (const checkbox of document.querySelectorAll(
    "#launch-table-body tr[data-id] .row-check:checked",
  )) {
    const row = checkbox.closest("tr[data-id]");
    const badge = row?.querySelector(".readiness-badge");
    const stockBadge = row?.querySelector(".stock-badge");
    if (row?.dataset.stockSelectable === "false") {
      const modelNumber = row?.querySelector(".inline-model-number-editor")?.value || "선택 상품";
      return {
        modelNumber: text(modelNumber),
        status: text(stockBadge?.textContent) || "재고 확인 필요",
        reason: text(stockBadge?.getAttribute("title")),
      };
    }
    if (!badge?.classList.contains("needs-work") &&
        !badge?.classList.contains("receipt-pending") &&
        !badge?.classList.contains("seo-excluded")) {
      continue;
    }
    const modelNumber = row?.querySelector(".inline-model-number-editor")?.value || "선택 상품";
    return {
      modelNumber: text(modelNumber),
      status: text(badge.textContent) || "준비필요",
      reason: text(badge.getAttribute("title")),
    };
  }
  return null;
}

function sourceUrlFromItem(item) {
  const source = record(item.source);
  const itemPayload = record(item.item_payload ?? item.itemPayload);
  const payloadSource = record(itemPayload.source);
  const candidates = [
    item.primaryChinaProductLink,
    itemPayload.primaryChinaProductLink,
    source.primaryChinaProductLink,
    payloadSource.primaryChinaProductLink,
    ...list(item.chinaProductLinks),
    ...list(itemPayload.chinaProductLinks),
    ...list(source.chinaProductLinks),
    ...list(payloadSource.chinaProductLinks),
    item.chinaOrderLink,
    itemPayload.chinaOrderLink,
  ]
    .map(text)
    .filter(Boolean);
  return candidates.find((value) => /^https?:\/\/(?:[^/]+\.)?1688\.com\//i.test(value)) || "";
}

function receiptPendingFromItem(item) {
  const source = record(item.source);
  const sourcingOptions = listOfRecords(item.orderOptions)
    .filter((option) => text(option.sourcingIntakeId));
  const isSourcingItem =
    text(source.system) === "commerce-os-sourcing-engine" ||
    sourcingOptions.length > 0;
  if (!isSourcingItem) return false;
  if (sourcingOptions.length) {
    return sourcingOptions.some((option) => {
      const status = text(option.lifecycleStatus).toUpperCase();
      if (status === "RESERVED") return true;
      return !text(option.receiptId);
    });
  }
  const status = text(source.lifecycleStatus).toUpperCase();
  if (status === "RESERVED") return true;
  return !text(source.receiptId) &&
    text(source.sourcingReceiptStatus).toLowerCase() !== "confirmed";
}

function normalizedItemFields(raw) {
  const item = record(raw);
  const itemPayload = record(item.item_payload ?? item.itemPayload);
  return {
    id: text(item.id || item.item_id || itemPayload.id || itemPayload.itemId),
    trackerRowNumber: Number(
      item.trackerRowNumber ??
      item.tracker_row_number ??
      itemPayload.trackerRowNumber ??
      0,
    ) || 0,
    modelNumber: text(item.modelNumber || item.model_number || itemPayload.modelNumber),
    productName: text(item.productName || item.product_name || itemPayload.productName),
    sourceUrl: sourceUrlFromItem({ ...itemPayload, ...item }),
    receiptPending: receiptPendingFromItem({ ...itemPayload, ...item }),
  };
}

async function readSelectedItem(itemId) {
  const query = new URLSearchParams({ mode: "item", id: itemId });
  const response = await fetch(`${NORMALIZED_ITEM_API}?${query.toString()}`, {
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok !== true || !body?.item) {
    throw new Error(body?.message || `상품 정보를 불러오지 못했습니다. HTTP ${response.status}`);
  }
  return normalizedItemFields(body.item);
}

async function mapLimit(values, limit, worker) {
  const results = new Array(values.length);
  let cursor = 0;
  async function runner() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(values[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, () => runner()),
  );
  return results;
}

function readPendingBatch() {
  try {
    const raw = window.localStorage.getItem(SEO_BULK_BATCH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.items)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function readCustomBlockedTerms() {
  try {
    const raw = window.localStorage.getItem(CUSTOM_BLOCKED_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return list(parsed).slice(0, 200);
  } catch {
    return [];
  }
}

function clearPendingBatchIfMatch(batchId, revision) {
  const current = readPendingBatch();
  if (
    text(current?.batchId) !== text(batchId) ||
    text(current?.revision) !== text(revision)
  ) {
    return false;
  }
  window.localStorage.removeItem(SEO_BULK_BATCH_STORAGE_KEY);
  return true;
}

function sameRunItemSelection(items, selectedIds) {
  const itemIds = listOfRecords(items).map((item) => text(item.id)).filter(Boolean);
  if (itemIds.length !== selectedIds.length) return false;
  const selected = new Set(selectedIds.map(text).filter(Boolean));
  return selected.size === itemIds.length && itemIds.every((id) => selected.has(id));
}

async function enqueueOneClickRuns(batchId, runs) {
  const response = await fetch(SEO_RUN_API, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "enqueue",
      batchId,
      runs,
      customBlockedTerms: readCustomBlockedTerms(),
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok !== true) {
    throw new Error(
      body?.message ||
        `서버가 SEO 등록회차를 접수하지 못했습니다. HTTP ${response.status}`,
    );
  }
  const requestedCount = Number(body.requestedCount) || 0;
  const insertedCount = Number(body.insertedCount) || 0;
  const existingCount = Number(body.existingCount) || 0;
  const acceptedCount = insertedCount + existingCount;
  if (requestedCount !== runs.length || acceptedCount < 1) {
    throw new Error(
      `서버 접수 결과가 맞지 않아 실행을 중단했습니다. 요청 ${runs.length}개 · 접수 ${acceptedCount}개`,
    );
  }
  return {
    acceptedCount,
    skippedCount: Math.max(0, runs.length - acceptedCount),
    missing: list(body.missing),
    excluded: list(body.excluded),
  };
}

function normalizeRunItem(item, index = 0) {
  const row = record(item);
  const id = text(row.id);
  if (!id) return null;
  return {
    ...row,
    id,
    runId: text(row.runId) || `legacy-${id}-${index}`,
    runCreatedAt: text(row.runCreatedAt) || text(row.createdAt) || new Date().toISOString(),
  };
}

function mergePendingItems(previousItems, nextItems) {
  const merged = [];
  const seenRunIds = new Set();
  const all = [...listOfRecords(previousItems), ...listOfRecords(nextItems)];
  all.forEach((item, index) => {
    const normalized = normalizeRunItem(item, index);
    if (!normalized || seenRunIds.has(normalized.runId)) return;
    seenRunIds.add(normalized.runId);
    merged.push(normalized);
  });
  return merged;
}

function batchItemSignature(items) {
  return listOfRecords(items)
    .map((item, index) => {
      const row = normalizeRunItem(item, index);
      if (!row) return "";
      return [
        row.runId,
        text(row.id),
        text(row.modelNumber),
        text(row.productName),
        text(row.sourceUrl),
      ].join("|");
    })
    .filter(Boolean)
    .sort()
    .join("||");
}

function showMessage(message) {
  if (typeof window.showToast === "function") {
    window.showToast(message);
    return;
  }
  window.alert(message);
}

function updateButton(button) {
  const selectedCount = readSelectedItemIds().length;
  const nextText = selectedCount
    ? `SEO 대량등록 클라우드 열기 (${selectedCount})`
    : "SEO 대량등록 클라우드 열기";
  if (button.textContent !== nextText) button.textContent = nextText;
  button.dataset.selectedCount = String(selectedCount);
}

function isSeoBulkWindow(opened) {
  try {
    return (
      opened.location.origin === window.location.origin &&
      opened.location.pathname === SEO_BULK_ROUTE
    );
  } catch {
    return false;
  }
}

function seoBulkWindowRevision(opened) {
  try {
    return new URLSearchParams(opened.location.search).get(SEO_BULK_REVISION_PARAM) || "";
  } catch {
    return "";
  }
}

function isSeoBulkWindowBusy(opened) {
  try {
    const bodyText = opened.document?.body?.innerText || "";
    return /FINAL 생성 중|원본 준비 중|STEP\s*[1-4]\s*·|조립 중|Shopling.*등록 중/.test(bodyText);
  } catch {
    return false;
  }
}

function openOrFocusBulkWindow(target, revision) {
  const opened = window.open("", SEO_BULK_WINDOW_NAME);
  if (!opened) {
    window.location.assign(target);
    return;
  }

  const existingCloud = isSeoBulkWindow(opened);
  if (existingCloud && seoBulkWindowRevision(opened) === revision) {
    opened.focus();
    return;
  }

  if (existingCloud && isSeoBulkWindowBusy(opened)) {
    opened.focus();
    showMessage(
      "새 SEO 등록 회차를 기존 클라우드에 추가했습니다. 현재 실행은 계속되고 새 카드는 자동으로 합류합니다.",
    );
    return;
  }

  try {
    opened.location.href = target;
    opened.focus();
    opened.opener = null;
  } catch {
    window.location.assign(target);
  }
}

async function openBulkCloud(button, options = {}) {
  const autoQueueShoplingRegistration = options.autoQueueShoplingRegistration === true;
  const isOneClickButton = button.id === SEO_SHOPLING_ONE_CLICK_BUTTON_ID;
  const selectedIds = readSelectedItemIds();
  if (!selectedIds.length) {
    showMessage("SEO 대량등록 클라우드에서 처리할 상품을 1개 이상 선택하세요.");
    return;
  }
  const readinessBlocker = firstSelectedReadinessBlocker();
  if (readinessBlocker) {
    showMessage(
      `${readinessBlocker.modelNumber}은 ${readinessBlocker.status} 상태입니다.${readinessBlocker.reason ? ` ${readinessBlocker.reason}` : ""}`,
    );
    return;
  }
  if (selectedIds.length > MAX_BATCH_ITEMS) {
    showMessage(`한 번에 최대 ${MAX_BATCH_ITEMS}개 상품을 추가합니다. 현재 ${selectedIds.length}개가 선택되었습니다.`);
    return;
  }

  button.disabled = true;
  const original = button.textContent;
  button.textContent = `${selectedIds.length}개 새 등록회차 생성 중…`;
  try {
    const masters = await mapLimit(selectedIds, 8, readSelectedItem);
    const receiptPending = masters.find((item) => item.receiptPending);
    if (receiptPending) {
      throw new Error(
        `${receiptPending.modelNumber || receiptPending.productName || "신규소싱 상품"}은 입고대기중입니다. 입고확정 후 SEO 대량등록을 진행하세요.`,
      );
    }
    // Linkless products are resolved server-side: 1688 → Shopling → launch tracker.

    if (
      autoQueueShoplingRegistration &&
      !window.confirm(
        `${selectedIds.length}개 상품의 SEO를 만들고, 완성된 상품은 Shopling 6채널 등록까지 자동으로 진행합니다.\n\n품절·단종·입고대기·재료부족 상품은 제외됩니다. 계속할까요?`,
      )
    ) {
      return;
    }

    const previousBatch = readPendingBatch();
    const previousIsRunBatch = Number(previousBatch?.version) >= 3;
    const previousItems = previousIsRunBatch ? listOfRecords(previousBatch?.items) : [];
    const reusableOneClickItems =
      autoQueueShoplingRegistration &&
      previousItems.length > 0 &&
      sameRunItemSelection(previousItems, selectedIds) &&
      previousItems.every((item) => item.autoQueueShoplingRegistration === true)
        ? previousItems.map(normalizeRunItem).filter(Boolean)
        : [];
    if (
      autoQueueShoplingRegistration &&
      previousItems.length > 0 &&
      reusableOneClickItems.length === 0
    ) {
      throw new Error(
        `아직 서버로 인계되지 않은 이전 작업 ${previousItems.length}개가 남아 있습니다. 먼저 'SEO 대량등록 클라우드 열기'로 이전 작업을 확인하세요.`,
      );
    }

    const now = new Date().toISOString();
    const runItems = reusableOneClickItems.length
      ? reusableOneClickItems
      : masters.map((item, index) => ({
          ...item,
          runId: newId("seo-run"),
          runCreatedAt: now,
          runSequenceInClick: index + 1,
          generationStatus: "idle",
          shoplingStatus: "idle",
          autoQueueShoplingRegistration,
        }));
    const mergedItems = mergePendingItems(previousItems, runItems);
    if (mergedItems.length > MAX_BATCH_ITEMS) {
      throw new Error(
        `현재 SEO 클라우드의 활성 등록회차와 합치면 ${mergedItems.length}개입니다. 완료 카드를 보관한 뒤 다시 추가하세요.`,
      );
    }

    const hasExistingRuns = previousIsRunBatch && previousItems.length > 0;
    const batchId = hasExistingRuns && text(previousBatch?.batchId)
      ? text(previousBatch.batchId)
      : newId("seo-bulk");
    const revision = now;
    const batch = {
      version: 3,
      batchId,
      createdAt: hasExistingRuns ? text(previousBatch?.createdAt) || now : now,
      updatedAt: now,
      revision,
      itemSignature: batchItemSignature(mergedItems),
      autoStart: true,
      items: mergedItems,
    };
    window.localStorage.setItem(SEO_BULK_BATCH_STORAGE_KEY, JSON.stringify(batch));
    let handoff = null;
    if (autoQueueShoplingRegistration) {
      button.textContent = `${runItems.length}개 서버 접수 확인 중…`;
      handoff = await enqueueOneClickRuns(batchId, runItems);
      clearPendingBatchIfMatch(batchId, revision);
    }
    const target = `${SEO_BULK_ROUTE}?${new URLSearchParams({
      batchId,
      [SEO_BULK_REVISION_PARAM]: revision,
    }).toString()}`;
    openOrFocusBulkWindow(target, revision);
    if (handoff?.skippedCount) {
      const reasons = [...handoff.missing, ...handoff.excluded].slice(0, 3).join(", ");
      showMessage(
        `${handoff.acceptedCount}개는 서버가 접수했고 ${handoff.skippedCount}개는 최신 상태 검사에서 제외했습니다.${reasons ? ` ${reasons}` : ""}`,
      );
    }
  } catch (error) {
    showMessage(error instanceof Error ? error.message : "SEO 대량등록 클라우드로 이동하지 못했습니다.");
  } finally {
    button.disabled = false;
    button.textContent = original || "SEO 대량등록 클라우드 열기";
    if (!isOneClickButton) updateButton(button);
  }
}

function installButton() {
  const controls = document.querySelector(".bulk-controls");
  const dataGroup = document.querySelector(`#${DATA_GROUP_ID}`);
  const destination = dataGroup || controls;
  if (!destination) return false;

  let button = document.querySelector(`#${BUTTON_ID}`);
  if (!button) {
    button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.className = "button seo-title-ledger-button";
    button.addEventListener("click", () => void openBulkCloud(button));
  }
  if (button.parentElement !== destination) destination.append(button);
  if (!button.disabled) updateButton(button);
  return true;
}

function installStyles() {
  if (document.querySelector("#seo-title-ledger-handoff-style")) return;
  const style = document.createElement("style");
  style.id = "seo-title-ledger-handoff-style";
  style.textContent = `
    .seo-title-ledger-button {
      border: 1px solid #7c3aed !important;
      background: #6d28d9 !important;
      color: #fff !important;
      font-weight: 850 !important;
      min-width: 190px;
    }
    .seo-title-ledger-button:hover { background: #5b21b6 !important; }
    .seo-title-ledger-button:disabled { cursor: wait; opacity: .55; }
  `;
  document.head.append(style);
}

function scheduleInstall(reset = false) {
  if (reset) installAttempt = 0;
  if (installTimer) {
    window.clearTimeout(installTimer);
    installTimer = null;
  }
  installStyles();
  const oneClickButton = document.querySelector(`#${SEO_SHOPLING_ONE_CLICK_BUTTON_ID}`);
  if (oneClickButton instanceof HTMLButtonElement) {
    oneClickButton.disabled = false;
    oneClickButton.title = "SEO 등록 가능 상품을 골라 Shopling 6채널 등록까지 자동 진행합니다.";
  }
  if (installButton()) return;
  if (installAttempt >= MAX_INSTALL_ATTEMPTS) return;
  installAttempt += 1;
  installTimer = window.setTimeout(() => scheduleInstall(false), 100);
}

function scheduleHealthPanel() {
  if (healthPanelScheduled) return;
  healthPanelScheduled = true;
  const load = () => {
    void Promise.all([
      import("./china-link-health-panel.js"),
      import("./china-link-health-run-state.js"),
    ]).catch((error) => {
      console.error("China primary link health panel failed to load", error);
    });
  };
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(load, { timeout: 2_000 });
  } else {
    window.setTimeout(load, 700);
  }
}

function handleSelectionChange(event) {
  if (
    !(event.target instanceof Element) ||
    !event.target.matches(".row-check, #select-visible")
  ) {
    return;
  }
  const button = document.querySelector(`#${BUTTON_ID}`);
  if (button && !button.disabled) {
    updateButton(button);
    return;
  }
  scheduleInstall(true);
}

function handlePageLoaded() {
  scheduleInstall(true);
}

function handleSeoShoplingOneClick() {
  const button = document.querySelector(`#${SEO_SHOPLING_ONE_CLICK_BUTTON_ID}`);
  if (!(button instanceof HTMLButtonElement)) {
    showMessage("원클릭 등록 버튼을 찾지 못했습니다. 화면을 새로고침한 뒤 다시 시도하세요.");
    return;
  }
  void openBulkCloud(button, { autoQueueShoplingRegistration: true }).finally(() => {
    button.disabled = false;
    button.textContent = "SEO 가능 → 샵플링까지 한 번에";
  });
}

scheduleInstall(true);
scheduleHealthPanel();
document.addEventListener("change", handleSelectionChange, true);
window.addEventListener("product-launch-tracker:page-loaded", handlePageLoaded);
window.addEventListener(SEO_SHOPLING_ONE_CLICK_EVENT, handleSeoShoplingOneClick);
window.addEventListener(
  "pagehide",
  () => {
    if (installTimer) window.clearTimeout(installTimer);
    document.removeEventListener("change", handleSelectionChange, true);
    window.removeEventListener("product-launch-tracker:page-loaded", handlePageLoaded);
    window.removeEventListener(SEO_SHOPLING_ONE_CLICK_EVENT, handleSeoShoplingOneClick);
  },
  { once: true },
);
