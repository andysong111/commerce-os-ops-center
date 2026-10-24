"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";

type StartPayload = {
  ok?: boolean;
  pending?: boolean;
  state?: "PENDING" | "READY" | "BLOCKED";
  progress?: number;
  message?: string;
  draftUrl?: string | null;
  builderUrl?: string | null;
};

const wait = (milliseconds: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });

export function PurchaseRunStartButton() {
  const router = useRouter();
  const controllerRef = useRef<AbortController | null>(null);
  const [open, setOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [cash, setCash] = useState("");
  const [sourcingPercent, setSourcingPercent] = useState("15");
  const [notice, setNotice] = useState("예산 기준을 입력한 뒤 시작하세요.");
  const [progress, setProgress] = useState(0);

  function close() {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setStarting(false);
    setOpen(false);
  }

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedCash = cash.trim();
    const cashLimitKrw = trimmedCash === "" ? null : Number(trimmedCash.replaceAll(",", ""));
    const sourcingBudgetPercent = Number(sourcingPercent);
    if (cashLimitKrw !== null && (!Number.isSafeInteger(cashLimitKrw) || cashLimitKrw < 0)) {
      setNotice("사용할 현금은 0원 이상의 정수로 입력하세요. 비우면 누적 가용예산을 사용합니다.");
      return;
    }
    if (!Number.isSafeInteger(sourcingBudgetPercent) || sourcingBudgetPercent < 0 || sourcingBudgetPercent > 100) {
      setNotice("신규상품 소싱 비율은 0~100 사이의 정수로 입력하세요.");
      return;
    }

    const controller = new AbortController();
    controllerRef.current?.abort();
    controllerRef.current = controller;
    setStarting(true);
    setProgress(2);
    setNotice("발주차시를 준비하고 있습니다.");

    try {
      for (let attempt = 0; attempt < 120; attempt += 1) {
        const response = await fetch("/api/china-order-manager/purchase-runs/start", {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json" },
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
          body: JSON.stringify({ cashLimitKrw, sourcingBudgetPercent }),
        });
        const payload = (await response.json().catch(() => ({}))) as StartPayload;
        setNotice(payload.message || "발주자료를 준비하고 있습니다.");
        setProgress(Math.max(0, Math.min(100, Number(payload.progress) || 0)));

        if (payload.state === "READY") {
          const destination = payload.draftUrl || payload.builderUrl;
          if (!destination) throw new Error("완료된 발주초안 주소를 받지 못했습니다.");
          router.push(destination);
          return;
        }
        if (!response.ok || payload.state === "BLOCKED") {
          setStarting(false);
          return;
        }
        await wait(900, controller.signal);
      }
      setNotice("준비 시간이 길어지고 있습니다. 같은 시작 버튼을 누르면 완료한 단계부터 이어집니다.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setNotice(error instanceof Error ? error.message : "자료 준비 요청이 일시적으로 중단되었습니다. 다시 누르면 이어서 진행합니다.");
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      setStarting(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open} className="rounded-xl bg-blue-700 px-5 py-3 text-sm font-black text-white hover:bg-blue-800">
        이번 발주차시 시작
      </button>

      {open ? (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/55 p-4" role="presentation">
          <section role="dialog" aria-modal="true" aria-labelledby="purchase-run-start-title" className="w-full max-w-xl rounded-2xl border border-blue-200 bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-black tracking-[0.12em] text-blue-700">새 발주차시</p>
                <h2 id="purchase-run-start-title" className="mt-1 text-2xl font-black text-slate-950">예산 기준을 정하고 시작합니다</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">시작하면 최신 판매·클레임·재고·미입고 자료를 자동으로 준비하고 발주초안 화면을 엽니다.</p>
              </div>
              <button type="button" onClick={close} aria-label="발주차시 시작 창 닫기" className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-black text-slate-600 hover:bg-slate-50">닫기</button>
            </div>

            <form onSubmit={start} className="mt-5 grid gap-4">
              <label className="text-sm font-black text-slate-800">
                이번 발주에 사용할 총현금
                <input type="text" inputMode="numeric" value={cash} onChange={(event) => setCash(event.target.value)} disabled={starting} placeholder="비우면 누적 가용예산 자동 사용" className="mt-2 block min-h-12 w-full rounded-xl border border-slate-300 px-4 py-3 font-bold text-slate-950 disabled:bg-slate-100" />
              </label>
              <label className="text-sm font-black text-slate-800">
                신규상품 소싱예산 비율
                <div className="mt-2 flex items-center gap-2">
                  <input type="number" inputMode="numeric" min={0} max={100} step={1} value={sourcingPercent} onChange={(event) => setSourcingPercent(event.target.value)} disabled={starting} className="min-h-12 min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-3 font-bold text-slate-950 disabled:bg-slate-100" />
                  <span className="font-black text-slate-700">%</span>
                </div>
              </label>

              {starting ? (
                <div className="rounded-xl border border-blue-200 bg-blue-50 p-4" aria-live="polite">
                  <div className="h-2 overflow-hidden rounded-full bg-blue-100"><div className="h-full rounded-full bg-blue-700 transition-[width]" style={{ width: `${progress}%` }} /></div>
                  <p className="mt-3 text-sm font-bold leading-6 text-blue-950">{notice}</p>
                  <p className="mt-1 text-xs text-blue-700">완료한 단계는 저장되므로 중간에 끊겨도 다시 시작하면 이어집니다.</p>
                </div>
              ) : (
                <p role="status" className="rounded-xl bg-slate-50 px-4 py-3 text-sm font-bold leading-6 text-slate-700">{notice}</p>
              )}

              <button type="submit" disabled={starting} className="min-h-12 rounded-xl bg-blue-700 px-5 py-3 text-sm font-black text-white hover:bg-blue-800 disabled:cursor-wait disabled:bg-slate-400">
                {starting ? "최신자료 준비 중..." : "이 기준으로 발주차시 시작"}
              </button>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}

