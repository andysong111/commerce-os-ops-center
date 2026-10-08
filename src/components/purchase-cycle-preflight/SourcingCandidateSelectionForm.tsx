"use client";

import Link from "next/link";
import { useState } from "react";

type StorageSize = "S" | "L";

type SelectedCandidate = {
  conceptId: string;
  canonicalNameKo: string;
  sourceUrl?: string | null;
  storageSize: StorageSize | null;
};

type AvailableCandidate = {
  conceptId: string;
  canonicalNameKo: string;
  sourceUrl?: string | null;
  finalQualityScore: number | null;
  moq: number | null;
  recommendedUnits: number;
};

type Props = {
  formId: string;
  targetDate: string;
  cash: string;
  sourcingBudgetPercent: number;
  early: boolean;
  replaceDraftId: string | null;
  selectedCandidates: SelectedCandidate[];
  availableCandidates: AvailableCandidate[];
  preferredConceptIds: string[];
  initialStorageSizeByConceptId: Record<string, StorageSize>;
};

export function SourcingCandidateSelectionForm({
  formId,
  targetDate,
  cash,
  sourcingBudgetPercent,
  early,
  replaceDraftId,
  selectedCandidates,
  availableCandidates,
  preferredConceptIds,
  initialStorageSizeByConceptId,
}: Props) {
  const [preferredIds, setPreferredIds] = useState(() => new Set(preferredConceptIds));
  const [storageByConceptId, setStorageByConceptId] = useState<Record<string, StorageSize>>(() => {
    const initial = { ...initialStorageSizeByConceptId };
    for (const candidate of selectedCandidates) {
      if (candidate.storageSize) initial[candidate.conceptId] = candidate.storageSize;
    }
    return initial;
  });

  function setPreferred(conceptId: string, checked: boolean) {
    setPreferredIds((current) => {
      const next = new Set(current);
      if (checked) next.add(conceptId);
      else next.delete(conceptId);
      return next;
    });
  }

  function setStorage(conceptId: string, storageSize: StorageSize) {
    setStorageByConceptId((current) => ({ ...current, [conceptId]: storageSize }));
  }

  return (
    <form id={formId} method="get" action="/purchase-cycle-preflight" className="mt-4 border-t border-slate-200 pt-4">
      <input type="hidden" name="check" value="1" />
      <input type="hidden" name="date" value={targetDate} />
      <input type="hidden" name="cash" value={cash} />
      <input type="hidden" name="sourcing" value={String(sourcingBudgetPercent)} />
      {early ? <input type="hidden" name="early" value="1" /> : null}
      {replaceDraftId ? <input type="hidden" name="replace" value={replaceDraftId} /> : null}
      {selectedCandidates.filter((candidate) => preferredIds.has(candidate.conceptId)).map((candidate) => (
        <input key={`preferred:${candidate.conceptId}`} type="hidden" name="source" value={candidate.conceptId} />
      ))}

      {selectedCandidates.length ? (
        <fieldset>
          <legend className="font-black text-slate-900">선정 상품 수납 위치</legend>
          <p className="mt-1 text-xs leading-5 text-slate-500">실물 크기를 기준으로 각 상품의 소형 또는 대형 수납을 선택하세요.</p>
          <div className="mt-3 grid gap-3">
            {selectedCandidates.map((candidate) => (
              <div key={`storage:${candidate.conceptId}`} className="border-y border-slate-100 py-3">
                <strong className="block text-slate-900">{candidate.canonicalNameKo}</strong>
                {candidate.sourceUrl ? <a href={candidate.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-xs font-bold text-blue-700 underline">1688 상품 링크 열기</a> : <span className="mt-1 block text-xs font-bold text-amber-700">1688 링크 확인 필요</span>}
                <div className="mt-2 flex flex-wrap gap-2">
                  <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 font-bold">
                    <input type="radio" name={`storage.${candidate.conceptId}`} value="S" checked={storageByConceptId[candidate.conceptId] === "S"} onChange={() => setStorage(candidate.conceptId, "S")} required />
                    소형 수납
                  </label>
                  <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 font-bold">
                    <input type="radio" name={`storage.${candidate.conceptId}`} value="L" checked={storageByConceptId[candidate.conceptId] === "L"} onChange={() => setStorage(candidate.conceptId, "L")} required />
                    대형 수납
                  </label>
                </div>
              </div>
            ))}
          </div>
        </fieldset>
      ) : null}

      {availableCandidates.length ? (
        <fieldset className={selectedCandidates.length ? "mt-5 border-t border-slate-200 pt-4" : ""}>
          <legend className="font-black text-slate-900">이번 발주에 넣을 후보</legend>
          <p className="mt-1 text-xs leading-5 text-slate-500">후보를 체크한 뒤 같은 자리에서 수납 위치까지 정하세요. 마지막 계산은 두 입력 영역 아래에서 한 번만 실행합니다.</p>
          <div className="mt-3 grid gap-3">
            {availableCandidates.map((candidate) => {
              const checked = preferredIds.has(candidate.conceptId);
              return (
                <div key={candidate.conceptId} className="border-y border-slate-100 px-1 py-3">
                  <label className="flex cursor-pointer items-start gap-3">
                    <input className="mt-1 size-4" type="checkbox" name="source" value={candidate.conceptId} checked={checked} onChange={(event) => setPreferred(candidate.conceptId, event.target.checked)} />
                    <span>
                      <strong>{candidate.canonicalNameKo}</strong>
                      <span className="mt-1 block text-xs text-slate-500">품질 {candidate.finalQualityScore ?? "미확인"} · MOQ {candidate.moq ?? "미확인"} · 최대 {candidate.recommendedUnits}개</span>
                    </span>
                  </label>
                  {candidate.sourceUrl ? <a href={candidate.sourceUrl} target="_blank" rel="noopener noreferrer" className="ml-7 mt-2 inline-block text-xs font-bold text-blue-700 underline">1688 상품 링크 열기</a> : <span className="ml-7 mt-2 block text-xs font-bold text-amber-700">1688 링크 확인 필요</span>}
                  {checked ? (
                    <fieldset className="ml-7 mt-3">
                      <legend className="text-xs font-black text-slate-700">수납 위치</legend>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold">
                          <input type="radio" name={`storage.${candidate.conceptId}`} value="S" checked={storageByConceptId[candidate.conceptId] === "S"} onChange={() => setStorage(candidate.conceptId, "S")} required />
                          소형 수납
                        </label>
                        <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold">
                          <input type="radio" name={`storage.${candidate.conceptId}`} value="L" checked={storageByConceptId[candidate.conceptId] === "L"} onChange={() => setStorage(candidate.conceptId, "L")} required />
                          대형 수납
                        </label>
                      </div>
                    </fieldset>
                  ) : null}
                </div>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      {!selectedCandidates.length && !availableCandidates.length ? (
        <p className="text-sm leading-6 text-slate-600">현재 표시할 소싱엔진 후보가 없습니다. 오른쪽에서 1688 상품을 직접 추가할 수 있습니다.</p>
      ) : null}
      <div className="mt-4">
        <Link prefetch={false} href="/sourcing-center" className="text-sm font-bold text-slate-600 underline">소싱센터 전체 보기</Link>
      </div>
    </form>
  );
}
