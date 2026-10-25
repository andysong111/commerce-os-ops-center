const RECOVERY_ENDPOINT = "/api/product-launch-tracker/seo-material-recovery";
const TRACKER_PAGE_ENDPOINT = "/api/product-launch-tracker/optimized";
const BUTTON_ID = "seo-material-recovery-button";
const DIALOG_ID = "seo-material-recovery-dialog";
const MAX_INSTALL_ATTEMPTS = 40;
const RECOVERY_BATCH_SIZE = 1;
const RECOVERY_REQUEST_TIMEOUT_MS = 90_000;
const RECOVERY_PREVIEW_ATTEMPTS = 2;

let installAttempts = 0;
let installTimer = null;

function text(value) {
  return String(value ?? "").trim();
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function statusLabel(status) {
  const labels = {
    ready_after_recovery: "복구 후 준비완료",
    partially_recovered: "일부 복구",
    unresolved: "확인 필요",
    already_ready: "이미 준비완료",
    excluded: "SEO 제외",
    receipt_pending: "입고대기중",
    archived: "보관됨",
  };
  return labels[text(status)] || text(status) || "확인 필요";
}

function showMessage(message) {
  if (typeof window.showToast === "function") {
    window.showToast(message);
    return;
  }
  window.alert(message);
}

async function requestRecovery(body) {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    RECOVERY_REQUEST_TIMEOUT_MS,
  );
  try {
    const response = await fetch(RECOVERY_ENDPOINT, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok !== true) {
      throw new Error(payload?.message || `SEO 재료 검사에 실패했습니다. (${response.status})`);
    }
    return payload;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("자료 조회가 90초를 넘었습니다. 다시 확인이 필요합니다.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function requestRecoveryPreview(modelNumbers) {
  let lastError = null;
  for (let attempt = 1; attempt <= RECOVERY_PREVIEW_ATTEMPTS; attempt += 1) {
    try {
      return await requestRecovery({ action: "preview", modelNumbers });
    } catch (error) {
      lastError = error;
      if (attempt < RECOVERY_PREVIEW_ATTEMPTS) {
        await new Promise((resolve) => window.setTimeout(resolve, 800));
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("SEO 재료를 다시 확인하지 못했습니다.");
}

async function readRecoveryTargets() {
  const targets = new Map();
  let page = 1;
  let pageCount = 1;
  do {
    const params = new URLSearchParams({
      mode: "page",
      page: String(page),
      pageSize: "100",
      unfinishedOnly: "false",
    });
    const response = await fetch(`${TRACKER_PAGE_ENDPOINT}?${params.toString()}`, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok !== true) {
      throw new Error(payload?.message || "SEO 재료 검사 대상을 불러오지 못했습니다.");
    }
    for (const item of list(payload?.items)) {
      if (text(item?.archivedAt)) continue;
      if (item?.readiness?.ready === true) continue;
      if (item?.seoExclusion?.excluded === true) continue;
      if (item?.receiptPending === true) continue;
      const modelNumber = text(item?.modelNumber).toUpperCase().replace(/\s+/g, "");
      if (modelNumber && !targets.has(modelNumber)) {
        targets.set(modelNumber, {
          modelNumber,
          productName: text(item?.productName),
        });
      }
    }
    pageCount = Math.max(1, Number(payload?.pageCount) || 1);
    page += 1;
  } while (page <= pageCount);
  return [...targets.values()];
}

function chunk(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

export function combineRecoveryReports(batches) {
  const sum = (key) =>
    batches.reduce((total, batch) => total + (Number(batch.report?.[key]) || 0), 0);
  return {
    requestedCount: sum("requestedCount"),
    changedCount: sum("changedCount"),
    readyAfterCount: sum("readyAfterCount"),
    unresolvedCount: sum("unresolvedCount"),
    receiptPendingCount: sum("receiptPendingCount"),
    sourceFailureCount: sum("sourceFailureCount"),
    failedBatchCount: batches.filter((batch) => batch.failed === true).length,
    results: batches.flatMap((batch) => list(batch.report?.results)),
    batches,
  };
}

export function failedRecoveryBatchReport(targets, error) {
  const message = error instanceof Error
    ? error.message
    : "외부 자료를 불러오지 못했습니다.";
  return {
    requestedCount: targets.length,
    changedCount: 0,
    readyAfterCount: 0,
    unresolvedCount: targets.length,
    receiptPendingCount: 0,
    sourceFailureCount: targets.length,
    results: targets.map((target) => ({
      modelNumber: target.modelNumber,
      productName: target.productName,
      status: "unresolved",
      changed: false,
      changedFields: [],
      afterErrors: [message],
      unresolved: [`자료원 조회 실패: ${message}`],
    })),
  };
}

export function readyRecoveryModelNumbers(report) {
  const models = [];
  const seen = new Set();
  for (const row of list(report?.results)) {
    const modelNumber = text(row?.modelNumber);
    if (
      row?.changed !== true ||
      text(row?.status) !== "ready_after_recovery" ||
      !modelNumber ||
      seen.has(modelNumber)
    ) {
      continue;
    }
    seen.add(modelNumber);
    models.push(modelNumber);
  }
  return models;
}

export function recoveryModelStatus(report, modelNumber) {
  const normalizedModelNumber = text(modelNumber);
  const row = list(report?.results).find(
    (candidate) => text(candidate?.modelNumber) === normalizedModelNumber,
  );
  return text(row?.status);
}

async function previewRecoveryBatches(button) {
  const targets = await readRecoveryTargets();
  const targetBatches = chunk(targets, RECOVERY_BATCH_SIZE);
  const batches = [];
  for (const [index, batchTargets] of targetBatches.entries()) {
    button.textContent = `SEO 재료 검사 중 (${index + 1}/${targetBatches.length})`;
    const modelNumbers = batchTargets.map((target) => target.modelNumber);
    try {
      const report = await requestRecoveryPreview(modelNumbers);
      batches.push({
        modelNumbers,
        report,
        failed: false,
      });
    } catch (batchError) {
      if (batchTargets.length === 1) {
        batches.push({
          modelNumbers,
          report: failedRecoveryBatchReport(batchTargets, batchError),
          failed: true,
        });
        continue;
      }
      for (const [targetIndex, target] of batchTargets.entries()) {
        button.textContent = `자료 조회 개별 재검사 (${targetIndex + 1}/${batchTargets.length})`;
        try {
          const report = await requestRecoveryPreview([target.modelNumber]);
          batches.push({
            modelNumbers: [target.modelNumber],
            report,
            failed: false,
          });
        } catch (targetError) {
          const report = failedRecoveryBatchReport([target], targetError);
          batches.push({
            modelNumbers: [target.modelNumber],
            report,
            failed: true,
          });
        }
      }
    }
  }
  return combineRecoveryReports(batches);
}

function recoveryRows(report) {
  return list(report?.results).filter((row) => row?.changed || list(row?.unresolved).length);
}

export function recoveryRowSummary(row) {
  const changes = list(row?.changedFields).map(text).filter(Boolean);
  const unresolved = list(row?.unresolved).map(text).filter(Boolean);
  const details = [];
  if (changes.length) details.push(`보완: ${changes.join(", ")}`);
  if (unresolved.length) details.push(`남음: ${unresolved.slice(0, 2).join(" · ")}`);
  return {
    modelNumber: text(row?.modelNumber),
    productName: text(row?.productName),
    status: statusLabel(row?.status),
    detail: details.join(" · ") || "추가 확인이 필요합니다.",
  };
}

function ensureDialog() {
  let dialog = document.querySelector(`#${DIALOG_ID}`);
  if (dialog) return dialog;

  dialog = document.createElement("dialog");
  dialog.id = DIALOG_ID;
  dialog.className = "dialog seo-material-recovery-dialog";
  dialog.innerHTML = `
    <form method="dialog">
      <div class="dialog-header">
        <div><p class="eyebrow">SEO 등록 전 점검</p><h2>SEO 재료 검사 결과</h2></div>
        <button class="icon-button" value="cancel" aria-label="닫기">×</button>
      </div>
      <div class="seo-material-recovery-summary" data-role="summary"></div>
      <div class="seo-material-recovery-list" data-role="list"></div>
      <div class="dialog-actions dialog-actions-end">
        <button class="button button-ghost" value="cancel">닫기</button>
        <button class="button button-primary" type="button" data-role="apply">확실한 자료만 반영</button>
      </div>
    </form>
  `;
  document.body.append(dialog);
  return dialog;
}

function renderPreview(dialog, report) {
  const summary = dialog.querySelector('[data-role="summary"]');
  const listElement = dialog.querySelector('[data-role="list"]');
  const applyButton = dialog.querySelector('[data-role="apply"]');
  const rows = recoveryRows(report).map(recoveryRowSummary);
  const readyCount = readyRecoveryModelNumbers(report).length;

  summary.replaceChildren();
  for (const [label, value] of [
    ["자동 보완", Number(report?.changedCount) || 0],
    ["보완 후 준비완료", Number(report?.readyAfterCount) || 0],
    ["추가 확인", Number(report?.unresolvedCount) || 0],
    ["입고대기", Number(report?.receiptPendingCount) || 0],
    ["자료 조회 실패", Number(report?.sourceFailureCount) || 0],
  ]) {
    const item = document.createElement("div");
    item.innerHTML = `<strong>${value}건</strong><span>${label}</span>`;
    summary.append(item);
  }

  listElement.replaceChildren();
  for (const row of rows) {
    const item = document.createElement("div");
    item.className = "seo-material-recovery-row";
    const identity = document.createElement("strong");
    identity.textContent = `${row.modelNumber} ${row.productName}`.trim();
    const status = document.createElement("span");
    status.textContent = row.status;
    const detail = document.createElement("small");
    detail.textContent = row.detail;
    item.append(identity, status, detail);
    listElement.append(item);
  }
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "seo-material-recovery-empty";
    empty.textContent = "현재 자동으로 보완하거나 추가 확인할 상품이 없습니다.";
    listElement.append(empty);
  }

  applyButton.hidden = !(readyCount > 0 && list(report?.batches).length);
  applyButton.textContent = `준비완료 ${readyCount}건 반영`;
}

async function applyRecovery(dialog, button, report) {
  const applyButton = dialog.querySelector('[data-role="apply"]');
  const previousText = applyButton.textContent;
  applyButton.disabled = true;
  applyButton.textContent = "반영 중...";
  try {
    let appliedCount = 0;
    const applyFailures = [];
    const modelNumbers = readyRecoveryModelNumbers(report);
    for (const [index, modelNumber] of modelNumbers.entries()) {
      applyButton.textContent = `반영 중 (${index + 1}/${modelNumbers.length})`;
      let lastError = null;
      let completed = false;
      for (let attempt = 1; attempt <= 2 && !completed; attempt += 1) {
        try {
          const latest = await requestRecoveryPreview([modelNumber]);
          const latestStatus = recoveryModelStatus(latest, modelNumber);
          if (latestStatus === "already_ready") {
            appliedCount += 1;
            completed = true;
            break;
          }
          if (!readyRecoveryModelNumbers(latest).includes(modelNumber)) {
            throw new Error("최신 검사에서 준비완료 상태가 아닙니다.");
          }
          const applied = await requestRecovery({
            action: "apply",
            modelNumbers: [modelNumber],
            expectedPlanHash: text(latest?.planHash),
          });
          if ((Number(applied?.appliedCount) || 0) < 1) {
            throw new Error("반영 결과를 확인하지 못했습니다.");
          }
          appliedCount += 1;
          completed = true;
        } catch (error) {
          lastError = error;
        }
      }
      if (!completed) {
        applyFailures.push({
          modelNumber,
          message: lastError instanceof Error
            ? lastError.message
            : "반영 결과를 확인하지 못했습니다.",
        });
      }
    }
    dialog.close();
    const retryMessage = applyFailures.length
      ? ` 미반영 ${applyFailures.length}건: ${applyFailures
          .map((failure) => failure.modelNumber)
          .join(", ")}은 다시 검사합니다.`
      : "";
    showMessage(`SEO 재료 ${appliedCount}건을 반영했습니다.${retryMessage}`);
    button.textContent = applyFailures.length ? "재검사 필요" : "반영 완료";
    window.setTimeout(() => window.location.reload(), 350);
  } catch (error) {
    showMessage(error instanceof Error ? error.message : "SEO 재료를 반영하지 못했습니다.");
    applyButton.disabled = false;
    applyButton.textContent = previousText;
  }
}

async function previewRecovery(button) {
  const previousText = button.textContent;
  button.disabled = true;
  button.textContent = "전체 상품 검사 중...";
  try {
    const report = await previewRecoveryBatches(button);
    const dialog = ensureDialog();
    renderPreview(dialog, report);
    const applyButton = dialog.querySelector('[data-role="apply"]');
    applyButton.onclick = () => void applyRecovery(dialog, button, report);
    dialog.showModal();
  } catch (error) {
    showMessage(error instanceof Error ? error.message : "SEO 재료를 검사하지 못했습니다.");
  } finally {
    button.disabled = false;
    button.textContent = previousText;
  }
}

function installStyles() {
  if (document.querySelector("#seo-material-recovery-style")) return;
  const style = document.createElement("style");
  style.id = "seo-material-recovery-style";
  style.textContent = `
    .seo-material-recovery-button { min-width: 154px; }
    .seo-material-recovery-dialog { width: min(760px, calc(100vw - 28px)); }
    .seo-material-recovery-summary {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
      margin: 12px 0 16px;
    }
    .seo-material-recovery-summary > div {
      display: grid;
      gap: 2px;
      padding: 10px 12px;
      border: 1px solid #dbe3ee;
      border-radius: 6px;
      background: #f8fafc;
    }
    .seo-material-recovery-summary strong { font-size: 17px; }
    .seo-material-recovery-summary span,
    .seo-material-recovery-row small { color: #64748b; }
    .seo-material-recovery-list {
      display: grid;
      gap: 1px;
      max-height: min(52vh, 520px);
      overflow: auto;
      border-block: 1px solid #dbe3ee;
    }
    .seo-material-recovery-row {
      display: grid;
      grid-template-columns: minmax(180px, 1.4fr) minmax(100px, .7fr) minmax(220px, 2fr);
      gap: 12px;
      align-items: center;
      min-height: 48px;
      padding: 8px 4px;
      border-bottom: 1px solid #edf1f6;
    }
    .seo-material-recovery-row:last-child { border-bottom: 0; }
    .seo-material-recovery-empty { color: #64748b; padding: 16px 4px; }
    @media (max-width: 700px) {
      .seo-material-recovery-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .seo-material-recovery-row { grid-template-columns: 1fr; gap: 3px; }
    }
  `;
  document.head.append(style);
}

function installButton() {
  const destination =
    document.querySelector("#bulk-action-group-data") ||
    document.querySelector(".bulk-controls");
  if (!destination) return false;
  let button = document.querySelector(`#${BUTTON_ID}`);
  if (!button) {
    button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.className = "button button-secondary seo-material-recovery-button";
    button.textContent = "SEO 재료 검사·복구";
    button.title = "전체 활성 상품의 SEO 필수 자료를 검사하고, 근거가 확실한 값만 보완합니다.";
    button.addEventListener("click", () => void previewRecovery(button));
  }
  if (button.parentElement !== destination) destination.prepend(button);
  return true;
}

function scheduleInstall() {
  if (installTimer) window.clearTimeout(installTimer);
  installStyles();
  if (installButton() || installAttempts >= MAX_INSTALL_ATTEMPTS) return;
  installAttempts += 1;
  installTimer = window.setTimeout(scheduleInstall, 100);
}

if (typeof document !== "undefined") scheduleInstall();

