"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { AI_SAURUS_ORIGIN } from "@/lib/aiSaurusBulkDetailTypes";
import { OPS_OPTION_REVIEW_CHANNEL, readStudioReviewSignal } from "@/lib/aiSaurusBulkDetailInline";

export default function AiSaurusInlineReview({ attempt, product, studio, openCollector }: {
  attempt: string;
  product: string;
  studio: RefObject<Window | null>;
  openCollector: () => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [attached, setAttached] = useState(false);
  const bind = useCallback(() => {
    if (!frame.current?.contentWindow || !studio.current || studio.current.closed) return;
    for (let index = 0; index < window.frames.length; index++) {
      if (window.frames[index] !== frame.current.contentWindow) continue;
      studio.current.postMessage({ channel: OPS_OPTION_REVIEW_CHANNEL, type: "bind", attempt, frameIndex: index }, AI_SAURUS_ORIGIN);
      return;
    }
  }, [attempt, studio]);
  useEffect(() => {
    function receive(event: MessageEvent) {
      const signal = readStudioReviewSignal(event, attempt, window, studio.current);
      if (!signal) return;
      // Reconnect an existing collection window after the operator refreshes OPS.
      studio.current = signal.sender;
      if (!signal.attached) bind();
      else setAttached(true);
    }
    window.addEventListener("message", receive);
    const timer = window.setInterval(() => {
      if (studio.current?.closed) setAttached(false);
    }, 2000);
    return () => { window.removeEventListener("message", receive); window.clearInterval(timer); };
  }, [attempt, studio, bind]);
  return (
    <section aria-label="현재 상품 판매 옵션 검토" className="rounded-xl border border-blue-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-bold text-slate-950">{product} · 판매 옵션 검토</h2>
          {!attached && <p role="status" className="mt-1 text-sm text-slate-600">1688 수집이 끝나면 여기에 옵션과 제작 시작 버튼이 표시됩니다.</p>}
        </div>
        <button type="button" className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold" onClick={openCollector}>1688 로그인·수집 창 확인</button>
      </div>
      <iframe ref={frame} title={product + " 판매 옵션 편집"} referrerPolicy="no-referrer"
        src={AI_SAURUS_ORIGIN + "/ops-review-panel#" + attempt} onLoad={() => { setAttached(false); bind(); }}
        className={attached ? "mt-3 h-[min(72dvh,850px)] min-h-80 w-full rounded-lg border border-slate-200" : "hidden"} />
    </section>
  );
}
