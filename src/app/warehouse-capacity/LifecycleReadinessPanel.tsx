"use client";

import { useEffect, useState } from "react";
import type { WarehouseCapacitySnapshot } from "@/lib/warehouseCapacityBridge";

type ApiPayload = {
  ok: boolean;
  snapshot?: WarehouseCapacitySnapshot;
  message?: string;
};

function Count({ label, value, helper }: { label: string; value: number; helper: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-bold text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-black text-slate-950">{value.toLocaleString("ko-KR")}</p>
      <p className="mt-1 text-[11px] leading-4 text-slate-500">{helper}</p>
    </div>
  );
}

export function LifecycleReadinessPanel() {
  const [snapshot, setSnapshot] = useState<WarehouseCapacitySnapshot | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/warehouse-capacity", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = (await response.json()) as ApiPayload;
        if (!response.ok || !payload.ok || !payload.snapshot) {
          throw new Error(payload.message || "상품 생애주기 준비상태를 불러오지 못했습니다.");
        }
        setSnapshot(payload.snapshot);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "상품 생애주기 준비상태를 불러오지 못했습니다.");
      });
    return () => controller.abort();
  }, []);

  if (error) {
    return (
      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
        <p className="text-sm font-black text-amber-950">상품 생애주기 준비상태 조회 실패</p>
        <p className="mt-1 text-xs leading-5 text-amber-800">{error}</p>
      </section>
    );
  }

  if (!snapshot) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-sm font-bold text-slate-500">상품 생애주기 준비상태를 확인하는 중입니다…</p>
      </section>
    );
  }

  const baselineReady = snapshot.lifecycleAuthoritativeSkuCount ?? 0;
  const required = snapshot.lifecycleRequiredSkuCount ?? 0;
  const missing = snapshot.lifecycleMissingSkuCount ?? Math.max(0, required - snapshot.lifecycleCoveredSkuCount);
  const shadow = snapshot.lifecycleShadowSkuCount ?? 0;
  const waiting = snapshot.lifecycleWaitingBaselineSkuCount ?? 0;
  const insufficientHistory = snapshot.lifecycleInsufficientHistorySkuCount ?? waiting;
  const trustedExits = snapshot.trustedExitCandidateLocationCount ?? 0;
  const excludedExits = snapshot.untrustedExitCandidateLocationCount ?? Math.max(0, snapshot.exitCandidateLocationCount - trustedExits);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black text-slate-500">단종·정리 예측 데이터 준비상태</p>
          <h2 className="mt-1 text-lg font-black text-slate-950">
            6개월 기준선 충족 {baselineReady.toLocaleString("ko-KR")}/{required.toLocaleString("ko-KR")}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            6개월 이상 판매이력과 기준선 평가가 끝난 SKU만 정리 예정 공간 예측에 사용합니다. 그림자 모드는 가격·발주 자동실행을 막는 별도 안전장치이며, 분석 기준선이 성숙했다는 사실까지 무효로 만들지는 않습니다.
          </p>
          {!snapshot.lifecycleReady ? (
            <p className="mt-2 max-w-3xl text-xs font-bold leading-5 text-amber-800">
              전체 lifecycle이 아직 완성되지 않아 예상 수용량은 확인된 정리 후보만 포함한 보수적 하한값입니다. 실제로 비어 있는 물리 위치는 이와 별도로 계산됩니다.
            </p>
          ) : null}
        </div>
        <span
          className={
            snapshot.lifecycleReady
              ? "rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-800"
              : "rounded-full bg-amber-50 px-3 py-1 text-xs font-black text-amber-800"
          }
        >
          {snapshot.lifecycleReady ? "기준선 완성" : "보수적 하한 예측"}
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Count
          label="6개월 기준선 충족 SKU"
          value={baselineReady}
          helper="history_months ≥ 6이고 WAITING_BASELINE을 벗어난 상태"
        />
        <Count
          label="6개월 미만 SKU"
          value={insufficientHistory}
          helper="정리 예정 공간 예측에는 아직 포함하지 않음"
        />
        <Count
          label="상태 누락 SKU"
          value={missing}
          helper="활성 위치 SKU지만 생애주기 원장 행이 아직 없음"
        />
        <Count
          label="그림자 모드 SKU"
          value={shadow}
          helper="가격·발주 실행은 차단 · 분석 기준선과 별도 관리"
        />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Count
          label="기준선 대기 SKU"
          value={waiting}
          helper="WAITING_BASELINE 또는 초기 기준값 미확정"
        />
        <Count
          label="예측 포함 정리 위치"
          value={trustedExits}
          helper="6개월 기준선이 확인되어 forecast에 포함"
        />
        <Count
          label="예측 제외 정리 위치"
          value={excludedExits}
          helper="후보이지만 기준선 미성숙이라 forecast에서 제외"
        />
      </div>
    </section>
  );
}
