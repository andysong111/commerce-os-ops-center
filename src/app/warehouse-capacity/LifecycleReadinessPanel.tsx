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

  const authoritative = snapshot.lifecycleAuthoritativeSkuCount ?? 0;
  const required = snapshot.lifecycleRequiredSkuCount ?? 0;
  const missing = snapshot.lifecycleMissingSkuCount ?? Math.max(0, required - snapshot.lifecycleCoveredSkuCount);
  const shadow = snapshot.lifecycleShadowSkuCount ?? 0;
  const waiting = snapshot.lifecycleWaitingBaselineSkuCount ?? 0;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black text-slate-500">단종·정리 판단 데이터 준비상태</p>
          <h2 className="mt-1 text-lg font-black text-slate-950">
            {snapshot.lifecycleReady
              ? `확정 ${authoritative.toLocaleString("ko-KR")}/${required.toLocaleString("ko-KR")}`
              : `아직 확정 사용 불가 · ${authoritative.toLocaleString("ko-KR")}/${required.toLocaleString("ko-KR")}`}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            그림자 모드와 기준선 대기는 실제 단종 결정을 실행하지 않는 안전 단계입니다. 이 수치를 억지로 해제하지 않고,
            모든 활성 SKU의 기준이 확정된 뒤에만 정리 예정 위치를 신규 소싱 여유공간으로 계산합니다.
          </p>
        </div>
        <span
          className={
            snapshot.lifecycleReady
              ? "rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-800"
              : "rounded-full bg-amber-50 px-3 py-1 text-xs font-black text-amber-800"
          }
        >
          {snapshot.lifecycleReady ? "판단 가능" : "FAIL-CLOSED"}
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Count
          label="확정 상태 SKU"
          value={authoritative}
          helper="실제 용량 예측에 사용할 수 있는 생애주기 상태"
        />
        <Count
          label="상태 누락 SKU"
          value={missing}
          helper="활성 위치 SKU지만 생애주기 원장 행이 아직 없음"
        />
        <Count
          label="그림자 모드 SKU"
          value={shadow}
          helper="계산·표시만 하고 실제 운영 판단에는 아직 미적용"
        />
        <Count
          label="기준선 대기 SKU"
          value={waiting}
          helper="WAITING_BASELINE 또는 초기 기준값 미확정"
        />
      </div>
    </section>
  );
}
