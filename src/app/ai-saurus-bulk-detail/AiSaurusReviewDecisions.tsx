"use client";

import { useState } from "react";
import { hasSaurusRetryAvailable, type AiSaurusBatchProduct } from "@/lib/aiSaurusBulkDetailTypes";
import { AI_SAURUS_REVIEW_ROLES, readSaurusReviewAssets } from "@/lib/aiSaurusReviewAssets";

export type ReviewAction = "approve" | "retry" | "reject";
type Confirmation = "retry" | "reject";

const secondary = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50";

export default function AiSaurusReviewDecisions({ item, busy, error, decide }: {
  item: AiSaurusBatchProduct;
  busy: boolean;
  error: string;
  decide: (action: ReviewAction) => void;
}) {
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const awaiting = item.stage === "awaiting_review";
  const failed = item.stage === "failed";
  const approving = item.stage === "approving";
  const canRetry = hasSaurusRetryAvailable(item);
  const gallery = item.receipt && readSaurusReviewAssets(item.receipt.reviewAssets, item.receipt.transferReceiptId);
  const completeGallery = AI_SAURUS_REVIEW_ROLES.every((role) => Boolean(gallery?.[role]));
  const hasBCode = Boolean(item.bCodes?.length);
  if (!awaiting && !failed && !approving) return null;

  return (
    <div className="space-y-2">
      {error && <p role="alert" className="text-sm text-rose-800">{error}</p>}
      {(awaiting || approving) && !completeGallery && <p className="text-sm text-slate-600">대표 1장·부가 4장과 상세페이지가 모두 있어야 승인할 수 있습니다.</p>}
      {(awaiting || approving) && !hasBCode && <p className="text-sm text-slate-600">상품출시 진행관리에서 B코드를 확인한 뒤 승인해 주세요.</p>}
      {confirmation ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5">
          <p className="min-w-0 flex-1 text-sm text-amber-950">{confirmation === "reject"
            ? "이 상품은 앞으로 AI 사우루스 제작이 차단됩니다. 직접 제작한 이미지 주소를 입력할 수 있습니다."
            : "현재 결과를 검수에서 내리고 한 번 더 제작할 수 있게 준비합니다."}</p>
          <div className="flex shrink-0 gap-2">
            <button type="button" className={secondary} disabled={busy} onClick={() => setConfirmation(null)}>취소</button>
            <button type="button" disabled={busy} onClick={() => { decide(confirmation); setConfirmation(null); }}
              className={`rounded-lg px-3 py-2 text-sm font-bold text-white disabled:opacity-50 ${confirmation === "reject" ? "bg-rose-700" : "bg-blue-700"}`}>
              {confirmation === "reject" ? "거절 확정" : "재시도 준비"}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {(awaiting || failed) && (
            <>
              <button type="button" disabled={busy} onClick={() => setConfirmation("reject")} className={`${secondary} text-rose-800`}>승인 거절</button>
              <button type="button" disabled={busy || !canRetry} onClick={() => setConfirmation("retry")} className={secondary}>
                {canRetry ? "재시도 · 1회 남음" : "재시도 사용 완료"}
              </button>
            </>
          )}
          {(awaiting || approving) && (
            <button type="button" disabled={busy || !completeGallery || !hasBCode} onClick={() => decide("approve")}
              className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50">
              {busy ? "저장 중…" : approving ? "승인 저장 다시 확인" : "승인 · URL 저장"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
