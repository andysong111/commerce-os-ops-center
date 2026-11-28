"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { AiSaurusBatchProduct, AiSaurusHostedReceipt } from "@/lib/aiSaurusBulkDetailTypes";
import {
  AI_SAURUS_REVIEW_ROLES, readSaurusReviewAssets, saurusResultImageUrl,
  type AiSaurusReviewRole,
} from "@/lib/aiSaurusReviewAssets";

const imageLabels: Record<AiSaurusReviewRole, string> = {
  representative_main_catalog: "대표 이미지",
  representative_alternate_whole: "부가 1",
  representative_evidence_detail: "부가 2",
  representative_lifestyle_usage: "부가 3",
  representative_adaptive_support: "부가 4",
};

const control = "inline-flex min-h-9 items-center justify-center whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-800 hover:border-blue-300 hover:text-blue-800 focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-40";

function ReviewImage({ url, alt, className }: { url: string; alt: string; className: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <div role="status" className="grid min-h-16 place-items-center p-3 text-center text-xs text-slate-500">이미지를 불러오지 못했습니다.</div>;
  }
  // The hosted JPG keeps its native ratio, including the full length of the detail page.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={alt} className={className} decoding="async" onError={() => setFailed(true)} />;
}

function ReviewContent({ receipt }: { receipt: AiSaurusHostedReceipt }) {
  const files = readSaurusReviewAssets(receipt.reviewAssets, receipt.transferReceiptId);
  const [selectedRole, setSelectedRole] = useState<AiSaurusReviewRole | undefined>();
  const detail = useRef<HTMLDivElement>(null);
  const chosen = selectedRole ?? AI_SAURUS_REVIEW_ROLES.find((role) => files?.[role]);
  const selectedId = chosen ? files?.[chosen] : undefined;
  const selectedUrl = selectedId ? saurusResultImageUrl(selectedId) : "";

  function jumpToEdge(end: boolean) {
    const viewer = detail.current;
    if (!viewer) return;
    if (window.matchMedia("(min-width: 1024px)").matches) {
      viewer.scrollTo({ top: end ? viewer.scrollHeight : 0 });
    } else {
      viewer.scrollIntoView({ block: end ? "end" : "start" });
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain lg:grid lg:grid-cols-[minmax(310px,2fr)_minmax(0,3fr)] lg:overflow-hidden">
      <section aria-label="대표·부가 이미지" className="min-w-0 space-y-3 p-4 lg:overflow-y-auto lg:p-5">
        <div className="flex min-h-9 items-center justify-between gap-2">
          <h3 className="font-bold text-slate-900">대표·부가 이미지</h3>
          {selectedUrl && <a href={selectedUrl} target="_blank" rel="noreferrer" className={control}>선택 이미지 원본</a>}
        </div>
        {files ? (
          <>
            <div className="grid grid-cols-5 gap-1.5" aria-label="이미지 선택">
              {AI_SAURUS_REVIEW_ROLES.map((role) => {
                const id = files[role];
                const label = imageLabels[role];
                return (
                  <button key={role} type="button" aria-label={label} aria-pressed={role === chosen}
                    title={id ? label : label + " 미연결"} disabled={!id} onClick={() => setSelectedRole(role)}
                    className={`min-w-0 rounded-lg border p-1.5 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-50 ${role === chosen
                      ? "border-blue-500 bg-blue-50 text-blue-900 ring-1 ring-blue-500"
                      : "border-slate-200 bg-white text-slate-700 hover:border-blue-300"}`}>
                    <span className="flex aspect-square items-center justify-center overflow-hidden rounded-md bg-slate-100">
                      {id ? <ReviewImage key={id} url={saurusResultImageUrl(id)} alt="" className="block max-h-full max-w-full object-contain" /> : "—"}
                    </span>
                    <span className="mt-1 block">{role === "representative_main_catalog" ? "대표" : label}</span>
                  </button>
                );
              })}
            </div>
            {chosen && selectedUrl && (
              <figure className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                <div className="flex h-[min(36dvh,420px)] items-center justify-center overflow-hidden p-2 lg:h-[min(51dvh,500px)]">
                  <ReviewImage key={selectedUrl} url={selectedUrl} alt={imageLabels[chosen]} className="block max-h-full max-w-full object-contain" />
                </div>
                <figcaption className="border-t border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700">{imageLabels[chosen]}</figcaption>
              </figure>
            )}
          </>
        ) : (
          <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">연결된 대표·부가 이미지가 없습니다.</p>
        )}
      </section>
      <section aria-label="상세페이지" className="min-h-0 min-w-0 bg-slate-100 lg:flex lg:flex-col lg:border-l lg:border-slate-200">
        <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-y border-slate-200 bg-white px-4 py-2.5 lg:static lg:border-t-0">
          <h3 className="font-bold text-slate-900">상세페이지</h3>
          <div className="flex gap-1.5">
            <button type="button" className={control} onClick={() => jumpToEdge(false)}>맨 위</button>
            <button type="button" className={control} onClick={() => jumpToEdge(true)}>맨 아래</button>
            <a href={receipt.hostedImageUrl} target="_blank" rel="noreferrer" className={control}>원본 열기</a>
          </div>
        </div>
        <div ref={detail} role="region" aria-label="상세페이지 스크롤" tabIndex={0}
          className="min-h-0 scroll-mt-14 px-2 py-3 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-blue-600 sm:px-4 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain">
          <ReviewImage url={receipt.hostedImageUrl} alt="제작된 전체 상세페이지"
            className="mx-auto block h-auto w-full max-w-[1000px] rounded-md bg-white shadow-sm" />
        </div>
      </section>
    </div>
  );
}

export default function AiSaurusResultReview({
  item, receipt, index, count, onNavigate, onClose,
}: {
  item: AiSaurusBatchProduct;
  receipt: AiSaurusHostedReceipt;
  index: number;
  count: number;
  onNavigate: (offset: -1 | 1) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();

  useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  }, []);

  return (
    <dialog ref={dialog} aria-labelledby={headingId} onClose={onClose}
      className="fixed inset-0 m-auto h-[94dvh] max-h-[960px] w-[96vw] max-w-[1460px] overflow-hidden rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/65">
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-slate-200 px-4 py-3 lg:px-5">
          <h2 id={headingId} className="min-w-0 flex-1 text-base font-bold leading-snug sm:text-lg">
            {item.model && <span className="mr-2 inline-block rounded-md bg-blue-50 px-2 py-0.5 text-sm text-blue-900">{item.model}</span>}
            {item.name || item.id}
          </h2>
          <div className="flex items-center gap-1.5">
            {count > 1 && (
              <nav className="flex items-center gap-1.5" aria-label="검수 상품 이동">
                <button type="button" className={control} disabled={index === 0} onClick={() => onNavigate(-1)}>이전 상품</button>
                <span className="whitespace-nowrap px-0.5 text-xs tabular-nums text-slate-600" aria-live="polite">{index + 1} / {count}</span>
                <button type="button" className={control} disabled={index + 1 === count} onClick={() => onNavigate(1)}>다음 상품</button>
              </nav>
            )}
            <button type="button" className={control} onClick={() => dialog.current?.close()}>닫기</button>
          </div>
        </header>
        <ReviewContent key={item.id} receipt={receipt} />
      </div>
    </dialog>
  );
}
