"use client";

import {
  buildPurchaseCycleCandidateSummary,
  resolvePurchaseCycleCalculationButtonState,
  resolvePurchaseCycleNextAction,
} from "@/lib/purchaseCyclePreflightPresentation";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

type CandidateSnapshot = {
  signature: string;
  manualProductCount: number;
  manualOptionCount: number;
  includedAutomaticCount: number;
};

function createFormSignature(form: HTMLFormElement) {
  return [...new FormData(form)]
    .map(([key, value]) => `${key}=${typeof value === "string" ? value : value.name}`)
    .sort()
    .join("&");
}

export function NewProductConfigurationCalculateButton({
  formId,
  manualFormId,
  automaticCandidateCount,
  calculationComplete,
  remainingActionCount,
  draftReady,
}: {
  formId: string;
  manualFormId: string;
  automaticCandidateCount: number;
  calculationComplete: boolean;
  remainingActionCount: number;
  draftReady: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [snapshot, setSnapshot] = useState<CandidateSnapshot>({
    signature: "",
    manualProductCount: 0,
    manualOptionCount: 0,
    includedAutomaticCount: 0,
  });
  const [baselineSignature, setBaselineSignature] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearNavigationWatch = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    pollRef.current = null;
    timeoutRef.current = null;
  }, []);

  const readSnapshot = useCallback((): CandidateSnapshot | null => {
    const configurationForm = document.getElementById(formId);
    if (!(configurationForm instanceof HTMLFormElement)) return null;

    const sourceInputs = [...document.querySelectorAll<HTMLInputElement>('input[name="source"][data-candidate-origin]')]
      .filter((input) => input.form?.id === formId);
    const manualInputs = sourceInputs.filter((input) => input.dataset.candidateOrigin === "manual");
    const manualProductNames = new Set(
      manualInputs
        .map((input) => input.dataset.manualProductName?.trim())
        .filter((name): name is string => Boolean(name)),
    );
    const manualForm = document.getElementById(manualFormId);
    const unsavedManualProductCount =
      manualForm instanceof HTMLFormElement
        ? Number(manualForm.dataset.unsavedProductCount || "0")
        : 0;
    const unsavedManualOptionCount =
      manualForm instanceof HTMLFormElement
        ? Number(manualForm.dataset.unsavedOptionCount || "0")
        : 0;

    return {
      signature: [
        createFormSignature(configurationForm),
        `unsaved-products=${unsavedManualProductCount}`,
        `unsaved-options=${unsavedManualOptionCount}`,
      ].join("&"),
      manualProductCount: manualProductNames.size + unsavedManualProductCount,
      manualOptionCount: manualInputs.length + unsavedManualOptionCount,
      includedAutomaticCount: sourceInputs.filter((input) => input.dataset.candidateOrigin === "automatic").length,
    };
  }, [formId, manualFormId]);

  useEffect(() => {
    const refreshSnapshot = () => {
      const nextSnapshot = readSnapshot();
      if (!nextSnapshot) return;
      setSnapshot((current) =>
        current.signature === nextSnapshot.signature &&
        current.manualProductCount === nextSnapshot.manualProductCount &&
        current.manualOptionCount === nextSnapshot.manualOptionCount &&
        current.includedAutomaticCount === nextSnapshot.includedAutomaticCount
          ? current
          : nextSnapshot,
      );
      setBaselineSignature((current) => current ?? nextSnapshot.signature);
    };

    const configurationForm = document.getElementById(formId);
    const manualForm = document.getElementById(manualFormId);
    configurationForm?.addEventListener("input", refreshSnapshot);
    configurationForm?.addEventListener("change", refreshSnapshot);
    manualForm?.addEventListener("input", refreshSnapshot);
    manualForm?.addEventListener("change", refreshSnapshot);

    const observer = new MutationObserver(refreshSnapshot);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        "value",
        "name",
        "form",
        "data-candidate-origin",
        "data-manual-product-name",
        "data-unsaved-product-count",
        "data-unsaved-option-count",
      ],
    });
    refreshSnapshot();

    return () => {
      configurationForm?.removeEventListener("input", refreshSnapshot);
      configurationForm?.removeEventListener("change", refreshSnapshot);
      manualForm?.removeEventListener("input", refreshSnapshot);
      manualForm?.removeEventListener("change", refreshSnapshot);
      observer.disconnect();
    };
  }, [formId, manualFormId, readSnapshot]);

  useEffect(() => () => clearNavigationWatch(), [clearNavigationWatch]);

  function calculate() {
    setError("");
    const configurationForm = document.getElementById(formId);
    if (!(configurationForm instanceof HTMLFormElement)) {
      setError("신규상품 계산 정보를 찾지 못했습니다. 화면을 새로고침한 뒤 다시 시도하세요.");
      return;
    }

    const manualForm = document.getElementById(manualFormId);
    if (manualForm instanceof HTMLFormElement) {
      if (manualForm.getAttribute("aria-busy") === "true") {
        setError("수동상품 후보를 추가하고 있습니다. 일괄 추가가 끝난 뒤 계산하세요.");
        return;
      }
      const hasUnsavedManualProduct = Number(manualForm.dataset.unsavedProductCount || "0") > 0;
      if (hasUnsavedManualProduct) {
        setError("작성 중인 수동상품이 있습니다. 먼저 ‘입력한 상품 후보 목록에 추가’를 누르세요.");
        manualForm.querySelector<HTMLInputElement>("[data-manual-source-url]")?.focus();
        return;
      }
    }

    if (!configurationForm.reportValidity()) return;
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(configurationForm)) {
      if (typeof value === "string") params.append(key, value);
    }

    const currentSnapshot = readSnapshot();
    if (currentSnapshot) {
      setBaselineSignature(currentSnapshot.signature);
      setSnapshot(currentSnapshot);
    }
    const startingSearch = window.location.search;
    setSubmitted(true);
    clearNavigationWatch();
    pollRef.current = setInterval(() => {
      if (window.location.search === startingSearch) return;
      clearNavigationWatch();
      setBaselineSignature(null);
      setSubmitted(false);
    }, 100);
    timeoutRef.current = setTimeout(() => {
      clearNavigationWatch();
      setSubmitted(false);
    }, 20_000);

    startTransition(() => {
      router.push(`/purchase-cycle-preflight?${params.toString()}`);
    });
  }

  const effectivePending = pending || submitted;
  const configurationChanged =
    baselineSignature !== null && baselineSignature !== snapshot.signature;
  const buttonState = resolvePurchaseCycleCalculationButtonState({
    pending: effectivePending,
    calculationComplete,
    configurationChanged,
  });
  const candidateSummary = buildPurchaseCycleCandidateSummary({
    manualProductCount: snapshot.manualProductCount,
    manualOptionCount: snapshot.manualOptionCount,
    automaticCandidateCount,
    includedAutomaticCount: snapshot.includedAutomaticCount,
  });
  const nextAction = resolvePurchaseCycleNextAction({
    pending: effectivePending,
    calculationComplete,
    remainingActionCount,
    draftReady,
  });

  return (
    <div className="mt-6 border-t border-slate-200 pt-5">
      <details open className="mb-4 rounded-xl border border-sky-200 bg-sky-50/70 p-4">
        <summary className="cursor-pointer text-sm font-black text-sky-950">작업 처리 순서 보기</summary>
        <ol className="mt-3 grid gap-2 text-xs font-medium leading-5 text-slate-700 md:grid-cols-2">
          <li><strong>1.</strong> 예산을 입력하고 기존상품 자동후보를 불러옵니다.</li>
          <li><strong>2.</strong> 수동상품을 추가하고 자동소싱 후보는 포함·제외를 정합니다.</li>
          <li><strong>3.</strong> 아래 계산 버튼으로 후보·수량·예산을 한 번에 계산합니다.</li>
          <li><strong>4.</strong> 남은 확인 항목을 처리한 뒤 내부 Draft를 저장합니다.</li>
          <li className="md:col-span-2"><strong>5.</strong> 중국 주문초안에서 재고·수량 확인 → 5-1 원가·운임 기록 → 5-2 장바구니 담기 순으로 진행합니다.</li>
        </ol>
        <div className="mt-3 rounded-lg bg-white px-3 py-2 text-xs leading-5 text-slate-700">
          <p><strong className="text-sky-900">현재:</strong> {nextAction.current}</p>
          <p><strong className="text-sky-900">다음:</strong> {nextAction.next}</p>
        </div>
      </details>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs font-medium leading-5 text-slate-600">
          <p>초록색 ‘발주안 계산 준비 완료’ 목록과 왼쪽 자동 후보 선택을 모두 반영합니다.</p>
          <p className="mt-1 font-bold text-slate-900">{candidateSummary}</p>
        </div>
        <button type="button" onClick={calculate} disabled={buttonState.disabled} aria-busy={effectivePending} className="flex min-h-12 items-center justify-center gap-2 rounded-lg bg-slate-950 px-6 py-3 text-sm font-black text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60">
          {buttonState.phase === "pending" ? (
            <>
              <span aria-hidden="true" className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              {buttonState.label}
            </>
          ) : buttonState.label}
        </button>
      </div>
      {effectivePending ? <p role="status" className="mt-3 border-l-4 border-sky-500 bg-sky-50 px-3 py-2 text-xs font-bold leading-5 text-sky-950">저장한 후보와 수납 위치를 한 번에 반영하고 있습니다. 완료될 때까지 버튼은 다시 눌리지 않습니다.</p> : null}
      {error ? <p role="alert" className="mt-3 border-l-4 border-rose-500 bg-rose-50 px-3 py-2 text-xs font-bold leading-5 text-rose-950">{error}</p> : null}
    </div>
  );
}
