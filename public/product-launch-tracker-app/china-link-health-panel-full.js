const HEALTH_API = "/api/product-launch-tracker/china-link-health";
const SHIFT_API = "/api/product-launch-tracker/china-link-health/shift";
const REQUIRED_COLLECTOR_VERSION = "0.1.2";
const WORKER_NAME = "commerce-os-china-link-audit-worker";
const WORKER_CONTEXT_PREFIX = "commerce-os-1688-context:";
const CONTEXT_HASH_PARAM = "commerce_os_keyword_lab_context";
const CALLBACK_SOURCE = "commerce-os-china-link-audit-callback";
const CANCEL_EVENT = "commerce-os-china-link-audit-cancel";
const RESULT_BATCH_SIZE = 10;
const BETWEEN_LINK_DELAY_MS = 1_200;
const LINK_TIMEOUT_MS = 22_000;
const MAX_INSTALL_ATTEMPTS = 60;

let panel = null;
let dialog = null;
let summary = null;
let errorRows = [];
let auditRunning = false;
let auditCancelled = false;
let auditWorker = null;
let auditResults = [];
let installAttempts = 0;
let installTimer = null;
let parentCollectorDocument = null;

function text(value) {
  return String(value ?? "").trim();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function encodeBase64Utf8(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

function decodeBase64Utf8(value) {
  const binary = atob(String(value || ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function versionAtLeast(current, required) {
  const parse = (value) =>
    String(value || "")
      .split(".")
      .slice(0, 3)
      .map((part) => Number.parseInt(part, 10) || 0);
  const left = parse(current);
  const right = parse(required);
  for (let index = 0; index < 3; index += 1) {
    if ((left[index] || 0) > (right[index] || 0)) return true;
    if ((left[index] || 0) < (right[index] || 0)) return false;
  }
  return true;
}

function collectorVersion() {
  const local =
    document.documentElement.dataset.commerceOsKeywordLabCollectorVersion || "";
  if (local) return local;
  try {
    if (window.parent && window.parent !== window) {
      return (
        window.parent.document.documentElement.dataset
          .commerceOsKeywordLabCollectorVersion || ""
      );
    }
  } catch {
    // Same-origin parent is expected, but keep the panel usable if embedding changes.
  }
  return "";
}

async function requestJson(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok !== true) {
    throw new Error(body?.message || `요청 실패 · HTTP ${response.status}`);
  }
  return body;
}

function dateText(value) {
  if (!value) return "미검사";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ko-KR");
}

function escapeHtml(value) {
  return text(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function installStyles() {
  if (document.querySelector("#china-link-health-panel-styles")) return;
  const style = document.createElement("style");
  style.id = "china-link-health-panel-styles";
  style.textContent = `
    .china-link-health-panel{margin:12px 16px;padding:15px;border:1px solid #fca5a5;border-radius:14px;background:linear-gradient(135deg,#fff7ed,#fff);box-shadow:0 3px 10px rgb(153 27 27 / 6%)}
    .china-link-health-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap}
    .china-link-health-title{color:#7f1d1d;font-size:14px;font-weight:900}.china-link-health-copy{margin-top:4px;color:#64748b;font-size:11px;line-height:1.5}
    .china-link-health-stats{display:grid;grid-template-columns:repeat(5,minmax(100px,1fr));gap:8px;margin-top:12px}.china-link-health-stat{padding:10px 11px;border:1px solid #fed7aa;border-radius:10px;background:#fff}.china-link-health-stat span{display:block;color:#64748b;font-size:10px;font-weight:800}.china-link-health-stat strong{display:block;margin-top:3px;color:#0f172a;font-size:18px;font-weight:950}
    .china-link-health-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:12px}.china-link-health-actions .button{min-height:34px;padding:7px 11px;white-space:nowrap}.china-link-health-message{margin-top:10px;padding:9px 11px;border-radius:9px;background:#fff;color:#7c2d12;font-size:11px;font-weight:750;line-height:1.5}.china-link-health-progress{margin-top:8px;height:8px;overflow:hidden;border-radius:999px;background:#ffedd5}.china-link-health-progress>i{display:block;height:100%;background:#f97316;transition:width .2s ease}
    .china-link-health-dialog{width:min(1120px,94vw);max-height:86vh;padding:0;border:0;border-radius:16px;box-shadow:0 24px 70px rgb(15 23 42 / 35%)}.china-link-health-dialog::backdrop{background:rgb(15 23 42 / 48%)}.china-link-health-dialog-head{position:sticky;top:0;z-index:2;display:flex;justify-content:space-between;gap:12px;padding:16px 18px;background:#fff;border-bottom:1px solid #e2e8f0}.china-link-health-dialog-body{padding:15px 18px 20px;background:#f8fafc}.china-link-health-table{width:100%;border-collapse:collapse;background:#fff;font-size:11px}.china-link-health-table th,.china-link-health-table td{padding:9px 8px;border-bottom:1px solid #e2e8f0;text-align:left;vertical-align:top}.china-link-health-table th{position:sticky;top:0;background:#f1f5f9;color:#475569}.china-link-health-url{max-width:320px;overflow-wrap:anywhere;color:#475569}.china-link-health-error{color:#be123c;font-weight:800}
    @media(max-width:1100px){.china-link-health-stats{grid-template-columns:repeat(2,minmax(120px,1fr))}}
  `;
  document.head.append(style);
}

function installPanel() {
  const existing = document.querySelector("#china-link-health-panel");
  if (existing) {
    panel = existing;
    return true;
  }
  const workspace = document.querySelector(".workspace-card");
  if (!workspace?.parentElement) return false;
  panel = document.createElement("section");
  panel.id = "china-link-health-panel";
  panel.className = "china-link-health-panel";
  panel.innerHTML = `
    <div class="china-link-health-head"><div><div class="china-link-health-title">발주용 1688 링크 상태</div><div class="china-link-health-copy">검사를 시작하면 별도 창에서 발주에 쓰는 링크를 순서대로 확인합니다.</div></div><span id="china-link-health-collector" class="status-badge">Collector 확인 중</span></div>
    <div class="china-link-health-stats">
      <div class="china-link-health-stat"><span>현재 상품</span><strong data-health-stat="totalProducts">—</strong></div>
      <div class="china-link-health-stat"><span>발주용 링크 있음</span><strong data-health-stat="withPrimaryLink">—</strong></div>
      <div class="china-link-health-stat"><span>발주용 링크 오류</span><strong data-health-stat="linkErrors">—</strong></div>
      <div class="china-link-health-stat"><span>일시 오류</span><strong data-health-stat="temporaryErrors">—</strong></div>
      <div class="china-link-health-stat"><span>미검사</span><strong data-health-stat="unchecked">—</strong></div>
    </div>
    <div class="china-link-health-actions">
      <button type="button" class="button button-secondary" data-health-action="audit-due">미검사·30일 경과 저속 검사</button>
      <button type="button" class="button button-ghost" data-health-action="audit-all">전체 재검사</button>
      <button type="button" class="button button-danger" data-health-action="show-errors">오류 목록 보기</button>
      <button type="button" class="button button-ghost" data-health-action="cancel" hidden>검사 중단</button>
    </div>
    <div id="china-link-health-message" class="china-link-health-message">발주용 링크 상태를 불러오는 중입니다.</div><div class="china-link-health-progress" hidden><i style="width:0%"></i></div>`;
  workspace.parentElement.insertBefore(panel, workspace);
  panel.addEventListener("click", handlePanelClick);
  return true;
}

function scheduleInstall() {
  installStyles();
  if (installPanel()) {
    installAttempts = 0;
    updateCollectorBadge();
    void loadSummary();
    return;
  }
  if (installAttempts >= MAX_INSTALL_ATTEMPTS) return;
  installAttempts += 1;
  installTimer = window.setTimeout(scheduleInstall, 100);
}

function installDialog() {
  if (dialog) return;
  dialog = document.createElement("dialog");
  dialog.className = "china-link-health-dialog";
  dialog.innerHTML = `
    <div class="china-link-health-dialog-head"><div><strong>발주용 링크 오류 목록</strong><div class="china-link-health-copy">다음 발주 후보가 있으면 발주용 링크로 적용합니다.</div></div><button type="button" class="icon-button" data-health-dialog="close" aria-label="닫기">×</button></div>
    <div class="china-link-health-dialog-body"><div class="china-link-health-actions"><button type="button" class="button button-secondary" data-health-dialog="select-all">전체 선택</button><button type="button" class="button button-danger" data-health-dialog="shift-selected">선택 발주 링크 정리</button><button type="button" class="button button-danger" data-health-dialog="shift-all">오류 발주 링크 전체 정리</button></div><div id="china-link-health-dialog-message" class="china-link-health-message">오류 목록을 불러오는 중입니다.</div><div style="overflow:auto;max-height:60vh;margin-top:10px"><table class="china-link-health-table"><thead><tr><th></th><th>모델</th><th>오류</th><th>현재 발주용 링크</th><th>다음 발주 후보</th><th>검사시각</th></tr></thead><tbody id="china-link-health-error-body"></tbody></table></div></div>`;
  dialog.addEventListener("click", handleDialogClick);
  document.body.append(dialog);
}

function setMessage(message, error = false) {
  const element = panel?.querySelector("#china-link-health-message");
  if (!element) return;
  element.textContent = message;
  element.style.color = error ? "#be123c" : "#7c2d12";
}

function updateCollectorBadge() {
  const badge = panel?.querySelector("#china-link-health-collector");
  if (!badge) return;
  const version = collectorVersion();
  const ready = versionAtLeast(version, REQUIRED_COLLECTOR_VERSION);
  badge.textContent = ready ? `Collector ${version}` : `Collector ${version || "미설치"} · ${REQUIRED_COLLECTOR_VERSION} 필요`;
  badge.style.color = ready ? "#047857" : "#be123c";
}

function renderSummary(next) {
  summary = next || summary;
  if (!summary || !panel) return;
  for (const [key, value] of Object.entries(summary)) {
    const target = panel.querySelector(`[data-health-stat="${key}"]`);
    if (target) target.textContent = number(value).toLocaleString();
  }
  setMessage(`오류 ${number(summary.linkErrors)}건 · 다음 발주 후보 있음 ${number(summary.linkErrorsWithFallback)}건 · 마지막 검사 ${dateText(summary.lastCheckedAt)}`);
}

async function loadSummary() {
  try {
    const result = await requestJson(`${HEALTH_API}?mode=summary`);
    renderSummary(result.summary);
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "발주용 링크 상태를 읽지 못했습니다.", true);
  }
}

function setAuditUi(running, completed = 0, total = 0) {
  auditRunning = running;
  panel?.querySelectorAll("button[data-health-action]").forEach((button) => {
    if (!(button instanceof HTMLButtonElement)) return;
    if (button.dataset.healthAction === "cancel") {
      button.hidden = !running;
      button.disabled = false;
    } else {
      button.disabled = running;
    }
  });
  const progress = panel?.querySelector(".china-link-health-progress");
  const bar = progress?.querySelector("i");
  if (progress instanceof HTMLElement) progress.hidden = !running;
  if (bar instanceof HTMLElement) bar.style.width = total ? `${Math.round((completed / total) * 100)}%` : "0%";
}

function buildAuditUrl(row, context) {
  const target = new URL(row.primary_url);
  target.hash = new URLSearchParams({
    [CONTEXT_HASH_PARAM]: encodeBase64Utf8(context),
  }).toString();
  return target.toString();
}

function waitForWorkerResult(worker, row) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener(CANCEL_EVENT, onCancel);
      window.clearTimeout(timeout);
    };
    const finish = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onCancel = () => finish(null);
    const onMessage = (event) => {
      if (event.origin !== window.location.origin || event.source !== worker || event.data?.source !== CALLBACK_SOURCE || event.data?.type !== "china-link-audit-result") return;
      try {
        finish(decodeBase64Utf8(event.data.encoded));
      } catch (error) {
        fail(error);
      }
    };
    const timeout = window.setTimeout(() => {
      finish({
        itemId: row.item_id,
        url: row.primary_url,
        status: "temporary_error",
        errorCode: "timeout_or_external_redirect",
        errorMessage: "검사 결과가 제한시간 안에 돌아오지 않았습니다. 링크 오류로 확정하지 않았습니다.",
        finalUrl: "",
        collectorVersion: collectorVersion(),
        detectedText: "",
        checkedAt: new Date().toISOString(),
        source: "browser_collector_timeout",
      });
    }, LINK_TIMEOUT_MS);
    window.addEventListener("message", onMessage);
    window.addEventListener(CANCEL_EVENT, onCancel, { once: true });
  });
}

async function flushAuditResults(force = false) {
  if (!auditResults.length || (!force && auditResults.length < RESULT_BATCH_SIZE)) return;
  const batch = auditResults.splice(0, force ? auditResults.length : RESULT_BATCH_SIZE);
  try {
    await requestJson(HEALTH_API, {
      method: "POST",
      body: JSON.stringify({ action: "record_batch", results: batch }),
    });
  } catch (error) {
    auditResults.unshift(...batch);
    throw error;
  }
}

async function runAudit(scope) {
  if (auditRunning) return;
  const version = collectorVersion();
  if (!versionAtLeast(version, REQUIRED_COLLECTOR_VERSION)) {
    setMessage(`Collector ${REQUIRED_COLLECTOR_VERSION}로 업데이트한 뒤 검사하세요.`, true);
    return;
  }

  let rows = [];
  try {
    const query = new URLSearchParams({ mode: "list", scope, limit: "500", staleDays: "30" });
    const result = await requestJson(`${HEALTH_API}?${query.toString()}`);
    rows = Array.isArray(result.rows) ? result.rows : [];
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "검사 대상을 읽지 못했습니다.", true);
    return;
  }
  if (!rows.length) {
    setMessage(scope === "all" ? "재검사할 발주용 링크가 없습니다." : "미검사 또는 30일이 지난 발주용 링크가 없습니다.");
    return;
  }

  const worker = window.open("about:blank", WORKER_NAME, "popup=yes,width=540,height=760,left=60,top=60");
  if (!worker) {
    setMessage("브라우저 팝업이 차단됐습니다. 이 사이트의 팝업을 허용한 뒤 다시 실행하세요.", true);
    return;
  }

  auditWorker = worker;
  auditCancelled = false;
  auditResults = [];
  setAuditUi(true, 0, rows.length);
  let permanentErrors = 0;
  let temporaryErrors = 0;
  let completed = 0;

  try {
    for (const row of rows) {
      if (auditCancelled || worker.closed) break;
      const context = {
        mode: "link_audit",
        returnUrl: new URL("/china-link-audit-callback", window.location.origin).toString(),
        sourceUrl: row.primary_url,
        itemId: row.item_id,
        trackerRowNumber: row.tracker_row_number,
        modelNumber: row.model_number,
        productName: row.product_name,
        requestedAt: new Date().toISOString(),
      };
      try {
        worker.name = `${WORKER_CONTEXT_PREFIX}${encodeBase64Utf8(context)}`;
        worker.location.replace(buildAuditUrl(row, context));
      } catch {
        throw new Error("검사창을 제어하지 못했습니다. 창을 닫고 다시 시작하세요.");
      }

      setMessage(`${completed + 1}/${rows.length} · ${row.model_number || row.product_name || row.item_id} 검사 중 · 오류 ${permanentErrors}건`);
      const result = await waitForWorkerResult(worker, row);
      if (!result || auditCancelled) break;
      result.itemId = row.item_id;
      result.url = row.primary_url;
      result.source = result.source || "browser_collector";
      auditResults.push(result);
      if (result.status === "link_error") permanentErrors += 1;
      if (result.status === "temporary_error") temporaryErrors += 1;
      completed += 1;
      setAuditUi(true, completed, rows.length);
      await flushAuditResults(false);
      if (completed < rows.length) await delay(BETWEEN_LINK_DELAY_MS);
    }
    await flushAuditResults(true);
    if (!auditCancelled) {
      setMessage(`검사 완료 · ${completed}건 · 발주용 링크 오류 ${permanentErrors}건 · 일시 오류 ${temporaryErrors}건`);
    }
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "발주용 링크 검사 중 오류가 발생했습니다.", true);
  } finally {
    setAuditUi(false, completed, rows.length);
    if (!worker.closed) worker.close();
    auditWorker = null;
    await loadSummary();
  }
}

