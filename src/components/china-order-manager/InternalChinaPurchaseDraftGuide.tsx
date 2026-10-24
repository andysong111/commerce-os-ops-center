"use client";

import { useCallback, useEffect, useState } from "react";

const GUIDE_STORAGE_KEY = "commerceOs.purchaseDraftGuide.v5";

const STEPS = [
  {
    title: "기존 주문초안 날짜 확인",
    description: "‘중국 주문초안 · 날짜’는 그날 계산해 저장한 발주안입니다. 그대로 이어서 작업하려면 이 버튼을 누릅니다.",
  },
  {
    title: "새 판매자료로 발주 시작",
    description: "하루 이상 지나 최신 판매를 다시 반영하려면 ‘이번 발주 시작하기’를 누릅니다. 같은 날에는 기존 초안을 다시 열고, 날짜가 지난 미주문 초안은 새 초안으로 교체합니다.",
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
    title: "5-1 원가·운임 기록",
    description: "정확한 단가·운임을 얻기 위해 1688 장바구니와 주문확인 미리보기를 사용해 값을 저장합니다. 주문 제출과 결제는 실행하지 않습니다.",
  },
  {
    title: "5-2 장바구니 담기",
    description: "5-1 재계산이 예산 안이면 확정한 수량과 중국옵션으로 장바구니를 다시 맞추고 검증합니다. 주문 제출과 실결제는 사용자가 직접 합니다.",
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
                <p className="mt-2 text-sm leading-6 text-slate-600">기존 초안을 이어서 작업할지, 오늘 판매자료로 다시 계산할지 날짜를 보고 선택합니다. 새 계산은 직전 발주계산 시작일부터 어제까지의 판매를 이어서 반영합니다.</p>
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
              판매 구간의 기준은 입고확정일이 아니라 직전 발주계산 시작일입니다. 배송 중 판매도 빠뜨리지 않기 위해서입니다. 발주차시 시작과 초안 수정만으로는 예산 지출이나 재고 증가가 생기지 않으며, 실제 주문과 입고확정 때 각각 원장에 반영됩니다.
            </div>
            <button type="button" onClick={closeGuide} className="mt-5 w-full rounded-xl bg-blue-700 px-5 py-3 text-sm font-black text-white hover:bg-blue-800">확인하고 시작</button>
          </section>
        </div>
      ) : null}
    </>
  );
}
