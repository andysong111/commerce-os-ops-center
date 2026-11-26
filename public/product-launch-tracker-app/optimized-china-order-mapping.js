import {
  applyChinaOrderOptionMappings,
  normalizeChinaOrderOptionMappings,
  readChinaOrderOptionMappings,
} from "./lib/china-order-options.mjs";

const OPTIMIZED_API = "/api/product-launch-tracker/optimized";
const detailDialog = document.querySelector("#detail-dialog");
const detailForm = document.querySelector("#detail-form");
const RENDER_DELAYS = [0, 80, 220, 500, 900];
let pendingSave = null;
let renderTimers = [];
let renderSerial = 0;

installStyles();
scheduleRender();

document.addEventListener(
  "click",
  (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("button[data-action='detail']")) scheduleRender();
  },
  true,
);

detailDialog?.addEventListener("close", () => {
  clearRenderTimers();
  const panel = document.querySelector("#optimized-china-order-map-wrap");
  if (panel) panel.dataset.itemId = "";
});

detailForm?.addEventListener("submit", captureBeforeSave, true);
detailForm?.addEventListener("submit", schedulePersistAfterMainSave);
detailForm?.addEventListener("input", handleMappingInput, true);

function installStyles() {
  if (document.querySelector("#optimized-china-order-mapping-style")) return;
  const style = document.createElement("style");
  style.id = "optimized-china-order-mapping-style";
  style.textContent = `
    .optimized-china-order-map-wrap { margin-top: 22px; border-top: 1px solid #e2e8f0; padding-top: 18px; }
    .optimized-china-order-map-title { margin: 0; font-size: 14px; font-weight: 900; color: #0f172a; }
    .optimized-china-order-map-help { margin: 5px 0 0; font-size: 12px; line-height: 1.6; color: #64748b; }
    .optimized-china-order-map-list { display: grid; gap: 8px; margin-top: 12px; }
    .optimized-china-order-map-row { display: grid; grid-template-columns: minmax(118px, 145px) minmax(150px, .8fr) minmax(260px, 1.4fr); gap: 8px; align-items: center; }
    .optimized-china-order-barcode { font: 800 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: #0f172a; }
    .optimized-china-order-sale-option { font-size: 12px; font-weight: 800; color: #334155; }
    .optimized-china-order-option-input { width: 100%; min-width: 0; border: 1px solid #cbd5e1; border-radius: 10px; padding: 10px 12px; font-size: 13px; background: #fff; }
    .optimized-china-order-option-input:focus { outline: 2px solid #bfdbfe; border-color: #2563eb; }
    .optimized-china-order-empty { border: 1px dashed #cbd5e1; border-radius: 10px; padding: 12px; font-size: 12px; color: #64748b; background: #f8fafc; }
    .optimized-china-order-status { margin-top: 10px; font-size: 12px; font-weight: 800; color: #64748b; }
    .optimized-china-order-status[data-tone='dirty'] { color: #b45309; }
    .optimized-china-order-status[data-tone='saved'] { color: #047857; }
    .optimized-china-order-status[data-tone='error'] { color: #b91c1c; }
    @media (max-width: 900px) { .optimized-china-order-map-row { grid-template-columns: 1fr; } }
  `;
  document.head.append(style);
}

function scheduleRender() {
  clearRenderTimers();
  const serial = ++renderSerial;
  for (const delay of RENDER_DELAYS) {
    renderTimers.push(
      window.setTimeout(() => {
        if (serial !== renderSerial) return;
        void renderCurrentItemMapping(serial);
      }, delay),
    );
  }
}

function clearRenderTimers() {
  for (const timer of renderTimers) window.clearTimeout(timer);
  renderTimers = [];
}

async function renderCurrentItemMapping(serial) {
  if (!detailForm || !detailDialog?.open) return;
  const itemId = String(detailForm.elements?.id?.value ?? "").trim();
  if (!itemId) return;
  const panel = ensureMappingPanel();
  if (!panel) return;
  if (panel.dataset.itemId === itemId && panel.dataset.dirty === "true") return;
  try {
    const item = await fetchItem(itemId);
    if (serial !== renderSerial || !detailDialog?.open) return;
    panel.dataset.itemId = itemId;
    panel.dataset.dirty = "false";
    renderMappings(readChinaOrderOptionMappings(item));
    updateSectionHeading();
    setStatus(
      "1688 주문에는 이 모델의 발주용 링크를 사용합니다. B-code별로는 실제 중국옵션명만 저장하세요.",
    );
  } catch (error) {
    setStatus(
      error instanceof Error ? error.message : "B-code별 중국옵션을 불러오지 못했습니다.",
      "error",
    );
  }
}

function ensureMappingPanel() {
  const section = detailForm?.querySelector("#optimized-china-product-links-section");
  if (!section) return null;
  let panel = section.querySelector("#optimized-china-order-map-wrap");
  if (panel) return panel;
  panel = document.createElement("div");
  panel.id = "optimized-china-order-map-wrap";
  panel.className = "optimized-china-order-map-wrap";
  panel.dataset.dirty = "false";
  panel.innerHTML = `
    <h4 class="optimized-china-order-map-title">B-code별 중국옵션</h4>
    <p class="optimized-china-order-map-help">같은 모델은 발주용 링크를 공유합니다. 여기서는 중국 판매자의 실제 옵션명을 입력하세요.</p>
    <div id="optimized-china-order-map-list" class="optimized-china-order-map-list"></div>
    <div id="optimized-china-order-map-status" class="optimized-china-order-status"></div>
  `;
  section.append(panel);
  updateSectionHeading();
  return panel;
}