async function loadErrors(openDialog = true) {
  installDialog();
  const message = dialog?.querySelector("#china-link-health-dialog-message");
  if (message) message.textContent = "오류 목록을 불러오는 중입니다.";
  if (openDialog && dialog && !dialog.open) dialog.showModal();
  try {
    const result = await requestJson(`${HEALTH_API}?mode=list&scope=errors&limit=500`);
    errorRows = Array.isArray(result.rows) ? result.rows : [];
    renderErrors();
  } catch (error) {
    if (message) message.textContent = error instanceof Error ? error.message : "오류 목록을 읽지 못했습니다.";
  }
}

function renderErrors() {
  const body = dialog?.querySelector("#china-link-health-error-body");
  const message = dialog?.querySelector("#china-link-health-dialog-message");
  if (!body || !message) return;
  message.textContent = errorRows.length ? `발주용 링크 오류 ${errorRows.length}건 · 다음 후보 있음 ${errorRows.filter((row) => row.has_fallback).length}건` : "현재 확정된 발주용 링크 오류가 없습니다.";
  body.innerHTML = errorRows.map((row) => `
    <tr><td><input type="checkbox" data-health-error-id="${escapeHtml(row.item_id)}" /></td><td><strong>${escapeHtml(row.model_number || "—")}</strong><br>${escapeHtml(row.product_name || "")}</td><td class="china-link-health-error">${escapeHtml(row.error_message || row.error_code || "링크 오류")}</td><td class="china-link-health-url"><a href="${escapeHtml(row.primary_url)}" target="_blank" rel="noreferrer">${escapeHtml(row.primary_url)}</a></td><td class="china-link-health-url">${row.fallback_url ? `<a href="${escapeHtml(row.fallback_url)}" target="_blank" rel="noreferrer">${escapeHtml(row.fallback_url)}</a>` : "후순위 링크 없음"}</td><td>${escapeHtml(dateText(row.checked_at))}</td></tr>`).join("");
}

