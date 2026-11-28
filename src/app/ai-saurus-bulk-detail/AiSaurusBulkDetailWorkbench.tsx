"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { showSaurusPopupMessage } from "@/lib/aiSaurusBulkDetailPopup";
import {
  AI_SAURUS_BATCH_API, AI_SAURUS_BATCH_PAGE,
  type AiSaurusDetailBatch, type AiSaurusProductStage,
} from "@/lib/aiSaurusBulkDetailTypes";

type BatchLink = { id: string; updatedAt: string; count: number };
type View = "all" | "ready" | "success" | "failed";
const filters = [
  ["all", "전체"], ["ready", "준비"], ["success", "성공"], ["failed", "실패"],
] as const;
const labels: Record<AiSaurusProductStage, string> = {
  draft: "수집 준비", waiting_connection: "수집 대기", waiting_1688_login: "1688 로그인 대기",
  running: "제작 중", awaiting_review: "승인 대기", failed: "실패", approved: "승인 완료",
};
const matching = {
  all: () => true,
  ready: (stage: AiSaurusProductStage) => ["draft", "waiting_connection", "waiting_1688_login"].includes(stage),
  success: (stage: AiSaurusProductStage) => ["awaiting_review", "approved"].includes(stage),
  failed: (stage: AiSaurusProductStage) => stage === "failed",
};
const textBox = "w-full rounded-lg border border-slate-300 p-2.5 text-sm focus-visible:outline-2 focus-visible:outline-blue-600 disabled:bg-slate-100";
const secondary = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50";

async function batchRequest(payload: Record<string, unknown>) {
  const signal = AbortSignal.timeout(45_000);
  try {
    const response = await fetch(AI_SAURUS_BATCH_API, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload), signal,
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.message || "AI 사우루스 작업을 처리하지 못했습니다.");
    return body as { batch: AiSaurusDetailBatch; launchUrl?: string };
  } catch (error) {
    if (signal.aborted) throw new Error("응답이 지연됐습니다. OPS 작업판을 새로고침해 작업 상태를 확인해 주세요.");
    throw error;
  }
}

function lines(value: string) {
  return [...new Set(value.split(/\r?\n/).map((option) => option.trim()).filter(Boolean))];
}

