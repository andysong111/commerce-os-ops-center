"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { parseWarehouseIntakeInput, type WarehouseIntakePreflight } from "@/lib/warehouseIntakePreflight";

const fields = [
  { key: "productCount", label: "검토할 신규 상품 수", min: 1 },
  { key: "optionsPerProduct", label: "상품당 옵션 수", min: 1 },
  { key: "slotsPerSku", label: "옵션당 필요 위치 수", min: 1 },
  { key: "committedSlots", label: "미배정 입고·발주 선점 위치 수", min: 0 },
] as const;

const reasonLabels: Record<string, string> = {
  STALE_OR_INVALID_SNAPSHOT: "조회 기준이 오래되었거나 잘못되었습니다. 다시 점검해 주세요.",
  PHYSICAL_REGISTRY_UNCONFIRMED: "실제 창고의 전체 위치 목록을 먼저 확정해야 합니다.",
  CAPACITY_GATE_NOT_READY: "창고 수용량 계산 조건을 아직 충족하지 못했습니다.",
  CAPACITY_DATA_CONFLICT: "미등록·배정 금지·중복 점유 위치를 먼저 확인해야 합니다.",
  IMMEDIATE_CAPACITY_INVALID: "즉시 수용량이 미확정이거나 원장 계산과 일치하지 않습니다.",
};

function amount(value: number | null) {
  return value === null ? "미확정" : value.toLocaleString("ko-KR");
}

export function WarehouseIntakePreflightPanel() {
  const [values, setValues] = useState({ productCount: "", optionsPerProduct: "", slotsPerSku: "1", committedSlots: "" });
  const [result, setResult] = useState<WarehouseIntakePreflight | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const validInput = useMemo(() => {
    try { return parseWarehouseIntakeInput(values); } catch { return null; }
  }, [values]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  async function check() {
    if (!validInput || busyRef.current) return;
    busyRef.current = true;
    setPending(true);
    setResult(null);
    setError("");
    const controller = new AbortController();
    controllerRef.current = controller;
    const timer = setTimeout(() => controller.abort(), 25_000);
    try {
      const params = new URLSearchParams(Object.entries(validInput).map(([key, value]) => [key, String(value)]));
      const response = await fetch(`/api/warehouse-capacity/intake-preflight?${params}`, { cache: "no-store", signal: controller.signal });
      const payload = await response.json() as { ok: boolean; preflight?: WarehouseIntakePreflight; message?: string };
      if (!response.ok || !payload.ok || !payload.preflight) {
        throw new Error(payload.message || "사전점검 결과를 불러오지 못했습니다.");
      }
      setResult(payload.preflight);
    } catch (cause) {
      setError(controller.signal.aborted ? "점검 시간이 초과되었거나 요청이 취소되었습니다. 다시 점검해 주세요." : cause instanceof Error ? cause.message : "사전점검에 실패했습니다.");
    } finally {
      clearTimeout(timer);
      busyRef.current = false;
      setPending(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-label="신규 소싱 공간 사전점검">
      <h2 className="text-lg font-black text-slate-950">신규 소싱 공간 사전점검</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        입력한 조건에서 위치코드가 몇 개 필요한지 계산합니다. <strong>상품 수와 옵션 수를 구분</strong>하고,
        예약 버퍼와 아직 위치를 배정하지 않은 입고·발주 물량을 먼저 뺍니다. 정리 예정 공간은 현재 빈 공간으로 더하지 않습니다.
      </p>
      <form className="mt-4" onSubmit={(event) => { event.preventDefault(); void check(); }}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {fields.map((field) => (
            <label key={field.key} className="text-xs font-bold text-slate-700">
              {field.label}
              <input
                type="number" min={field.min} max={100_000} step={1} required
                name={field.key} value={values[field.key]} disabled={pending}
                onChange={(event) => {
                  setValues((previous) => ({ ...previous, [field.key]: event.target.value }));
                  setResult(null);
                  setError("");
                }}
                className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs leading-5 text-slate-500">
          선점 위치는 입고·발주 원장과 아직 자동 연결되지 않은 수동 가정입니다. 실제 미배정 물량이 없을 때만 0을 입력하세요.
          이미 사용 중 위치나 예약 버퍼로 차감된 물량은 중복 입력하지 마세요. 옵션당 필요 위치는 상품 크기·입고 수량을 고려해 입력합니다.
        </p>
        <button type="submit" disabled={!validInput || pending} className="mt-3 rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white disabled:opacity-40">
          {pending ? "최신 원장으로 점검 중…" : "공간 사전점검 · 실제 발주 없음"}
        </button>
      </form>
      {error ? <p role="alert" className="mt-3 text-sm font-bold text-rose-700">{error}</p> : null}
      {result ? (
        <div aria-live="polite" className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <h3 className="font-black text-slate-950">
            {result.decision === "BLOCKED" ? "공간 판단 보류 · 원장 확인 필요" : result.decision === "SPACE_ONLY_FITS" ? "입력한 조건에서 위치 수 충족 · 발주 승인 아님" : "입력한 조건에서 위치 수 부족"}
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-700">
            신규 옵션 {amount(result.requestedSkuCount)}개 · 필요 위치 {amount(result.requiredSlots)}개 · 가용 위치 {amount(result.availableSlots)}개 · 부족 위치 {amount(result.shortfallSlots)}개
          </p>
          <p className="mt-1 text-sm font-bold text-slate-800">동일 옵션 구성 기준 검토 가능한 상품 수: {amount(result.maxProductCountBySpace)}개</p>
          {result.reasons.map((reason) => <p key={reason} className="mt-1 text-xs leading-5 text-amber-800">{reasonLabels[reason] || "원장 상태를 확인해 주세요."}</p>)}
          <p className="mt-2 text-xs leading-5 text-slate-500">
            조회 시점의 위치코드 수만 비교한 모의계산입니다. 공간 예약·실제 발주·판매상태 변경은 하지 않습니다.
            실제 적재 크기, 예산, 수익성, 수요, 입고 일정 검증과 동시 작업에 대한 공간 예약은 별도입니다.
          </p>
        </div>
      ) : null}
    </section>
  );
}
