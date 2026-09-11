"use client";

import { useEffect, useState } from "react";
import type { WarehouseCapacitySnapshot } from "@/lib/warehouseCapacityBridge";

type ApiPayload = {
  ok: boolean;
  snapshot?: WarehouseCapacitySnapshot;
  message?: string;
};

function Count({ label, value, helper }: { label: string; value: number | undefined; helper: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-bold text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-black text-slate-950">{value === undefined ? "미확정" : value.toLocaleString("ko-KR")}</p>
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
        if (!controller.signal.aborted) setSnapshot(payload.snapshot);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "상품 생애주기 준비상태를 불러오지 못했습니다.");
      });
    return () => controller.abort();
  }, []);

  if (error) return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
      <p className="text-sm font-black text-amber-950">상품 생애주기 준비상태 조회 실패</p>
      <p className="mt-1 text-xs leading-5 text-amber-800">{error}</p>
    </section>
  );

  if (!snapshot) return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-sm font-bold text-slate-500">상품 생애주기 준비상태를 확인하는 중입니다…</p>
    </section>
  );

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
            기준선 확인 {authoritative.toLocaleString("ko-KR")}/{required.toLocaleString("ko-KR")}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            6개월 분석 기준선과 그림자 모드는 별개입니다. 그림자 모드는 가격·발주 자동실행을 막으며,
            기준선이 확인된 정리 후보만 조건부 예측에 포함합니다. 누락·기준선 대기 데이터는 자동 승격하지 않습니다.
            실제 빈 위치를 사용하는 데 모든 상품의 기준선 확정이 필요한 것은 아닙니다.
          </p>
        </div>
        <span className={snapshot.lifecycleReady ? "rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-800" : "rounded-full bg-amber-50 px-3 py-1 text-xs font-black text-amber-800"}>
          {snapshot.lifecycleReady ? "분석 기준선 확인" : "미검증 후보 제외 · FAIL-CLOSED"}
        </span>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Count label="기준선 확인 SKU" value={authoritative} helper="6개월 이상 이력과 기준선 처리 상태 확인" />
        <Count label="상태 누락 SKU" value={missing} helper="활성 위치 SKU지만 생애주기 원장 행이 아직 없음" />
        <Count label="그림자 모드 SKU" value={shadow} helper="실제 가격·발주 실행 차단 · 분석 기준선과 별개" />
        <Count label="기준선 대기 SKU" value={waiting} helper="WAITING_BASELINE 또는 초기 기준값 미확정" />
        <Count label="6개월 미만 SKU" value={snapshot.lifecycleInsufficientHistorySkuCount} helper="필요한 분석 이력이 부족 · 다른 미확정 항목과 중복될 수 있음" />
      </div>
    </section>
  );
}