export default function AiSaurusBulkDetailWorkbench({ batchId }: { batchId: string }) {
  const [batch, setBatch] = useState<AiSaurusDetailBatch | null>(null);
  const [batches, setBatches] = useState<BatchLink[]>([]);
  const [options, setOptions] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [bulk, setBulk] = useState("");
  const [view, setView] = useState<View>("all");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [maxCredits, setMaxCredits] = useState<number | null>(null);
  const studio = useRef<Window | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const query = batchId ? `?batch=${encodeURIComponent(batchId)}` : "";
    void fetch(AI_SAURUS_BATCH_API + query, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.message || "작업을 불러오지 못했습니다.");
        if (controller.signal.aborted) return;
        const current = body.batch as AiSaurusDetailBatch | null;
        setConnected(body.connection === "connected");
        setMaxCredits(typeof body.maxCredits === "number" ? body.maxCredits : null);
        setBatches(body.batches);
        setBatch(current);
        if (current) {
          setOptions(Object.fromEntries(current.products.map((item) => [item.id, item.options.join("\n")])));
          setSelected(current.products.filter((item) => item.stage === "draft" || item.stage === "waiting_connection").map((item) => item.id));
        }
      })
      .catch((cause: Error) => { if (!controller.signal.aborted) setError(cause.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [batchId]);

  const products = batch?.products ?? [];
  const visible = products.filter((item) => matching[view](item.stage));
  const editable = visible.filter((item) => item.reviewOptions !== undefined && !batch?.queuedIds?.includes(item.id) &&
    (item.stage === "draft" || item.stage === "waiting_connection"));
  const chosen = editable.filter((item) => selected.includes(item.id));
  const selectable = view === "success" ? visible.filter((item) => item.stage === "awaiting_review")
    : view === "failed" ? visible.filter((item) => item.reviewOptions !== undefined) : editable;
  const allSelected = selectable.length > 0 && selectable.every(({ id }) => selected.includes(id));
  const running = products.find((item) => item.stage === "running");
  const nextQueued = batch?.queuedIds?.[0];
  const resultsSelected = selectable.filter(({ id }) => selected.includes(id)).map(({ id }) => id);
  const setItemOptions = (id: string, value: string) => setOptions((current) => ({ ...current, [id]: value }));

  function dispatch(action: string, current: AiSaurusDetailBatch, itemIds: string[]) {
    return batchRequest({ action, batchId, revision: current.revision, itemIds, maxCredits });
  }

  function navigateStudio(launchUrl: string | undefined) {
    if (!launchUrl || !studio.current || studio.current.closed) throw new Error("AI 사우루스 제작 창이 닫혔습니다. 다시 열어 주세요.");
    const url = new URL(launchUrl);
    if (url.origin !== "https://ai-saurus.com" || url.pathname !== "/kr/app") throw new Error("운영 제작 주소가 올바르지 않습니다.");
    studio.current.location.replace(url.toString());
  }

  function openStudio() {
    if (!studio.current || studio.current.closed) {
      studio.current = window.open("about:blank", "_blank");
      if (!studio.current) throw new Error("AI 사우루스 제작 창을 열 수 없습니다. 이 사이트의 팝업을 허용해 주세요.");
      // The fixed AI Saurus production window remains related to the workbench
      // so Chrome lets the workbench navigate it to the next queued offer.
    }
    showSaurusPopupMessage(studio.current, "AI 사우루스 준비", "AI 사우루스 1688 수집 창을 여는 중입니다.");
    return studio.current;
  }

  useEffect(() => {
    if (!connected || !batch || !running || busy) return;
    let cancelled = false;
    const check = async () => {
      try {
        const { batch: saved } = await batchRequest({ action: "refresh", batchId, revision: batch.revision, itemIds: [running.id] });
        if (cancelled) return;
        setBatch(saved);
        if (saved.products.some((product) => product.stage === "running")) return;
        const nextId = saved.queuedIds?.[0];
        if (nextId && studio.current && !studio.current.closed) {
          const next = await batchRequest({ action: "start", batchId, revision: saved.revision, itemIds: [nextId], maxCredits });
          setBatch(next.batch);
          navigateStudio(next.launchUrl);
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "제작 상태를 확인하지 못했습니다.");
          timer = window.setTimeout(() => void check(), 12000);
        }
      }
    };
    let timer = window.setTimeout(() => void check(), 6000);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [batch, batchId, busy, connected, maxCredits, running]);

  async function saveOptions() {
    if (!batch || !chosen.length || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(AI_SAURUS_BATCH_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save", batchId, revision: batch.revision,
          edits: chosen.map(({ id }) => ({ id, options: lines(options[id] ?? "") })),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || "작업 준비를 저장하지 못했습니다.");
      const saved = body.batch as AiSaurusDetailBatch;
      const savedIds = new Set(chosen.map(({ id }) => id));
      setBatch(saved);
      setOptions((current) => ({
        ...current,
        ...Object.fromEntries(saved.products.filter(({ id }) => savedIds.has(id)).map((item) => [item.id, item.options.join("\n")])),
      }));
      setMessage(`${chosen.length}개 상품의 참고 판매명을 저장했습니다.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "작업 준비를 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function connectAction(action: "start" | "continue" | "resume" | "retry" | "approve" | "clear_queue") {
    if (!batch || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    let popup: Window | null = null;
    try {
      if (action === "start") {
        const ids = chosen.map(({ id }) => id);
        if (!ids.length) return;
        popup = openStudio();
        const prepared = await batchRequest({
          action: "prepare", batchId, revision: batch.revision,
          edits: ids.map((id) => ({ id, options: lines(options[id] ?? "") })),
        });
        setBatch(prepared.batch);
        const { batch: saved, launchUrl } = await batchRequest({
          action: "start", batchId, revision: prepared.batch.revision, itemIds: [ids[0]], maxCredits, queueIds: ids,
        });
        setBatch(saved);
        navigateStudio(launchUrl);
      } else if (action === "continue" && nextQueued) {
        popup = openStudio();
        const { batch: saved, launchUrl } = await dispatch("start", batch, [nextQueued]);
        setBatch(saved);
        navigateStudio(launchUrl);
      } else if (action === "resume" && running) {
        popup = openStudio();
        const { batch: saved, launchUrl } = await dispatch("resume", batch, [running.id]);
        setBatch(saved);
        if (launchUrl) navigateStudio(launchUrl);
        else {
          const message = "제작 결과를 OPS 작업판에서 확인할 수 있습니다.";
          showSaurusPopupMessage(popup, "AI 사우루스 작업 상태", message);
          setMessage(message);
        }
      } else if (action === "retry" || action === "approve") {
        const { batch: saved } = await dispatch(action, batch, resultsSelected);
        setBatch(saved);
        setMessage(action === "approve" ? "승인한 상품의 상세페이지 이미지 URL을 저장했습니다." : "선택한 실패 품목을 다시 준비했습니다.");
      } else if (action === "clear_queue") {
        const { batch: saved } = await dispatch(action, batch, []);
        setBatch(saved);
        setMessage("대기 목록을 비웠습니다.");
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "작업을 진행하지 못했습니다.";
      showSaurusPopupMessage(popup, "AI 사우루스 수집 오류", message);
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        <strong>{connected ? "AI 사우루스 운영 제작" : "준비 모드 · AI 사우루스 연결 대기"}</strong>
        <p className="mt-1">{connected
          ? "같은 Chrome에서 1688 상품을 수집합니다. 이미지와 판매 옵션을 확인하고 제작을 시작할 때 크레딧을 사용합니다."
          : "AI 사우루스 운영 수집 기능을 확인하는 중입니다. 잠시 후 작업판을 새로고침해 주세요."}</p>
        {running && !running.dispatch?.providerJobId &&
          <button type="button" className={`mt-2 ${secondary}`} disabled={busy || !connected} onClick={() => void connectAction("resume")}>현재 상품 수집·검토 창 다시 열기</button>}
        {nextQueued && <p className="mt-2">제작 대기 {batch?.queuedIds?.length}개</p>}
        {nextQueued && !running &&
          <button type="button" className={`mt-2 ${secondary}`} disabled={busy || !connected} onClick={() => void connectAction("continue")}>
            대기 상품 제작 이어가기{maxCredits ? ` · 건당 ${maxCredits}크레딧` : ""}
          </button>}
        {nextQueued && <button type="button" className={`ml-2 mt-2 ${secondary}`} disabled={busy || !connected}
          onClick={() => void connectAction("clear_queue")}>대기 목록 비우기</button>}
        {connected && error.includes("OPS에 로그인") &&
          <Link className="mt-2 inline-block underline" href={`/login?force=1&next=${encodeURIComponent(`${AI_SAURUS_BATCH_PAGE}?batch=${batchId}`)}`}>OPS 로그인</Link>}
      </section>
      {loading && <p role="status" className="text-sm text-slate-600">작업을 불러오는 중입니다.</p>}
      {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-900">{error}</p>}
      {message && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">{message}</p>}
      {!batch && !loading && !error ? (
        <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="font-bold">최근 준비 작업</h2>
          {batches.length ? (
            <ul className="divide-y divide-slate-100">
              {batches.map((item) => (
                <li key={item.id} className="py-2">
                  <Link className="text-sm font-semibold text-blue-800 hover:underline" href={`${AI_SAURUS_BATCH_PAGE}?batch=${item.id}`}>
                    {item.count}개 상품 작업 · {new Date(item.updatedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}
                  </Link>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-slate-600">상품출시 진행관리에서 상품을 선택해 작업을 만드세요.</p>}
        </section>
      ) : null}
      {batch && (
        <>
          <nav aria-label="제작 상태" className="flex flex-wrap gap-2">
            {filters.map(([key, label]) => (
              <button key={key} type="button" aria-pressed={view === key} onClick={() => setView(key)}
                className={`rounded-lg border px-3 py-1.5 text-sm font-bold ${view === key ? "border-blue-700 bg-blue-50 text-blue-900" : "border-slate-200 bg-white text-slate-700"}`}>
                {label} {products.filter((item) => matching[key](item.stage)).length}
              </button>
            ))}
            <Link href={AI_SAURUS_BATCH_PAGE} className="self-center text-sm text-blue-800 hover:underline">최근 준비 작업</Link>
          </nav>
          {(view === "all" || view === "ready") && (
            <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-slate-600">선택 {chosen.length}개</span>
                <button type="button" className="rounded-lg bg-blue-700 px-3 py-2 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50"
                  disabled={!connected || busy || !chosen.length || Boolean(running || nextQueued)}
                  onClick={() => void connectAction("start")}>선택 상품 1688 정보 수집</button>
              </div>
              <details className="space-y-2 text-sm text-slate-600">
                <summary className="cursor-pointer">검토 화면에 표시할 판매명 편집 (선택)</summary>
                <label className="block text-sm font-semibold" htmlFor="saurus-bulk-options">선택 상품에 참고 판매명 일괄 입력</label>
                <textarea id="saurus-bulk-options" rows={2} className={textBox} value={bulk} onChange={(event) => setBulk(event.target.value)} placeholder="한 줄에 옵션 하나씩 입력" />
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className={secondary} disabled={busy || !chosen.length || !bulk.trim()} onClick={() => {
                    setOptions((current) => ({ ...current, ...Object.fromEntries(chosen.map((item) => [item.id, lines(bulk).join("\n")])) }));
                    setMessage("선택한 상품의 검토 화면에 표시할 참고 판매명을 입력했습니다.");
                  }}>선택에 적용</button>
                  <button type="button" className={secondary} disabled={busy || !chosen.length} onClick={() => void saveOptions()}>참고 판매명 저장</button>
                </div>
              </details>
            </section>
          )}
          {(view === "success" || view === "failed") && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className={secondary} disabled={!connected || busy || !resultsSelected.length}
                onClick={() => void connectAction(view === "success" ? "approve" : "retry")}>
                {view === "success" ? "선택 성공 품목 일괄 승인 · URL 저장" : "선택 실패 품목 다시 준비"}
              </button>
              {!connected && <span className="self-center text-sm text-slate-600">실제 연결을 활성화한 뒤 이용할 수 있습니다.</span>}
            </div>
          )}
          {selectable.length > 0 && (
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={allSelected} disabled={busy} onChange={(event) => {
                const ids = selectable.map((item) => item.id);
                setSelected((current) => event.target.checked ? [...new Set([...current, ...ids])] : current.filter((id) => !ids.includes(id)));
              }} /> {view === "success" ? "승인 대기 상품 전체 선택" : view === "failed" ? "실패 상품 전체 선택" : "표시된 준비 상품 전체 선택"}
            </label>
          )}
          {visible.length === 0 && <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">이 상태의 상품이 없습니다.</p>}
          <ul className="space-y-3">
            {visible.map((item) => {
              const canEdit = editable.includes(item);
              const canSelect = canEdit || (item.reviewOptions !== undefined && item.stage === "failed") || item.stage === "awaiting_review";
              const currentText = options[item.id] ?? "";
              const picked = lines(currentText);
              return (
                <li key={item.id} className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="flex items-center gap-2 font-bold">
                      <input type="checkbox" disabled={!canSelect || busy} checked={selected.includes(item.id)} onChange={(event) => {
                        setSelected((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id));
                      }} />
                      <span>{item.model ? `${item.model} · ` : ""}{item.name || item.id}</span>
                    </label>
                    <span className={`rounded-md px-2 py-1 text-xs font-bold ${item.stage === "failed" ? "bg-rose-100 text-rose-900" : matching.success(item.stage) ? "bg-emerald-100 text-emerald-900" : "bg-slate-100 text-slate-700"}`}>
                      {item.stage === "running" ? item.dispatch?.providerJobId ? `제작 중 ${item.dispatch.progress ?? 0}%` : "1688 로그인·수집 대기" : labels[item.stage]}
                    </span>
                  </div>
                  <div className="break-all text-xs text-slate-600">제작용 링크 {item.sourceUrl || "미입력"}</div>
                  {item.reviewOptions === undefined && matching.ready(item.stage) &&
                    <p className="text-xs text-slate-600">이전 준비 작업입니다. 상품출시 진행관리에서 제작 대상 상품을 다시 선택해 주세요.</p>}
                  {canEdit && <details className="space-y-2 text-sm">
                    <summary className="cursor-pointer text-slate-600">검토 화면에 표시할 판매명 편집 (선택)</summary>
                    {item.catalogOptions.length > 0 && <div className="flex flex-wrap gap-1.5" aria-label="상품 판매 옵션">
                      {item.catalogOptions.map((option) => (
                        <button key={option} type="button" disabled={busy} aria-pressed={picked.includes(option)}
                          className={`rounded-full border px-2.5 py-1 text-xs ${picked.includes(option) ? "border-blue-300 bg-blue-50 text-blue-900" : "border-slate-200 text-slate-700"}`}
                          onClick={() => setItemOptions(item.id, (picked.includes(option) ? picked.filter((value) => value !== option) : [...picked, option]).join("\n"))}>
                          {option}
                        </button>
                      ))}
                    </div>}
                    <label htmlFor={`saurus-options-${item.id}`} className="block text-sm font-medium">참고 판매 옵션명</label>
                    <textarea id={`saurus-options-${item.id}`} rows={2} className={`mt-1 ${textBox}`} value={currentText} disabled={busy} onChange={(event) => setItemOptions(item.id, event.target.value)} />
                  </details>}
                  {item.error && <p className="text-sm text-rose-800">{item.error}</p>}
                  {item.receipt && <a href={item.receipt.hostedImageUrl} target="_blank" rel="noreferrer" className="break-all text-sm text-blue-800 underline">검수용 상세페이지 이미지 열기</a>}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
