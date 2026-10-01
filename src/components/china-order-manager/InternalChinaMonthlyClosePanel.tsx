"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { InternalChinaMonthlyPurchaseCloseSummary } from "@/lib/internalChinaMonthlyPurchaseClose";

const number = new Intl.NumberFormat("ko-KR");

const REASONS = [
  { value: "CASHFLOW_LIMIT", label: "현금흐름 한도로 조기 마감" },
  { value: "NO_MORE_URGENT_ITEMS", label: "긴급 발주품 소진 후 마감" },
  { value: "OPERATOR_DECISION", label: "운영자 판단으로 마감" },
  { value: "OTHER", label: "기타" },
] as const;

type Reason = (typeof REASONS)[number]["value"];

function monthLabel(month: string) {
  const matched = month.match(/^(\d{4})-(\d{2})$/);
  return matched ? `${Number(matched[1])}년 ${Number(matched[2])}월` : month;
}

export function InternalChinaMonthlyClosePanel({
  cycleMonth,
  currentCycleMonth,
  totalSpendingBudgetKrw,
  recorded1688SpendKrw,
  releasableLineCount,
  releasableQuantity,
  stored,
}: {
  cycleMonth: string;
  currentCycleMonth: string;
  totalSpendingBudgetKrw: number;
  recorded1688SpendKrw: number;
  releasableLineCount: number;
  releasableQuantity: number;
  stored: InternalChinaMonthlyPurchaseCloseSummary | null;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reason, setReason] = useState<Reason>("CASHFLOW_LIMIT");
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState("");
  const unusedBudgetKrw = Math.max(
    0,
    totalSpendingBudgetKrw - recorded1688SpendKrw,
  );

  async function closeMonth() {
    const reasonLabel =
      REASONS.find((entry) => entry.value === reason)?.label ?? "운영자 판단";
    const releaseText = releasableLineCount
      ? `\n미주문 Draft ${number.format(releasableLineCount)}개 줄 · ${number.format(releasableQuantity)}개 약정은 해제됩니다.`
      : "";
    if (
      !window.confirm(
        `${monthLabel(cycleMonth)} 발주 사이클을 마감할까요?\n\n마감 사유: ${reasonLabel}\n전체 지출가능금액: ${number.format(totalSpendingBudgetKrw)}원\n현재 기록된 1688 결제액: ${number.format(recorded1688SpendKrw)}원\n배송대행·통관 최종비용 반영 전 남은 한도: ${number.format(unusedBudgetKrw)}원${releaseText}\n\n이 버튼은 추가 발주만 종료합니다. 이미 주문한 품목의 입고, 배송대행 실제비용, 실제 원가, 월 자금 마감은 계속 진행됩니다.`,
      )
    ) {
      return;
    }

    setSaving(true);
    setNotice("");
    try {
      const response = await fetch("/api/china-order-manager/monthly-close", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({
          cycleMonth,
          closeReasonCode: reason,
          note,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };
      if (!response.ok || body.ok !== true) {
        throw new Error(body.message || `월 발주 마감 실패 (${response.status})`);
      }
      setNotice(body.message || "월 발주 사이클을 마감했습니다.");
      setExpanded(false);
      router.refresh();
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "월 발주 사이클을 마감하지 못했습니다.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (stored) {
    return (
      <section className="rounded-2xl border border-emerald-300 bg-emerald-50 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-emerald-300 bg-white px-2.5 py-1 text-xs font-black text-emerald-800">
                발주 사이클 마감 완료
              </span>
              <span className="text-xs font-bold text-emerald-800">
                입고·실제 원가 작업은 계속
              </span>
            </div>
            <h3 className="mt-3 text-base font-black text-slate-950">
              {monthLabel(stored.cycleMonth)} 추가 발주 종료
            </h3>
            <p className="mt-1 text-sm leading-6 text-slate-700">
              {stored.closeReason}
            </p>
          </div>
          <span className="text-xs font-semibold text-slate-500">
            {new Date(stored.closedAt).toLocaleString("ko-KR", {
              timeZone: "Asia/Seoul",
            })}
          </span>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <Metric
            label="전체 지출가능금액"
            value={`${number.format(stored.totalSpendingBudgetKrw)}원`}
          />
          <Metric
            label="마감 시 1688 기록액"
            value={`${number.format(stored.recorded1688SpendKrw)}원`}
          />
          <Metric
            label="최종비용 반영 전 미사용 한도"
            value={`${number.format(stored.unusedBudgetBeforeFinalCostsKrw)}원`}
            emphasized
          />
        </div>
        {stored.releasedUnorderedLineCount > 0 ? (
          <p className="mt-3 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs leading-5 text-emerald-900">
            미주문 Draft {number.format(stored.releasedUnorderedLineCount)}개 줄 · {number.format(stored.releasedUnorderedQuantity)}개 약정을 해제했습니다. 이미 주문된 미입고 수량은 그대로 유지됩니다.
          </p>
        ) : null}
      </section>
    );
  }

  if (cycleMonth !== currentCycleMonth) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
        과거 월은 이 화면에서 새로 마감하지 않습니다. 현재 월을 선택하면 남은 예산을 사용하지 않고 발주 사이클을 종료할 수 있습니다.
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-amber-300 bg-amber-50 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-amber-200 px-2.5 py-1 text-xs font-black text-amber-950">
              운영자 직접 결정
            </span>
            <span className="text-xs font-bold text-amber-900">
              예산을 전액 쓰지 않아도 가능
            </span>
          </div>
          <h3 className="mt-3 text-base font-black text-slate-950">
            이번 달 추가 발주를 여기서 끝낼 수 있습니다
          </h3>
          <p className="mt-1 max-w-4xl text-sm leading-6 text-slate-700">
            현금흐름이 부족하면 남은 예산을 억지로 소진하지 않습니다. 발주 사이클만 닫고, 이미 주문한 품목의 입고·배송대행 실제비용·월 자금 마감은 별도 단계로 계속 진행합니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-black text-white hover:bg-amber-700"
        >
          {expanded ? "마감 입력 닫기" : "남은 예산 미사용 · 발주 마감"}
        </button>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <Metric
          label="전체 지출가능금액"
          value={`${number.format(totalSpendingBudgetKrw)}원`}
        />
        <Metric
          label="현재 기록된 1688 결제액"
          value={`${number.format(recorded1688SpendKrw)}원`}
        />
        <Metric
          label="최종비용 반영 전 남은 한도"
          value={`${number.format(unusedBudgetKrw)}원`}
          emphasized
        />
      </div>

      {expanded ? (
        <div className="mt-4 rounded-xl border border-amber-300 bg-white p-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(240px,0.7fr)_minmax(320px,1.3fr)]">
            <label>
              <span className="block text-xs font-black text-slate-700">
                직접 입력 · 마감 사유
              </span>
              <select
                value={reason}
                onChange={(event) => setReason(event.target.value as Reason)}
                className="mt-2 w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm font-bold outline-none focus:border-amber-500"
              >
                {REASONS.map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="block text-xs font-black text-slate-700">
                직접 입력 · 메모(선택)
              </span>
              <input
                type="text"
                value={note}
                maxLength={500}
                onChange={(event) => setNote(event.target.value)}
                placeholder="예: 9월 정산 지연으로 긴급 품목만 주문 후 종료"
                className="mt-2 w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm font-semibold outline-none focus:border-amber-500"
              />
            </label>
          </div>

          {releasableLineCount > 0 ? (
            <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold leading-5 text-rose-900">
              마감 시 아직 실주문되지 않은 Draft {number.format(releasableLineCount)}개 줄 · {number.format(releasableQuantity)}개 약정은 자동 해제됩니다. 주문·입고가 이미 시작된 수량은 취소하지 않습니다.
            </p>
          ) : null}

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              disabled={saving || totalSpendingBudgetKrw <= 0}
              onClick={() => void closeMonth()}
              className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? "발주 사이클 마감 중…" : "확인 후 이번 달 발주 마감"}
            </button>
          </div>
        </div>
      ) : null}

      {notice ? (
        <p className="mt-3 rounded-lg bg-white px-3 py-2 text-xs font-semibold leading-5 text-slate-700">
          {notice}
        </p>
      ) : null}
    </section>
  );
}

function Metric({
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
      className={`rounded-xl border bg-white p-3 ${
        emphasized ? "border-amber-400" : "border-amber-200"
      }`}
    >
      <span className="block text-[11px] font-bold text-slate-500">{label}</span>
      <strong
        className={`mt-1 block text-right text-base font-black ${
          emphasized ? "text-amber-800" : "text-slate-950"
        }`}
      >
        {value}
      </strong>
    </div>
  );
}