function selectedErrorRows(all = false) {
  if (all) return [...errorRows];
  const selected = new Set([...(dialog?.querySelectorAll("[data-health-error-id]:checked") || [])].map((input) => input.dataset.healthErrorId || "").filter(Boolean));
  return errorRows.filter((row) => selected.has(row.item_id));
}

async function shiftErrorRows(rows) {
  if (!rows.length) {
    const message = dialog?.querySelector("#china-link-health-dialog-message");
    if (message) message.textContent = "정리할 오류 상품을 선택하세요.";
    return;
  }
  const withFallback = rows.filter((row) => row.has_fallback).length;
  const withoutFallback = rows.length - withFallback;
  if (!window.confirm(`${rows.length}건의 오류 발주 링크를 정리합니다.\n다음 발주 후보 적용 ${withFallback}건 · 발주용 링크가 비는 상품 ${withoutFallback}건\n계속하시겠습니까?`)) return;

  const message = dialog?.querySelector("#china-link-health-dialog-message");
  if (message) message.textContent = `${rows.length}건의 링크 순서를 한 번의 저장으로 정리하고 있습니다.`;
  try {
    await requestJson(SHIFT_API, {
      method: "POST",
      body: JSON.stringify({
        itemIds: rows.map((row) => row.item_id),
        expectedPrimaryUrls: Object.fromEntries(rows.map((row) => [row.item_id, row.primary_url])),
        updatedBy: "승준",
        reason: "발주용 링크 오류 삭제 후 다음 발주 후보 적용",
      }),
    });
    await requestJson(HEALTH_API, {
      method: "POST",
      body: JSON.stringify({ action: "clear_items", itemIds: rows.map((row) => row.item_id) }),
    }).catch(() => null);
    window.dispatchEvent(new CustomEvent("product-launch-tracker:external-state"));
    if (message) message.textContent = `정리 완료 · ${rows.length}건 · 다음 발주 후보 적용 ${withFallback}건 · 발주용 링크 없음 ${withoutFallback}건`;
    await Promise.all([loadErrors(false), loadSummary()]);
  } catch (error) {
    if (message) message.textContent = error instanceof Error ? error.message : "발주용 링크를 정리하지 못했습니다.";
  }
}

