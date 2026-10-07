"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function NewProductConfigurationCalculateButton({ formId, manualFormId }: { formId: string; manualFormId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

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
      const manualValues = new FormData(manualForm);
      const hasUnsavedManualProduct = [...manualValues.values()].some((value) => typeof value === "string" && value.trim() !== "");
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
    startTransition(() => {
      router.push(`/purchase-cycle-preflight?${params.toString()}`);
    });
  }

  return (
    <div className="mt-6 border-t border-slate-200 pt-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs font-medium leading-5 text-slate-600">소싱엔진 선택과 수동 후보를 모두 모은 뒤 이 버튼을 한 번만 누르세요.</p>
        <button type="button" onClick={calculate} disabled={pending} aria-busy={pending} className="flex min-h-12 items-center justify-center gap-2 rounded-lg bg-slate-950 px-6 py-3 text-sm font-black text-white hover:bg-slate-800 disabled:cursor-wait disabled:opacity-75">
          {pending ? (
            <>
              <span aria-hidden="true" className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              최종 발주안 계산 중...
            </>
          ) : "신규상품 구성 완료 · 발주안 한 번 계산"}
        </button>
      </div>
      {pending ? <p role="status" className="mt-3 border-l-4 border-sky-500 bg-sky-50 px-3 py-2 text-xs font-bold leading-5 text-sky-950">저장한 후보와 수납 위치를 한 번에 반영하고 있습니다.</p> : null}
      {error ? <p role="alert" className="mt-3 border-l-4 border-rose-500 bg-rose-50 px-3 py-2 text-xs font-bold leading-5 text-rose-950">{error}</p> : null}
    </div>
  );
}
