"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { InternalChinaFundingCloseSummary } from "@/lib/internalChinaFundingClose";

const number = new Intl.NumberFormat("ko-KR");

export function InternalChinaFundingClosePanel({
  draftId,
  cycleMonth,
  totalSpendingBudgetKrw,
  actualForwarderCostKrw,
  stored,
}: {
  draftId: string;
  cycleMonth: string;
  totalSpendingBudgetKrw: number;
  actualForwarderCostKrw: number;
  stored: InternalChinaFundingCloseSummary | null;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const invalid = totalSpendingBudgetKrw <= 0 || actualForwarderCostKrw <= 0;

  async function save() {
    if (invalid) {
      setNotice("입고와 배송대행 실제 원가 마감을 먼저 완료하세요.");
      return;
    }
    if (
      !window.confirm(
        `이번 달 발주 사이클의 자금 단계까지 마감할까요?\n\n현재는 WorldFirst 송금액·USD/CNH 기말잔고·지갑별 잔액을 입력하지 않습니다. 확인된 배송대행 실제비용 ${number.format(actualForwarderCostKrw)}원과 월 마감 완료 상태만 기록합니다.`,
      )
    ) {
      return;
    }

    setSaving(true);
    setNotice("");
    try {
      const response = await fetch("/api/china-order-manager/funding-close", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({
          draftId,
          cycleMonth,
          simplified: true,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };
      if (!response.ok || body.ok !== true) {
        throw new Error(body.message || `월 자금 마감 실패 (${response.status})`);
      }
      setNotice(body.message || "월 자금 마감을 완료했습니다.");
      router.refresh();
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "월 자금 마감을 저장하지 못했습니다.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-black text-emerald-950">월 자금 마감</h3>
            {stored ? (
              <span className="rounded-full border border-emerald-300 bg-white px-2.5 py-1 text-[11px] font-black text-emerald-800">
                자금 마감 완료
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs leading-5 text-emerald-900">
            현재 운영에서는 WorldFirst 송금액, USD/CNH 기말잔고, 지갑별 배정·잔액 입력은 제외합니다. 입고와 실제 원가 마감이 끝났는지만 간단히 확인해 월 사이클을 닫습니다.
          </p>
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <FundingMetric
          label="전체 지출가능금액"
          value={`${number.format(totalSpendingBudgetKrw)}원`}
        />
        <FundingMetric
          label="확정 배송대행 실제비용"
          value={`${number.format(actualForwarderCostKrw)}원`}
          emphasized
        />
      </div>

      <p className="mt-3 rounded-lg bg-white px-3 py-2 text-[11px] font-bold leading-5 text-emerald-950">
        WorldFirst 관련 세부 원장은 지금 단계에서는 수집·계산하지 않습니다. 나중에 필요성이 확인되면 별도 자금관리 기능으로 분리해 다시 붙일 수 있습니다.
      </p>

      {!stored ? (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            disabled={saving || invalid}
            onClick={() => void save()}
            className="rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? "월 마감 처리 중…" : "월 자금 마감"}
          </button>
        </div>
      ) : null}

      {notice ? (
        <p className="mt-3 rounded-lg bg-white px-3 py-2 text-xs leading-5 text-slate-700">
          {notice}
        </p>
      ) : null}
    </div>
  );
}

function FundingMetric({
  label,
  value,
  emphasized = false,
}: {
  label: string;
  value: string;
  emphasized?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border bg-white p-3 ${
        emphasized ? "border-emerald-400" : "border-emerald-200"
      }`}
    >
      <span className="block text-[11px] font-bold text-slate-500">{label}</span>
      <strong
        className={`mt-1 block text-right text-sm font-black ${
          emphasized ? "text-emerald-800" : "text-slate-950"
        }`}
      >
        {value}
      </strong>
    </div>
  );
}