function updateSectionHeading() {
  const section = detailForm?.querySelector("#optimized-china-product-links-section");
  const heading = section?.querySelector(".section-title-row h3");
  const help = section?.querySelector(".section-title-row p");
  if (heading) heading.textContent = "중국 상품링크 · 중국옵션";
  if (help) {
    help.textContent =
      "중국 링크는 최대 5개까지 저장하며 1번 링크가 해당 모델의 발주 기준링크입니다. B-code별로는 중국옵션명만 저장합니다.";
  }
}

function renderMappings(mappings) {
  const list = detailForm?.querySelector("#optimized-china-order-map-list");
  if (!list) return;
  if (!mappings.length) {
    list.innerHTML =
      '<div class="optimized-china-order-empty">저장된 B-code 옵션이 없습니다. 위의 발주·입고 옵션가격에서 옵션 바코드·위치코드를 먼저 저장하세요.</div>';
    return;
  }
  list.innerHTML = mappings
    .map(
      (mapping) => `
        <div class="optimized-china-order-map-row" data-optimized-china-order-map-row data-option-id="${escapeAttribute(mapping.id)}" data-barcode="${escapeAttribute(mapping.barcode)}" data-sale-option="${escapeAttribute(mapping.saleOption)}">
          <span class="optimized-china-order-barcode">${escapeHtml(mapping.barcode || "B-code 미입력")}</span>
          <span class="optimized-china-order-sale-option">${escapeHtml(mapping.saleOption || "판매옵션 미입력")}</span>
          <input class="optimized-china-order-option-input" data-optimized-china-order-option-input type="text" autocomplete="off" placeholder="1688 실제 중국옵션명" value="${escapeAttribute(mapping.chinaOption)}" />
        </div>`,
    )
    .join("");
}

function readMappingValues() {
  return [...(detailForm?.querySelectorAll("[data-optimized-china-order-map-row]") ?? [])].map(
    (row) => ({
      id: String(row.dataset.optionId ?? "").trim(),
      barcode: String(row.dataset.barcode ?? "").trim(),
      saleOption: String(row.dataset.saleOption ?? "").trim(),
      chinaOption: String(
        row.querySelector("[data-optimized-china-order-option-input]")?.value ?? "",
      ).trim(),
    }),
  );
}

function handleMappingInput(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target?.matches("[data-optimized-china-order-option-input]")) return;
  markDirty("B-code별 중국옵션 변경사항이 있습니다. 상품 저장 버튼을 눌러 반영하세요.");
}

function markDirty(message) {
  const panel = detailForm?.querySelector("#optimized-china-order-map-wrap");
  if (panel) panel.dataset.dirty = "true";
  setStatus(message, "dirty");
}

function captureBeforeSave(event) {
  if (event.submitter?.value !== "save") return;
  const itemId = String(detailForm?.elements?.id?.value ?? "").trim();
  if (!itemId) return;
  const panel = detailForm?.querySelector("#optimized-china-order-map-wrap");
  if (!panel) return;
  try {
    const mappings = normalizeChinaOrderOptionMappings(readMappingValues());
    pendingSave = { itemId, mappings };
  } catch (error) {
    pendingSave = null;
    event.preventDefault();
    event.stopImmediatePropagation();
    const message =
      error instanceof Error ? error.message : "B-code별 중국옵션을 확인하세요.";
    setStatus(message, "error");
    window.alert(message);
  }
}

function schedulePersistAfterMainSave(event) {
  if (event.submitter?.value !== "save" || !pendingSave) return;
  const draft = pendingSave;
  pendingSave = null;
  waitForMainSave(draft, 0);
}

function waitForMainSave(draft, attempt) {
  if (attempt > 80) {
    console.error("China option mapping save timed out waiting for product detail save.");
    return;
  }
  window.setTimeout(() => {
    if (detailDialog?.open) {
      waitForMainSave(draft, attempt + 1);
      return;
    }
    void persistMapping(draft);
  }, attempt < 10 ? 80 : 150);
}

async function persistMapping(draft) {
  try {
    const item = await fetchItem(draft.itemId);
    const next = applyChinaOrderOptionMappings(
      item,
      draft.mappings,
      item.chinaProductLinks,
      { now: new Date(), updatedBy: "승준" },
    );
    const response = await fetch(OPTIMIZED_API, {
      method: "PATCH",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        operation: "patch_item",
        itemId: draft.itemId,
        patch: { orderOptions: next.orderOptions },
      }),
      credentials: "same-origin",
      cache: "no-store",
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok !== true) {
      throw new Error(body?.message || "B-code별 중국옵션을 서버에 저장하지 못했습니다.");
    }
    const panel = detailForm?.querySelector("#optimized-china-order-map-wrap");
    if (panel) panel.dataset.dirty = "false";
    window.dispatchEvent(
      new CustomEvent("product-launch-tracker:external-state", {
        detail: { source: "optimized-china-order-mapping", itemId: draft.itemId },
      }),
    );
  } catch (error) {
    console.error(error);
    window.alert(
      error instanceof Error
        ? `${error.message}\n상품 기본정보는 저장됐지만 중국옵션은 다시 확인해야 합니다.`
        : "B-code별 중국옵션을 저장하지 못했습니다.",
    );
  }
}

async function fetchItem(itemId) {
  const response = await fetch(
    `${OPTIMIZED_API}?${new URLSearchParams({ mode: "item", id: itemId }).toString()}`,
    { headers: { Accept: "application/json" }, credentials: "same-origin", cache: "no-store" },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok !== true || !body?.item) {
    throw new Error(body?.message || "상품 상세의 B-code 옵션정보를 불러오지 못했습니다.");
  }
  return body.item;
}

function setStatus(message, tone = "") {
  const status = detailForm?.querySelector("#optimized-china-order-map-status");
  if (!status) return;
  status.textContent = message;
  status.dataset.tone = tone;
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
