"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type {
  SourcingBudgetPlanSelection,
  SourcingSaleVariant,
  SourcingVariantSelectionInput,
} from "@/lib/sourcingBudgetPlan";

type StorageSize = "S" | "L";

type Candidate = {
  conceptId: string;
  canonicalNameKo: string;
  sourceUrl?: string | null;
  finalQualityScore: number | null;
  moq: number | null;
  recommendedUnits: number;
  variants: SourcingSaleVariant[];
  selectedVariants?: SourcingBudgetPlanSelection["selectedVariants"];
};

type Props = {
  formId: string;
  targetDate: string;
  cash: string;
  sourcingBudgetPercent: number;
  early: boolean;
  replaceDraftId: string | null;
  selectedCandidates: SourcingBudgetPlanSelection[];
  availableCandidates: Candidate[];
  preferredConceptIds: string[];
  initialVariantSelections: SourcingVariantSelectionInput[];
};

function identity(conceptId: string, variantKey: string) {
  return `${conceptId}\0${variantKey}`;
}

export function SourcingCandidateSelectionForm({
  formId,
  targetDate,
  cash,
  sourcingBudgetPercent,
  early,
  replaceDraftId,
  selectedCandidates,
  availableCandidates,
  initialVariantSelections,
}: Props) {
  const candidates = useMemo(() => {
    const byId = new Map<string, Candidate>();
    for (const candidate of [...selectedCandidates, ...availableCandidates]) {
      if (!byId.has(candidate.conceptId)) byId.set(candidate.conceptId, candidate);
    }
    return [...byId.values()];
  }, [availableCandidates, selectedCandidates]);
  const [selectedByIdentity, setSelectedByIdentity] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const selection of initialVariantSelections) {
      initial[identity(selection.conceptId, selection.variantKey)] = true;
    }
    for (const candidate of selectedCandidates) {
      for (const variant of candidate.selectedVariants) {
        initial[identity(candidate.conceptId, variant.variantKey)] = true;
      }
    }
    return initial;
  });
  const [storageByIdentity, setStorageByIdentity] = useState<Record<string, StorageSize>>(() => {
    const initial: Record<string, StorageSize> = {};
    for (const selection of initialVariantSelections) {
      initial[identity(selection.conceptId, selection.variantKey)] = selection.storageSize;
    }
    for (const candidate of selectedCandidates) {
      for (const variant of candidate.selectedVariants) {
        initial[identity(candidate.conceptId, variant.variantKey)] = variant.storageSize;
      }
    }
    return initial;
  });

  function setVariant(conceptId: string, variantKey: string, checked: boolean) {
    const key = identity(conceptId, variantKey);
    setSelectedByIdentity((current) => {
      const next = { ...current };
      if (checked) next[key] = true;
      else delete next[key];
      return next;
    });
    if (!checked) {
      setStorageByIdentity((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  }

  function setStorage(conceptId: string, variantKey: string, storageSize: StorageSize) {
    setStorageByIdentity((current) => ({
      ...current,
      [identity(conceptId, variantKey)]: storageSize,
    }));
  }

  const selections = candidates.flatMap((candidate) =>
    candidate.variants.flatMap((variant) => {
      const key = identity(candidate.conceptId, variant.variantKey);
      const storageSize = storageByIdentity[key];
      return selectedByIdentity[key] && storageSize
        ? [{ conceptId: candidate.conceptId, variantKey: variant.variantKey, storageSize }]
        : [];
    })
  );
  const selectedOptionCount = Object.keys(selectedByIdentity).length;
  const missingStorageCount = Math.max(0, selectedOptionCount - selections.length);
  const selectedConceptIds = [...new Set(selections.map((selection) => selection.conceptId))];

  return (
    <form id={formId} method="get" action="/purchase-cycle-preflight" className="mt-4 border-t border-slate-200 pt-4">
      <input type="hidden" name="check" value="1" />
      <input type="hidden" name="date" value={targetDate} />
      <input type="hidden" name="cash" value={cash} />
      <input type="hidden" name="sourcing" value={String(sourcingBudgetPercent)} />
      {early ? <input type="hidden" name="early" value="1" /> : null}
      {replaceDraftId ? <input type="hidden" name="replace" value={replaceDraftId} /> : null}
      {selectedConceptIds.map((conceptId) => (
        <input key={`source:${conceptId}`} type="hidden" name="source" value={conceptId} />
      ))}
      {selections.map((selection) => (
        <input
          key={`variant:${selection.conceptId}:${selection.variantKey}`}
          type="hidden"
          name="variant"
          value={JSON.stringify(selection)}
        />
      ))}

      <fieldset>
        <legend className="font-black text-slate-900">판매할 1688 옵션 선택</legend>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          판매할 옵션만 체크하고 옵션마다 수납 위치를 지정하세요. 선택한 옵션마다 B코드와 발주행이 하나씩 생성됩니다.
          마지막 계산은 두 입력 영역 아래에서 한 번만 실행합니다.
        </p>
        <div className="mt-3 grid gap-5">
          {candidates.map((candidate) => (
            <section key={candidate.conceptId} className="border-y border-slate-200 py-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <strong className="block text-slate-950">{candidate.canonicalNameKo}</strong>
                  <span className="mt-1 block text-xs text-slate-500">
                    품질 {candidate.finalQualityScore ?? "미확인"} · MOQ {candidate.moq ?? "미확인"} · 총 권장수량 {candidate.recommendedUnits}개
                  </span>
                </div>
                {candidate.sourceUrl ? (
                  <a href={candidate.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-xs font-bold text-blue-700 underline">
                    1688 상품 링크 열기
                  </a>
                ) : <span className="text-xs font-bold text-amber-700">1688 링크 확인 필요</span>}
              </div>
              {candidate.variants.length ? (
                <div className="mt-3 divide-y divide-slate-100 border-t border-slate-100">
                  {candidate.variants.map((variant) => {
                    const key = identity(candidate.conceptId, variant.variantKey);
                    const checked = selectedByIdentity[key] === true;
                    const planned = candidate.selectedVariants?.find((row) => row.variantKey === variant.variantKey);
                    return (
                      <div key={variant.variantKey} className="py-3">
                        <label className="flex cursor-pointer items-start gap-3">
                          <input
                            className="mt-1 size-4"
                            type="checkbox"
                            checked={checked}
                            onChange={(event) => setVariant(candidate.conceptId, variant.variantKey, event.target.checked)}
                          />
                          <span>
                            <strong className="block">{variant.saleOption}</strong>
                            <span className="mt-1 block text-xs text-slate-500">1688 옵션 {variant.chinaOption} · ¥{variant.unitPriceCny}{planned ? ` · 계산 수량 ${planned.quantity}개` : ""}</span>
                          </span>
                        </label>
                        {checked ? (
                          <fieldset className="ml-7 mt-3">
                            <legend className="text-xs font-black text-slate-700">이 옵션의 수납 공간</legend>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {(["S", "L"] as const).map((size) => (
                                <label key={size} className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold">
                                  <input
                                    type="radio"
                                    name={`variant-storage.${candidate.conceptId}.${variant.variantKey}`}
                                    value={size}
                                    checked={storageByIdentity[key] === size}
                                    onChange={() => setStorage(candidate.conceptId, variant.variantKey, size)}
                                    required
                                  />
                                  {size === "S" ? "소형 수납" : "대형 수납"}
                                </label>
                              ))}
                            </div>
                          </fieldset>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : <p className="mt-3 border-l-4 border-amber-500 bg-amber-50 px-3 py-2 text-sm font-bold">1688 옵션 근거를 다시 수집해야 합니다.</p>}
            </section>
          ))}
        </div>
      </fieldset>

      {!candidates.length ? (
        <p className="text-sm leading-6 text-slate-600">현재 표시할 소싱엔진 후보가 없습니다. 오른쪽에서 1688 상품을 직접 추가할 수 있습니다.</p>
      ) : null}
      <p className="mt-4 text-sm font-bold text-slate-800">
        현재 선택 {selectedOptionCount}개 옵션
        {missingStorageCount > 0 ? ` · 수납 위치 미지정 ${missingStorageCount}개` : ""}
      </p>
      <div className="mt-3">
        <Link prefetch={false} href="/sourcing-center" className="text-sm font-bold text-slate-600 underline">소싱센터 전체 보기</Link>
      </div>
    </form>
  );
}