function handlePanelClick(event) {
  const button = event.target instanceof Element ? event.target.closest("button[data-health-action]") : null;
  if (!(button instanceof HTMLButtonElement)) return;
  const action = button.dataset.healthAction;
  if (action === "audit-due") void runAudit("due");
  if (action === "audit-all") void runAudit("all");
  if (action === "show-errors") void loadErrors(true);
  if (action === "cancel") {
    auditCancelled = true;
    window.dispatchEvent(new Event(CANCEL_EVENT));
    if (auditWorker && !auditWorker.closed) auditWorker.close();
    setMessage("검사를 중단했습니다. 이미 저장된 결과는 유지됩니다.");
  }
}

function handleDialogClick(event) {
  const button = event.target instanceof Element ? event.target.closest("button[data-health-dialog]") : null;
  if (!(button instanceof HTMLButtonElement)) return;
  const action = button.dataset.healthDialog;
  if (action === "close") dialog?.close();
  if (action === "select-all") dialog?.querySelectorAll("[data-health-error-id]").forEach((input) => { if (input instanceof HTMLInputElement) input.checked = true; });
  if (action === "shift-selected") void shiftErrorRows(selectedErrorRows(false));
  if (action === "shift-all") void shiftErrorRows(selectedErrorRows(true));
}

function onCollectorReady() {
  updateCollectorBadge();
}

scheduleInstall();
document.addEventListener("commerce-os-keyword-lab-collector-ready", onCollectorReady);
try {
  if (window.parent && window.parent !== window) {
    parentCollectorDocument = window.parent.document;
    parentCollectorDocument.addEventListener(
      "commerce-os-keyword-lab-collector-ready",
      onCollectorReady,
    );
  }
} catch {
  parentCollectorDocument = null;
}
window.addEventListener("pagehide", () => {
  auditCancelled = true;
  window.dispatchEvent(new Event(CANCEL_EVENT));
  if (auditWorker && !auditWorker.closed) auditWorker.close();
  if (installTimer) window.clearTimeout(installTimer);
  document.removeEventListener("commerce-os-keyword-lab-collector-ready", onCollectorReady);
  parentCollectorDocument?.removeEventListener(
    "commerce-os-keyword-lab-collector-ready",
    onCollectorReady,
  );
  parentCollectorDocument = null;
}, { once: true });
