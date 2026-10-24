"use client";

import { useCallback, useEffect, useState } from "react";

const GUIDE_STORAGE_KEY = "commerceOs.purchaseDraftGuide.v3";

const STEPS = [
  {
    title: "현재 주문초안 먼저 확인",
    description: "기존 주문초안이 있으면 날짜가 바뀌어도 그대로 이어서 사용합니다. 화면의 ‘현재 발주 계속하기’를 누르면 새 초안을 만들지 않고 기존 초안으로 이동합니다.",
  },
  {
    title: "진행 중인 초안이 없을 때만 발주 시작",
    description: "처음 발주하거나 이전 발주가 실제 주문·입고까지 끝났을 때만 ‘이번 발주 시작하기’를 누릅니다. 실제 주문하지 않은 옛 초안은 운영 화면에 표시하지 않습니다.",
  },
  {
    title: "대략 재고 선택",
    description: "각 상품에서 많음·보통·적음·품절 중 현재 상황에 가장 가까운 값을 누릅니다.",
  },
  {
    title: "수량 확인과 5·10단위 정리",
    description: "필요한 수량만 직접 고치고, 여러 상품은 체크한 뒤 5·10단위 맞춤을 사용합니다.",
  },
  {
    title: "빠진 B코드 수동 추가",
    description: "검색해 입력한 수량은 사용자 고정수량이 됩니다. 재계산 때 이 수량의 예산을 먼저 확보합니다.",
  },
  {
    title: "발주안 한 번 재계산",
    description: "고정수량을 먼저 반영하고, 남은 예산을 자동 추천상품에 우선순위대로 배분합니다.",
  },
  {
    title: "5번 업무 실행",
    description: "1688 장바구니에서 실제 위안단가와 중국내 운임을 읽어 합계와 예산을 다시 검증합니다. 한도 초과 상태에서는 주문완료 기록이 잠깁니다.",
  },
] as const;

export function InternalChinaPurchaseDraftGuide() {
  const [open, setOpen] = useState(false);

  const closeGuide = useCallback(() => {
    try {
      window.localStorage.setItem(GUIDE_STORAGE_KEY, "seen");
    } catch {
      // The guide can still close when browser storage is unavailable.
    }
    setOpen(false);
  }, []);

  useEffect(() => {
    let shouldOpen = false;
    try {
      shouldOpen = window.localStorage.getItem(GUIDE_STORAGE_KEY) !== "seen";
    } catch {
      shouldOpen = true;
    }
    if (!shouldOpen) return;
    const timer = window.setTimeout(() => setOpen(true), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeGuide();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [closeGuide, open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="fixed right-4 top-24 z-[80] rounded-xl border border-blue-300 bg-blue-50 px-4 py-2.5 text-sm font-black text-blue-800 shadow-lg hover:bg-blue-100 sm:right-6"
      >
        작업 순서 보기
      </button>

      {open ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-4" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) closeGuide(); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="purchase-draft-guide-title" className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-blue-200 bg-white p-5 shadow-2xl sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="text-xs font-black tracking-[0.12em] text-blue-700">발주차시·발주초안 작업 가이드</span>
                <h2 id="purchase-draft-guide-title" className="mt-1 text-2xl font-black text-slate-950">기존 초안 확인부터 순서대로 진행하세요</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">날짜가 바뀌었다고 새 발주차시를 만들 필요는 없습니다. 기존 주문초안이 있으면 계속 사용하고, 없을 때만 새로 시작합니다.</p>
              </div>
              <button type="button" onClick={closeGuide} aria-label="작업 가이드 닫기" className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-black text-slate-600 hover:bg-slate-50">닫기</button>
            </div>

            <ol className="mt-5 space-y-3">
              {STEPS.map((step, index) => (
                <li key={step.title} className="flex gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-blue-700 text-sm font-black text-white">{index + 1}</span>
                  <div>
                    <strong className="text-sm font-black text-slate-950">{step.title}</strong>
                    <p className="mt-1 text-sm leading-6 text-slate-600">{step.description}</p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="mt-5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-bold leading-6 text-amber-950">
              발주차시 시작과 초안 수정만으로는 예산 지출이나 재고 증가가 생기지 않습니다. 1688 실제 주문을 기록하면 예산이 차감되고, 입고확정하면 재고원장에 반영됩니다. 수동 추가·직접 수정 수량은 자동으로 줄이지 않습니다.
            </div>
            <button type="button" onClick={closeGuide} className="mt-5 w-full rounded-xl bg-blue-700 px-5 py-3 text-sm font-black text-white hover:bg-blue-800">확인하고 시작</button>
          </section>
        </div>
      ) : null}
    </>
  );
}
