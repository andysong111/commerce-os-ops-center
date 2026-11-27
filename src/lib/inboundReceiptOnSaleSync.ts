"use client";
import type { ReceiptOnSaleRow } from "./receiptOnSaleCore";
import { waitForShoplingStockIdle } from "./shoplingStockReadyBarrier";
import { requireShoplingAuthenticatedSession } from "./shoplingStockSessionPreflight";
import { supportsStockParentFinalization } from "./shoplingStockLaunchPlan";

const endpoint = "/api/china-order-manager/receipt-on-sale";
const bridge = "COMMERCE_OS_SHOPLING_STOCK_SYNC_";
type Job = { jobId: string; barcode: string; desiredStatus: "ON_SALE"; stockBatchPlan: string };
type Reply = { ok: boolean; rows: ReceiptOnSaleRow[]; outcome?: string; job?: Job; message?: string };
async function request(url: string, init: RequestInit = {}): Promise<Reply> {
  const response = await fetch(url, { ...init, cache: "no-store", credentials: "same-origin" });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.message || "입고 전송 기록을 확인하지 못했습니다.");
  return data;
}
function post(draftId: string, action: string, fields = {}) {
  return request(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...fields, draftId, action }) });
}
export async function readInboundOnSale(draftId: string) {
  return (await request(endpoint + "?draftId=" + encodeURIComponent(draftId))).rows;
}
function resultFrom(event: MessageEvent) {
  const d = event.data;
  if (event.source !== window || event.origin !== location.origin || d?.type !== bridge + "RESULT" ||
    d.__commerceOsStockSyncBridgeHF27 !== true || !supportsStockParentFinalization(d.extensionVersion) ||
    !["SUCCEEDED", "FAILED", "UNCERTAIN"].includes(d.outcome) || d.job?.jobId !== d.jobId ||
    d.job?.desiredStatus !== "ON_SALE" || !d.job?.stockBatchPlan || typeof d.jobId !== "string" || !d.jobId.startsWith("receipt-onsale:")) return null;
  return { jobId: d.jobId, barcode: String(d.job.barcode), outcome: String(d.outcome), evidence: d.evidence, message: String(d.message || ""), finishedAt: Number(d.finishedAt) };
}

export function watchReceiptOnSaleRecovery(draftId: string, rows: ReceiptOnSaleRow[], changed: () => void, failed: (message: string) => void) {
  const ids = new Set(rows.filter(r => r.state === "STARTED" || (r.state === "HELD" && !r.canStart)).map(r => r.jobId));
  const saving = new Set<string>();
  const listen = (event: MessageEvent) => {
    const r = resultFrom(event);
    if (!r || !ids.has(r.jobId) || saving.has(r.jobId) || r.outcome !== "SUCCEEDED") return;
    saving.add(r.jobId);
    void post(draftId, "finish", r).then(saved => { if (saved.outcome === "SUCCEEDED") changed(); }).catch(error => { saving.delete(r.jobId); failed(error.message); });
  };
  if (ids.size) {
    window.addEventListener("message", listen);
    window.postMessage({ type: bridge + "EXTENSION_PING" }, location.origin);
  }
  return () => window.removeEventListener("message", listen);
}

async function dispatch(job: Job, draftId: string) {
  const started = Date.now();
  const result = await new Promise<NonNullable<ReturnType<typeof resultFrom>>>((resolve) => {
    const done = (value: NonNullable<ReturnType<typeof resultFrom>>) => {
      clearTimeout(timer); window.removeEventListener("message", listen); resolve(value);
    };
    const listen = (event: MessageEvent) => {
      const r = resultFrom(event);
      if (r && r.jobId === job.jobId && r.barcode === job.barcode && r.finishedAt >= started) done(r);
    };
    const timer = window.setTimeout(() => done({ jobId: job.jobId, barcode: job.barcode, outcome: "UNCERTAIN", finishedAt: Date.now(),
      message: "접수 응답 대기시간 경과 · 원래 전송 결과 확인 필요", evidence: {} }), 31 * 60 * 1000);
    window.addEventListener("message", listen);
    window.postMessage({ type: bridge + "START", job }, location.origin);
  });
  return post(draftId, "finish", result);
}

async function requireReceiptBridge() {
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); window.removeEventListener("message", listen); };
    const listen = (event: MessageEvent) => {
      const d = event.data;
      if (event.source !== window || event.origin !== location.origin || d?.type !== bridge + "EXTENSION_READY" || d.__commerceOsStockSyncBridgeHF27 !== true) return;
      cleanup();
      if (supportsStockParentFinalization(d.extensionVersion)) resolve();
      else reject(new Error("Shopling 재고상태 확장 v0.6.62 이상이 필요합니다."));
    };
    const timer = window.setTimeout(() => { cleanup(); reject(new Error("Shopling 재고상태 확장 연결을 확인하세요.")); }, 3500);
    window.addEventListener("message", listen);
    window.postMessage({ type: bridge + "EXTENSION_PING" }, location.origin);
  });
}

export async function holdDetachedReceipt(draftId: string, row: ReceiptOnSaleRow) {
  if (!row.canHold) throw new Error("진행 중인 전송의 결과를 기다려 주세요.");
  await requireReceiptBridge();
  await waitForShoplingStockIdle();
  await post(draftId, "hold", { jobId: row.jobId, barcode: row.barcode });
}

export async function runInboundReceiptOnSaleSync(draftId: string, progress?: (message: string) => void, selectedCodes?: string[], signal?: AbortSignal) {
  const rows = (await post(draftId, "refresh")).rows;
  const selected = selectedCodes && new Set(selectedCodes);
  const todo = rows.filter(r => r.canStart && (!selected || selected.has(r.barcode)));
  if (todo.length) {
    progress?.("Shopling 확장 연결과 로그인 상태를 확인하고 있습니다.");
    await requireReceiptBridge();
    await waitForShoplingStockIdle();
    await requireShoplingAuthenticatedSession();
  }
  for (const [index, item] of todo.entries()) {
    await waitForShoplingStockIdle();
    if (signal?.aborted) break;
    progress?.(`판매중 전송 ${index + 1}/${todo.length} · ${item.barcode}`);
    const claim = await post(draftId, "claim", { jobId: item.jobId });
    if (!claim.job) continue; // Preflight hold recorded before any external write.
    if (claim.job.jobId !== item.jobId || claim.job.barcode !== item.barcode || !claim.job.stockBatchPlan || claim.job.desiredStatus !== "ON_SALE") throw new Error("전송 계획과 입고 B코드가 일치하지 않습니다.");
    const finished = await dispatch(claim.job, draftId);
    if (finished.outcome !== "SUCCEEDED") break;
  }
  const status = await readInboundOnSale(draftId);
  return { rows: status, message: `이번 차시 판매중 전송 · 접수 ${status.filter(r => r.state === "ACCEPTED").length}건 · 보류 ${status.filter(r => r.state === "HELD").length}건 · 진행 중 ${status.filter(r => r.state === "STARTED").length}건 · 대기 ${status.filter(r => r.state === "PENDING").length}건` };
}