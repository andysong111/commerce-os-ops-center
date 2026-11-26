"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
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
  draft: "옵션 준비", waiting_connection: "연결 대기", waiting_1688_login: "1688 로그인 대기",
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

  useEffect(() => {
    const controller = new AbortController();
    const query = batchId ? `?batch=${encodeURIComponent(batchId)}` : "";
    void fetch(AI_SAURUS_BATCH_API + query, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.message || "작업을 불러오지 못했습니다.");
        if (controller.signal.aborted) return;
        const current = body.batch as AiSaurusDetailBatch | null;
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
  const editable = visible.filter((item) => item.stage === "draft" || item.stage === "waiting_connection");
  const chosen = editable.filter((item) => selected.includes(item.id));
  const selectable = view === "success" ? visible.filter((item) => item.stage === "awaiting_review")
    : view === "failed" ? visible : editable;
  const allSelected = selectable.length > 0 && selectable.every(({ id }) => selected.includes(id));
  const setItemOptions = (id: string, value: string) => setOptions((current) => ({ ...current, [id]: value }));

  async function save(action: "save" | "prepare") {
    if (!batch || !chosen.length || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(AI_SAURUS_BATCH_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action, batchId, revision: batch.revision,
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
      setMessage(action === "prepare" ? `${chosen.length}개 상품을 연결 대기 상태로 저장했습니다.` : `${chosen.length}개 상품의 옵션을 저장했습니다.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "작업 준비를 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        <strong>준비 모드 · AI 사우루스 연결 대기</strong>
        <p className="mt-1">실제 제작을 켜면 같은 Chrome의 1688 로그인과 AI 사우루스 운영 릴리스·Importer를 확인한 뒤 진행합니다.</p>
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
              <label className="block text-sm font-semibold" htmlFor="saurus-bulk-options">선택 상품에 옵션명 일괄 입력</label>
              <textarea id="saurus-bulk-options" rows={2} className={textBox} value={bulk} onChange={(event) => setBulk(event.target.value)} placeholder="한 줄에 옵션 하나씩 입력" />
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-slate-600">선택 {chosen.length}개</span>
                <button type="button" className={secondary} disabled={busy || !chosen.length || !bulk.trim()} onClick={() => {
                  setOptions((current) => ({ ...current, ...Object.fromEntries(chosen.map((item) => [item.id, lines(bulk).join("\n")])) }));
                  setMessage("선택한 상품에 옵션명을 입력했습니다. 저장하면 준비 작업에 반영됩니다.");
                }}>선택에 적용</button>
                <button type="button" className={secondary} disabled={busy || !chosen.length} onClick={() => void save("save")}>옵션 저장</button>
                <button type="button" disabled={busy || !chosen.length} onClick={() => void save("prepare")}
                  className="rounded-lg bg-blue-700 px-3 py-2 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50">
                  선택 상품 제작 준비
                </button>
                <button type="button" className={secondary} disabled>선택 상품 제작 시작</button>
              </div>
            </section>
          )}
          {(view === "success" || view === "failed") && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className={secondary} disabled>
                {view === "success" ? "선택 성공 품목 일괄 승인 · URL 저장" : "선택 실패 품목 다시 준비"}
              </button>
              <span className="self-center text-sm text-slate-600">실제 연결을 활성화한 뒤 이용할 수 있습니다.</span>
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
              const canEdit = item.stage === "draft" || item.stage === "waiting_connection";
              const canSelect = canEdit || item.stage === "failed" || item.stage === "awaiting_review";
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
                      {labels[item.stage]}
                    </span>
                  </div>
                  <div className="break-all text-xs text-slate-600">제작용 링크 {item.sourceUrl || "미입력"}</div>
                  {item.catalogOptions.length > 0 && canEdit && (
                    <div className="flex flex-wrap gap-1.5" aria-label="상품 판매 옵션">
                      {item.catalogOptions.map((option) => (
                        <button key={option} type="button" disabled={busy} aria-pressed={picked.includes(option)}
                          className={`rounded-full border px-2.5 py-1 text-xs ${picked.includes(option) ? "border-blue-300 bg-blue-50 text-blue-900" : "border-slate-200 text-slate-700"}`}
                          onClick={() => setItemOptions(item.id, (picked.includes(option) ? picked.filter((value) => value !== option) : [...picked, option]).join("\n"))}>
                          {option}
                        </button>
                      ))}
                    </div>
                  )}
                  <div>
                    <label htmlFor={`saurus-options-${item.id}`} className="block text-sm font-medium">제작 옵션명</label>
                    <textarea id={`saurus-options-${item.id}`} rows={2} className={`mt-1 ${textBox}`} value={currentText} disabled={!canEdit || busy} onChange={(event) => setItemOptions(item.id, event.target.value)} />
                  </div>
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
