const button = document.querySelector("#ai-saurus-bulk-detail");
const status = document.querySelector("#ai-saurus-bulk-detail-status");
const table = document.querySelector("#launch-table-body");
const limit = 20;
let pending = false;

function selectedIds() {
  return [...(table?.querySelectorAll("tr[data-id] input[data-ai-saurus-selection]:checked:not(:disabled)") ?? [])]
    .map((input) => input.closest("tr[data-id]")?.dataset.id).filter(Boolean);
}

function syncButton() {
  if (!button) return;
  const count = selectedIds().length;
  button.disabled = pending || count === 0 || count > limit;
  button.textContent = pending
    ? "AI 사우루스 작업 묶음 준비 중…"
    : `AI 사우루스 상세페이지 제작${count ? ` (${count}건)` : ""}`;
  button.title = count > limit ? `한 번에 최대 ${limit}개 상품을 선택하세요.` : "선택한 상품의 일괄 제작 준비를 엽니다.";
}

async function openWorkbench() {
  const ids = selectedIds();
  if (pending || !ids.length || ids.length > limit) return;
  pending = true;
  syncButton();
  if (status) status.textContent = "";
  try {
    const response = await fetch("/api/ai-saurus-bulk-detail", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create", itemIds: ids }),
    });
    const result = await response.json().catch(() => ({}));
    if (response.status === 401) {
      const login = "/login?force=1&next=%2Fproduct-launch-tracker";
      try { window.top.location.assign(login); }
      catch { window.location.assign(login); }
      return;
    }
    if (!response.ok || !result.batch?.id) throw new Error(result.message || "AI 사우루스 작업 묶음을 열지 못했습니다.");
    const href = `/ai-saurus-bulk-detail?batch=${encodeURIComponent(result.batch.id)}`;
    try { window.top.location.assign(href); }
    catch { window.location.assign(href); }
  } catch (error) {
    if (status) status.textContent = error instanceof Error ? error.message : "작업 묶음을 열지 못했습니다.";
  } finally {
    pending = false;
    syncButton();
  }
}

button?.addEventListener("click", () => void openWorkbench());
document.addEventListener("change", () => window.setTimeout(syncButton, 0));
document.querySelector("#clear-selection-button")?.addEventListener("click", () => window.setTimeout(syncButton, 0));
if (table) new MutationObserver(syncButton).observe(table, { childList: true, subtree: true });
syncButton();
