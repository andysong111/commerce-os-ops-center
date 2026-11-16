"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const number = new Intl.NumberFormat("ko-KR");

function monthLabel(month: string) {
  const matched = month.match(/^(\d{4})-(\d{2})$/);
  return matched ? `${Number(matched[1])}년 ${Number(matched[2])}월` : month;
}

function won(value: unknown) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, parsed);
}

export function InternalChinaForwarderCostFallback({
  draftId,
  cycleMonth,
  warning,
}: {
  draftId: string;
  cycleMonth: string;
  warning: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const actualCostKrw = won(value);

  async function save() {
    if (actualCostKrw <= 0) {
      setNotice("배송대행지에서 실제 청구된 총비용을 원 단위로 입력하세요.");
      return;
    }
    if (
      !window.confirm(
        `${monthLabel(cycleMonth)} 배송대행지 실제비용 ${number.format(actualCostKrw)}원을 반영해 실제 한국 도착 원가배수를 확정할까요?\n\n결제원가 = (상품대금 + 중국내운임·할인/가감) × 1.05\n실제 도착 원가배수 = (결제원가 + 배송대행지 실제비용) ÷ 결제원가\n최종 SKU 매입원가 = SKU별 결제원가 × 실제 도착 원가배수\n\n이 확정원가는 이후 가격조정 판단에 사용됩니다.`,
      )
    ) {
      return;
    }

    setSaving(true);
    setNotice("");
    try {
      const response = await fetch("/api/china-order-manager/forwarder-cost", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ draftId, cycleMonth, actualCostKrw }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };
      if (!response.ok || body.ok !== true) {
        throw new Error(body.message || `배송대행 비용 마감 실패 (${response.status})`);
      }
      setNotice(body.message || "배송대행 비용과 실제 원가배수를 마감했습니다.");
      router.refresh();
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "배송대행 비용을 마감하지 못했습니다.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-black text-emerald-800">
              {monthLabel(cycleMonth)} 사이클
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">
              입고 완료 · 실제 원가 미마감
            </span>
          </div>
          <h2 className="mt-3 text-lg font-black text-slate-950">
            배송대행지 비용 · 실제 원가 마감
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            관세·부가세·바코드 스티커 작업 등을 포함한 배송대행지 최종 청구액을 입력하면 결제수수료 1.05는 유지하고, 임시 한국 도착 내부기준원가 1.50을 실제 원가배수로 교체합니다.
          </p>
          <p className="mt-1 font-mono text-[11px] text-slate-400">{draftId}</p>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900">
        실시간 비용 요약만 일시 지연 중입니다. 실제 발주·입고 원장은 변경되지 않았습니다. {warning}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <div>
          <label
            htmlFor={`forwarder-cost-fallback-${draftId}`}
            className="block text-xs font-bold text-slate-600"
          >
            배송대행지 실제비용(원)
          </label>
          <input
            id={`forwarder-cost-fallback-${draftId}`}
            type="number"
            min={1}
            max={1_000_000_000}
            step={1}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="예: 907820"
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-right font-black outline-none focus:border-blue-500"
          />
          <span className="mt-1 block text-[11px] text-slate-500">
            상품대금과 중국내운임·할인/가감에 결제수수료 1.05를 적용한 뒤 실제 배송대행비를 배분합니다.
          </span>
        </div>
        <button
          type="button"
          disabled={saving || actualCostKrw <= 0}
          onClick={() => void save()}
          className="rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "마감 중..." : "배송대행 비용 · 원가 마감"}
        </button>
      </div>

      {notice ? (
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
