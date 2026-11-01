"use client";

import { useCallback, useEffect, useState } from "react";

const PATH = "/api/inventory-stock-control/retransmission";

type Item = {
  jobId: string;
  barcode: string;
  productName: string;
  modelNo: string | null;
  desiredStatus: "SOLD_OUT" | "ON_SALE";
  mode: "REPLAY" | "EXISTING_PENDING";
  state?: "PENDING" | "STARTED" | "SUCCEEDED" | "FAILED" | "UNCERTAIN" | "BLOCKED";
};
type Batch = {
  requestId: string;
  occurredAt: string;
  items: Item[];
  succeededCount: number;
  pendingCount: number;
  startedCount: number;
  exceptionCount: number;
};
type Payload = {
  ok?: boolean;
  preview?: { items: Item[] };
  latest?: Batch | null;
  request?: Batch;
  message?: string;
};

function statusLabel(value: Item["desiredStatus"]) {
  return value === "SOLD_OUT" ? "품절" : "판매중";
}

function stateLabel(item: Item) {
  if (item.state === "SUCCEEDED") return "이번 전송 완료";
  if (item.state === "STARTED") return "샵플링 전송 중";
  if (item.state === "FAILED") return "실패 · 재확인 필요";
  if (item.state === "UNCERTAIN") return "결과 불확실 · 재확인 필요";
  if (item.state === "BLOCKED") return "현재 상태 변경됨 · 실행 차단";
  return item.mode === "EXISTING_PENDING" ? "기존 대기건 사용" : "재전송 대기";
}

export function InventoryStockRetransmissionPanel() {
  const [preview, setPreview] = useState<Item[]>([]);
  const [latest, setLatest] = useState<Batch | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const response = await fetch(PATH, {
      method: "GET",
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    const payload = (await response.json().catch(() => ({}))) as Payload;
    if (!response.ok || !payload.ok) {
      throw new Error(payload.message || "재전송 대상을 확인하지 못했습니다.");
    }
    setPreview(payload.preview?.items ?? []);
    setLatest(payload.latest ?? null);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load()
        .catch((error) => setNotice(error instanceof Error ? error.message : "재전송 목록 조회 실패"))
        .finally(() => setLoading(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const create = async () => {
    setCreating(true);
    setNotice("");
    try {
      const response = await fetch(PATH, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          reason: "운영자 요청: 화면의 확정 품절·판매중 B코드를 Shopling에 빠짐없이 재전송",
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as Payload;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || "재전송 목록을 만들지 못했습니다.");
      }
      setLatest(payload.request ?? null);
      setNotice(payload.message || "재전송 목록을 만들었습니다.");
      window.dispatchEvent(new Event("commerce-os:inventory-refresh"));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "재전송 목록 생성 실패");
    } finally {
      setCreating(false);
    }
  };

  const rows = latest?.items ?? preview;
  return (
    <section className="rounded-2xl border border-violet-200 bg-violet-50 p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="text-xs font-black tracking-[0.12em] text-violet-800">SHOPLING-ONLY · 감사 가능한 재전송</span>
          <h2 className="mt-1 text-xl font-black text-slate-950">현재 확정 B코드 재전송 목록</h2>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
            판단 보류 상품은 제외하고 현재 품절·판매중이 확정된 B코드만 목록화합니다. 이 버튼은 재고 기준·판매 이력을 바꾸지 않으며, 실제 전송은 아래 운영 큐에서 로그인 점검 후 시작합니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void create()}
          disabled={loading || creating || !preview.length || Boolean(latest && latest.succeededCount < latest.items.length)}
          className="rounded-xl bg-violet-700 px-4 py-2.5 text-sm font-black text-white hover:bg-violet-800 disabled:bg-slate-400"
        >
          {creating ? "목록 저장·검증 중..." : latest && latest.succeededCount < latest.items.length ? "재전송 목록 생성됨" : `${preview.length}건 재전송 목록 만들기`}
        </button>
      </div>
      {notice ? <div role="status" className="mt-4 rounded-xl border border-violet-200 bg-white px-4 py-3 text-sm font-bold text-slate-800">{notice}</div> : null}
      {latest ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <Metric label="목록 전체" value={latest.items.length} />
          <Metric label="이번 전송 완료" value={latest.succeededCount} />
          <Metric label="대기/진행" value={latest.pendingCount + latest.startedCount} />
          <Metric label="확인 필요" value={latest.exceptionCount} />
        </div>
      ) : null}
      <div className="mt-4 max-h-[440px] overflow-auto rounded-xl border border-violet-200 bg-white">
        <table className="min-w-[920px] w-full text-left text-xs">
          <thead className="sticky top-0 bg-violet-100 text-slate-600"><tr><th className="px-3 py-3">B코드 / 상품</th><th className="px-3 py-3">모델명</th><th className="px-3 py-3">전환 지시</th><th className="px-3 py-3">전송 방식</th><th className="px-3 py-3">이번 목록 상태</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((item) => <tr key={item.jobId}>
              <td className="px-3 py-3"><strong className="font-mono text-slate-950">{item.barcode}</strong><span className="ml-2 text-slate-500">{item.productName}</span></td>
              <td className="px-3 py-3 font-bold text-slate-700">{item.modelNo || "—"}</td>
              <td className={`px-3 py-3 font-black ${item.desiredStatus === "SOLD_OUT" ? "text-rose-700" : "text-emerald-700"}`}>{statusLabel(item.desiredStatus)}</td>
              <td className="px-3 py-3 text-slate-600">{item.mode === "EXISTING_PENDING" ? "기존 미완료 지시 이어서 처리" : "재고 이력 변경 없는 Shopling 전용 재전송"}</td>
              <td className="px-3 py-3 font-bold text-slate-700">{stateLabel(item)}</td>
            </tr>)}
            {!rows.length ? <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">{loading ? "확정 대상을 확인하고 있습니다." : "재전송 가능한 확정 대상이 없습니다."}</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="rounded-xl border border-violet-200 bg-white p-4"><div className="text-xs font-bold text-slate-500">{label}</div><div className="mt-1 text-2xl font-black text-slate-950">{value}</div></div>;
}
