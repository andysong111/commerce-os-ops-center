import {
  alignChinaOptionMappingsToRegisteredOptions,
  normalizeRegisteredBcode,
} from "./lib/china-option-table-authority.mjs";
import { readChinaOrderOptionMappings } from "./lib/china-order-options.mjs";

const OPTIMIZED_API = "/api/product-launch-tracker/optimized";
const detailDialog = document.querySelector("#detail-dialog");
const detailForm = document.querySelector("#detail-form");
const optionTableBody = document.querySelector("#detail-options");
const syncTimers = new Set();
let syncing = false;
let syncSerial = 0;

for (const delay of [0, 120, 500, 1_200, 2_500]) scheduleSync(delay);

document.addEventListener(
  "click",
  (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("button[data-action='detail']")) {
      for (const delay of [0, 180, 700, 1_600, 3_000]) scheduleSync(delay);
    }
    if (
      target?.closest("#detail-form button[value='save'], #detail-form .detail-floating-save")
    ) {
      scheduleSync(0);
    }
  },
  true,
);

detailForm?.addEventListener(
  "input",
  (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (
      target?.matches(
        "#detail-options [data-field='barcode'], #detail-options [data-field='saleOption']",
      )
    ) {
      scheduleSync(0);
    }
  },
  true,
);

detailDialog?.addEventListener("close", () => {
  clearSyncTimers();
  syncSerial += 1;
  const panel = detailForm?.querySelector("#optimized-china-order-map-wrap");
  if (panel) {
    panel.dataset.itemId = "";
    panel.dataset.dirty = "false";
  }
});

window.addEventListener("product-launch-tracker:model-bcodes-reconciled", () => {
  scheduleSync(0);
  scheduleSync(120);
});

if (detailForm) {
  const observer = new MutationObserver(() => {
    if (!syncing && detailDialog?.open) scheduleSync(20);
  });
  observer.observe(detailForm, { childList: true, subtree: true });
}

function scheduleSync(delay = 20) {
  const timer = window.setTimeout(() => {
    syncTimers.delete(timer);
    void syncChinaOptionPanelToOptionTable();
  }, delay);
  syncTimers.add(timer);
}

function clearSyncTimers() {
  for (const timer of syncTimers) window.clearTimeout(timer);
  syncTimers.clear();
}

async function syncChinaOptionPanelToOptionTable() {
  if (syncing || !detailDialog?.open || !detailForm || !optionTableBody) return;
  const itemId = String(detailForm.elements?.id?.value ?? "").trim();
  const section = detailForm.querySelector("#optimized-china-product-links-section");
  if (!itemId || !section) return;

  const panel = ensureChinaOptionPanel(section);
  const list = panel?.querySelector("#optimized-china-order-map-list");
  if (!panel || !list) return;

  const registered = readRegisteredOptionTableRows();
  const serial = ++syncSerial;
  syncing = true;
  try {
    let sourceRows = readChinaOptionPanelRows();
    const panelBelongsToItem = panel.dataset.itemId === itemId;
    if (!panelBelongsToItem && panel.dataset.dirty !== "true") sourceRows = [];

    if (!sourceRows.length && panel.dataset.dirty !== "true") {
      setPanelStatus(panel, "B-code별 중국옵션 불러오는 중", "");
      const item = await fetchItem(itemId);
      if (serial !== syncSerial || !detailDialog.open) return;
      sourceRows = readChinaOrderOptionMappings(item);
    }

    const aligned = alignChinaOptionMappingsToRegisteredOptions(
      registered,
      sourceRows,
    );
    const current = readChinaOptionPanelRows();
    if (!samePanelRows(current, aligned)) renderAlignedRows(list, aligned);

    panel.dataset.itemId = itemId;
    updateSectionHeading(section);
    updateAuthorityStatus(panel, aligned.length);
    window.dispatchEvent(
      new CustomEvent("product-launch-tracker:china-options-aligned", {
        detail: {
          itemId,
          barcodes: aligned.map((row) => row.barcode),
        },
      }),
    );
  } catch (error) {
    setPanelStatus(
      panel,
      error instanceof Error
        ? error.message
        : "B-code별 중국옵션을 불러오지 못했습니다.",
      "error",
    );
  } finally {
    syncing = false;
  }
}

