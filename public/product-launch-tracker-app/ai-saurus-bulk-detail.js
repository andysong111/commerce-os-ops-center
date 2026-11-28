const button = document.querySelector("#ai-saurus-bulk-detail");
const status = document.querySelector("#ai-saurus-bulk-detail-status");
const table = document.querySelector("#launch-table-body");
const warningDialog = document.querySelector("#saurus-image-warning");
const warningList = document.querySelector("#saurus-image-warning-items");
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
  button.title = count > limit ? `한 번에 최대 ${limit}개 상품을 선택하세요.` : "2026년 8월 1일부터 확정 소싱한 신규상품의 1688 수집과 제작을 엽니다.";
}

function askAboutExistingImages(warnings) {
  if (!warningDialog || !warningList) throw new Error("페이지를 새로고침한 뒤 제작을 다시 눌러 주세요.");
  warningList.replaceChildren(...warnings.map(({ model, name, bCodes, fields }) => {
    const row = document.createElement("li");
    const title = document.createElement("strong");
    title.textContent = [bCodes?.join(" · "), model, name].filter(Boolean).join(" · ");
    const description = document.createElement("div");
    description.textContent = `${fields.join(", ")}가 이미 입력되어 있습니다.`;
    row.append(title, description);
    return row;
  }));
  warningDialog.returnValue = "cancel";
  return new Promise((resolve) => {
    warningDialog.addEventListener("close", () => resolve(warningDialog.returnValue), { once: true });
    warningDialog.showModal();
  });
}

async function openWorkbench() {
  let ids = selectedIds();
  if (pending || !ids.length || ids.length > limit) return;
  pending = true;
  syncButton();
  if (status) status.textContent = "";
  try {
    const imageOverrides = Object.create(null);
    while (ids.length) {
      const response = await fetch("/api/ai-saurus-bulk-detail", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", itemIds: ids, imageOverrides }),
      });
      const result = await response.json().catch(() => ({}));
      if (response.status === 401) {
        const login = "/login?force=1&next=%2Fproduct-launch-tracker";
        try { window.top.location.assign(login); }
        catch { window.location.assign(login); }
        return;
      }
      if (response.status === 409 && result.code === "AI_SAURUS_EXISTING_IMAGES" && result.imageWarnings?.length) {
        const choice = await askAboutExistingImages(result.imageWarnings);
        if (choice === "force") {
          for (const { id, token } of result.imageWarnings) imageOverrides[id] = token;
        } else if (choice === "skip") {
          const excluded = new Set(result.imageWarnings.map(({ id }) => id));
          ids = ids.filter((id) => !excluded.has(id));
        } else {
          return;
        }
        continue;
      }
      if (!response.ok || !result.batch?.id) throw new Error(result.message || "AI 사우루스 작업 묶음을 열지 못했습니다.");
      const href = `/ai-saurus-bulk-detail?batch=${encodeURIComponent(result.batch.id)}`;
      try { window.top.location.assign(href); }
      catch { window.location.assign(href); }
      return;
    }
    if (status) status.textContent = "기존 이미지가 있는 상품을 제외해 진행할 상품이 없습니다.";
  } catch (error) {
    if (status) status.textContent = error instanceof Error ? error.message : "작업 묶음을 열지 못했습니다.";
  } finally {
    pending = false;
    syncButton();
    if (document.activeElement === document.body) button?.focus?.();
  }
}

button?.addEventListener("click", () => void openWorkbench());
document.addEventListener("change", () => window.setTimeout(syncButton, 0));
document.querySelector("#clear-selection-button")?.addEventListener("click", () => window.setTimeout(syncButton, 0));
if (table) new MutationObserver(syncButton).observe(table, { childList: true, subtree: true });
syncButton();
