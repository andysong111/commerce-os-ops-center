"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  buildPurchaseCycleRoughStockBatchId,
  buildPurchaseCycleRoughStockEstimateItems,
  type PurchaseCycleRoughStockBand,
  type PurchaseCycleRoughStockTarget,
} from "@/lib/purchaseCyclePreflightInlineResolution";

const BAND_OPTIONS: Array<{
  value: PurchaseCycleRoughStockBand;
  label: string;
}> = [
  { value: "HIGH", label: "많음" },
  { value: "NORMAL", label: "보통" },
  { value: "LOW", label: "적음" },
  { value: "OUT", label: "품절" },
];

type InlineRoughStockCorrectionProps = {
  targets: PurchaseCycleRoughStockTarget[];
  resolutionScope: string;
};

export function InlineRoughStockCorrection({
  targets,
  resolutionScope,
}: InlineRoughStockCorrectionProps) {
  const router = useRouter();
  const normalizedTargets = useMemo(
    () => targets.map((target) => ({
      ...target,
      barcode: target.barcode.trim().toUpperCase(),
    })),
    [targets],
  );
  const [selections, setSelections] = useState<Record<string, PurchaseCycleRoughStockBand>>({});
  const [saving, setSaving] = useState(false);
  const [refreshPending, startRefreshTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const pending = saving || refreshPending;

  const selectedCount = normalizedTargets.filter(
    (target) => Boolean(selections[target.barcode]),
  ).length;

  const saveAndRecalculate = async () => {
    setError(null);
    let stockEstimateItems;
    try {
      stockEstimateItems = buildPurchaseCycleRoughStockEstimateItems(
        normalizedTargets,
        selections,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "대략재고를 확인해 주세요.");
      return;
    }

    setSaving(true);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const batchId = buildPurchaseCycleRoughStockBatchId(
        resolutionScope,
        stockEstimateItems,
      );
      const response = await fetch("/api/inventory-stock-control/unified-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batchId,
          stockoutBarcodes: [],
          onSaleBarcodes: [],
          stocktakeItems: [],
          stockEstimateItems,
        }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null) as {
        message?: string;
        savedCount?: number;
        counts?: { stockEstimate?: number };
      } | null;
      if (!response.ok) {
        throw new Error(payload?.message || "대략재고를 저장하지 못했습니다.");
      }
      if (
        payload?.savedCount !== stockEstimateItems.length ||
        payload.counts?.stockEstimate !== stockEstimateItems.length
      ) {
        throw new Error("대략재고가 모두 저장됐는지 확인하지 못했습니다. 다시 시도해 주세요.");
      }
      setSaving(false);
      startRefreshTransition(() => router.refresh());
    } catch (caught) {
      const message = caught instanceof DOMException && caught.name === "AbortError"
        ? "저장 응답이 지연되고 있습니다. 잠시 후 다시 눌러 주세요."
        : caught instanceof Error
          ? caught.message
          : "대략재고를 저장하지 못했습니다.";
      setError(message);
      setSaving(false);
    } finally {
      window.clearTimeout(timeout);
    }
  };

  return (
    <div className="mt-4 rounded-xl border border-amber-200 bg-white p-4">
      <p className="text-sm font-black text-slate-950">이 화면에서 대략재고를 바로 확인하세요</p>
      <p className="mt-1 text-xs leading-5 text-slate-600">
        발주계산용 대략재고만 저장합니다. 샵플링의 품절·판매중 상태와 실제 재고수량은 바꾸지 않습니다.
      </p>
      <div className="mt-3 grid gap-3">
        {normalizedTargets.map((target) => (
          <fieldset key={target.barcode} className="rounded-lg border border-slate-200 p-3">
            <legend className="px-1 text-sm font-black text-slate-950">
              {target.barcode} · {target.productName}
            </legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {BAND_OPTIONS.map((option) => {
                const selected = selections[target.barcode] === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={selected}
                    disabled={pending}
                    onClick={() => setSelections((current) => ({
                      ...current,
                      [target.barcode]: option.value,
                    }))}
                    className={`rounded-lg border px-3 py-2 text-xs font-black transition ${selected
                      ? "border-amber-500 bg-amber-500 text-white"
                      : "border-slate-200 bg-white text-slate-700 hover:border-amber-300"}`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>
      {error ? <p role="alert" className="mt-3 text-xs font-bold text-rose-700">{error}</p> : null}
      <button
        type="button"
        aria-busy={pending}
        disabled={pending || selectedCount !== normalizedTargets.length}
        onClick={saveAndRecalculate}
        className="mt-4 w-full rounded-xl bg-slate-950 px-4 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {pending
          ? "저장 후 같은 발주차시 재계산 중..."
          : `${selectedCount}/${normalizedTargets.length}종 저장하고 같은 차시 다시 계산`}
      </button>
    </div>
  );
}