function ensureChinaOptionPanel(section) {
  let panel = section.querySelector("#optimized-china-order-map-wrap");
  if (panel) return panel;
  panel = document.createElement("div");
  panel.id = "optimized-china-order-map-wrap";
  panel.className = "optimized-china-order-map-wrap";
  panel.dataset.dirty = "false";
  panel.dataset.itemId = "";
  panel.innerHTML = `
    <h4 class="optimized-china-order-map-title">B-code별 중국옵션</h4>
    <p class="optimized-china-order-map-help">발주·입고 옵션가격에 바코드·위치코드가 등록된 항목만 표시합니다. 같은 모델은 발주용 링크를 공유합니다.</p>
    <div id="optimized-china-order-map-list" class="optimized-china-order-map-list"></div>
    <div id="optimized-china-order-map-status" class="optimized-china-order-status"></div>`;
  section.append(panel);
  updateSectionHeading(section);
  return panel;
}

function updateSectionHeading(section) {
  const heading = section.querySelector(".section-title-row h3");
  const help = section.querySelector(".section-title-row p");
  if (heading) heading.textContent = "중국 상품링크 · 중국옵션";
  if (help) {
    help.textContent =
      "중국 링크는 최대 5개까지 저장하며 1번 링크가 해당 모델의 발주 기준링크입니다. B-code별로는 발주·입고 옵션가격에 등록된 항목의 중국옵션명만 저장합니다.";
  }
}

function readRegisteredOptionTableRows() {
  return [...optionTableBody.querySelectorAll("tr[data-option-index]")].map(
    (row, index) => ({
      id: String(row.dataset.optionId ?? `table-${index + 1}`).trim(),
      barcode: String(
        row.querySelector("[data-field='barcode']")?.value ?? "",
      ).trim(),
      saleOption: String(
        row.querySelector("[data-field='saleOption']")?.value ?? "",
      ).trim(),
    }),
  );
}

function readChinaOptionPanelRows() {
  return [
    ...(detailForm?.querySelectorAll("[data-optimized-china-order-map-row]") ?? []),
  ].map((row, index) => ({
    id: String(row.dataset.optionId ?? `panel-${index + 1}`).trim(),
    barcode: String(row.dataset.barcode ?? "").trim(),
    saleOption: String(row.dataset.saleOption ?? "").trim(),
    chinaOption: String(
      row.querySelector("[data-optimized-china-order-option-input]")?.value ?? "",
    ).trim(),
  }));
}

function samePanelRows(current, aligned) {
  const left = current.map((row) => ({
    barcode: normalizeRegisteredBcode(row.barcode),
    saleOption: String(row.saleOption ?? "").trim(),
    chinaOption: String(row.chinaOption ?? "").trim(),
  }));
  const right = aligned.map((row) => ({
    barcode: row.barcode,
    saleOption: row.saleOption,
    chinaOption: row.chinaOption,
  }));
  return JSON.stringify(left) === JSON.stringify(right);
}

function renderAlignedRows(list, rows) {
  if (!rows.length) {
    list.innerHTML =
      '<div class="optimized-china-order-empty">위 발주·입고 옵션가격에 유효한 바코드·위치코드가 없습니다. B-code를 먼저 등록하세요.</div>';
    return;
  }
  list.innerHTML = rows
    .map(
      (row) => `
        <div class="optimized-china-order-map-row" data-optimized-china-order-map-row data-option-id="${escapeAttribute(row.id)}" data-barcode="${escapeAttribute(row.barcode)}" data-sale-option="${escapeAttribute(row.saleOption)}">
          <span class="optimized-china-order-barcode">${escapeHtml(row.barcode)}</span>
          <span class="optimized-china-order-sale-option">${escapeHtml(row.saleOption || "단품")}</span>
          <input class="optimized-china-order-option-input" data-optimized-china-order-option-input type="text" autocomplete="off" placeholder="1688 실제 중국옵션명" value="${escapeAttribute(row.chinaOption)}" />
        </div>`,
    )
    .join("");
}

function updateAuthorityStatus(panel, count) {
  if (panel.dataset.dirty === "true") return;
  const message = count
    ? `발주·입고 옵션가격에 바코드·위치코드가 등록된 ${count}개 B-code만 표시합니다.`
    : "발주·입고 옵션가격에 등록된 유효 B-code가 없어 중국옵션을 표시하지 않습니다.";
  setPanelStatus(panel, message, count ? "saved" : "");
}

function setPanelStatus(panel, message, tone = "") {
  const status = panel.querySelector("#optimized-china-order-map-status");
  if (!status) return;
  status.textContent = message;
  status.dataset.tone = tone;
}

async function fetchItem(itemId) {
  const response = await fetch(
    `${OPTIMIZED_API}?${new URLSearchParams({ mode: "item", id: itemId }).toString()}`,
    {
      headers: { Accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store",
    },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok !== true || !body?.item) {
    throw new Error(
      body?.message || "상품 상세의 B-code 옵션정보를 불러오지 못했습니다.",
    );
  }
  return body.item;
}

function escapeAttribute(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
    .replaceAll("\n", " ");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
