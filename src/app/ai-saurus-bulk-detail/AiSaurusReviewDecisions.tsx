"use client";

import { useState } from "react";
import { hasSaurusRetryAvailable, type AiSaurusBatchProduct } from "@/lib/aiSaurusBulkDetailTypes";
import { AI_SAURUS_REVIEW_ROLES, readSaurusReviewAssets } from "@/lib/aiSaurusReviewAssets";

export type ReviewAction = "approve" | "retry" | "reject";
type Confirmation = "retry" | "reject";

const secondary = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50";

type DecisionProps = {
  item: AiSaurusBatchProduct;
  busy: boolean;
  error: string;
  decide: (action: ReviewAction) => void;
};

export function CompletedProductActions({ onOpen, ...props }: DecisionProps & { onOpen: (trigger: HTMLButtonElement) => void }) {
  const { item } = props;
  if (!item.receipt || !["awaiting_review", "approving", "approved"].includes(item.stage)) return null;
  return (
    <div className="flex flex-wrap items-start gap-2">
      <button type="button" aria-haspopup="dialog"
        className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-bold text-blue-900 hover:border-blue-400 hover:bg-blue-100 focus-visible:outline-2 focus-visible:outline-blue-600"
        onClick={(event) => onOpen(event.currentTarget)}>이미지 검수</button>
      {item.stage !== "approving" && <AiSaurusReviewDecisions key={item.stage} {...props} retryOnly />}
    </div>
  );
}

export default function AiSaurusReviewDecisions({ item, busy, error, decide, retryOnly = false }: DecisionProps & { retryOnly?: boolean }) {
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const awaiting = item.stage === "awaiting_review";
  const failed = item.stage === "failed";
  const approving = item.stage === "approving";
  const approved = item.stage === "approved";
  const canRetry = hasSaurusRetryAvailable(item);
  const gallery = item.receipt && readSaurusReviewAssets(item.receipt.reviewAssets, item.receipt.transferReceiptId);
  const completeGallery = AI_SAURUS_REVIEW_ROLES.every((role) => Boolean(gallery?.[role]));
  const hasBCode = Boolean(item.bCodes?.length);
  if (!awaiting && !failed && !approving && !approved) return null;

  return (
    <div className="space-y-2">
      {error && <p role="alert" className="text-sm text-rose-800">{error}</p>}
      {!retryOnly && (awaiting || approving) && !completeGallery && <p className="text-sm text-slate-600">대표 1장·부가 4장과 상세페이지가 모두 있어야 승인할 수 있습니다.</p>}
      {!retryOnly && (awaiting || approving) && !hasBCode && <p className="text-sm text-slate-600">상품출시 진행관리에서 B코드를 확인한 뒤 승인해 주세요.</p>}
      {confirmation ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5">
          <p className="min-w-0 flex-1 text-sm text-amber-950">{confirmation === "reject"
            ? "이 상품은 앞으로 AI 사우루스 제작이 차단됩니다. 직접 제작한 이미지 주소를 입력할 수 있습니다."
            : approved ? "이 상품을 한 번 더 제작할 수 있게 준비합니다. 새 결과를 승인하면 기존 상세페이지·대표·부가 이미지 주소가 교체됩니다."
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
          {!retryOnly && (awaiting || failed) && (
            <button type="button" disabled={busy} onClick={() => setConfirmation("reject")} className={`${secondary} text-rose-800`}>승인 거절</button>
          )}
          {(awaiting || failed || approved) && (
            <button type="button" disabled={busy || !canRetry} onClick={() => setConfirmation("retry")} className={secondary}>
              {canRetry ? "재시도 · 1회 남음" : "재시도 사용 완료"}
            </button>
          )}
          {!retryOnly && (awaiting || approving) && (
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
