"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const money = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });

type Pattern = "GROWTH" | "STABLE_CORE" | "GENERAL" | "DECLINING" | "DORMANT";
type Decision = "ORDER" | "SMALL_REVIEW" | "INVENTORY_REVIEW" | "HOLD" | "DATA_HOLD";
type InventorySource = "EXACT_AFTER_STOCKOUT_RESET" | "ESTIMATED_BAND" | "UNKNOWN";
type AllocationRound = "URGENT_14_DAY" | "STABLE_CORE_30_DAY" | "GROWTH_30_DAY" | "FULL_44_DAY";

type CashEnvelopeRow = {
  barcode: string;
  modelNo: string | null;
  productName: string;
  pattern: Pattern;
  decision: Decision;
  priorityScore: number;
  forecast30Quantity: number;
  target44Quantity: number;
  observedRecent30Units: number;
  restoredRecent30Units: number;
  stockoutDemandRecovered: number;
  recent30StockoutDays: number;
  priceEffect: string;
  priceChangeRate: number | null;
  feedbackMultiplier: number;
  inventorySource: InventorySource;
  inventoryLowQuantity: number;
  inventoryHighQuantity: number;
  openCommitmentQuantity: number;
  recommendedQuantity: number;
  allocatedQuantity: number;
  minimumLineReview: boolean;
  unitCostKrw: number;
  expectedProductCostKrw: number;
  budgetReduced: boolean;
  allocations: Record<AllocationRound, number>;
  reasons: string[];
};

type CashEnvelopeReport = {
  generatedAt: string;
  state: "READY" | "BLOCKED";
  message: string;
  ruleVersion: string;
  calculationFingerprint: string;
  cycleMonth: string;
  budgetMonth: string;
  requestedCashKrw: number;
  maxGrossBudgetKrw: number;
  recorded1688SpendKrw: number;
  maxAdditionalGrossBudgetKrw: number;
  effectiveCashKrw: number;
  cashClamped: boolean;
  purchaseCostMultiplier: number;
  productOrderBudgetKrw: number;
  expectedProductSpendKrw: number;
  expectedAllInSpendKrw: number;
  remainingCashKrw: number;
  recommendedSkuCount: number;
  allocatedSkuCount: number;
  budgetReducedSkuCount: number;
  exactInventorySkuCount: number;
  inventoryReviewSkuCount: number;
  smallReviewSkuCount: number;
  feedbackObservationCount: number;
  patternCounts: Record<Pattern, number>;
  roundSpendKrw: Record<AllocationRound, number>;
  rows: CashEnvelopeRow[];
  blockers: string[];
};

function digits(value: string) {
  return value.replace(/[^0-9]/g, "").replace(/^0+(?=\d)/, "");
}

function monthLabel(value: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  return match ? `${Number(match[1])}년 ${Number(match[2])}월` : value;
}

function patternLabel(value: Pattern) {
  if (value === "GROWTH") return "성장형";
  if (value === "STABLE_CORE") return "핵심 안정형";
  if (value === "DECLINING") return "하락형";
  if (value === "DORMANT") return "휴면";
  return "일반형";
}

function decisionLabel(value: Decision) {
  if (value === "ORDER") return "발주 추천";
  if (value === "SMALL_REVIEW") return "소액 검토";
  if (value === "INVENTORY_REVIEW") return "재고 확인";
  if (value === "DATA_HOLD") return "데이터 보류";
  return "발주 보류";
}

function inventoryLabel(value: InventorySource) {
  if (value === "EXACT_AFTER_STOCKOUT_RESET") return "0 기준점 이후 정확재고";
  if (value === "ESTIMATED_BAND") return "추정재고 밴드";
  return "재고 미확정";
}

function shortFingerprint(value: string) {
  return value.replace(/^sha256:/, "").slice(0, 16);
}

export function InternalChinaCashEnvelopePanel({
  cycleMonth,
  currentCycleMonth,
  maxGrossBudgetKrw,
  recorded1688SpendKrw,
  monthlyClosed,
}: {
  cycleMonth: string;
  currentCycleMonth: string;
  maxGrossBudgetKrw: number;
  recorded1688SpendKrw: number;
  monthlyClosed: boolean;
}) {
  const currentMonth = cycleMonth === currentCycleMonth;
  const storageKey = `commerceOs.cashEnvelope.${cycleMonth}`;
  const [cashInput, setCashInput] = useState(() => {
    if (typeof window === "undefined" || !currentMonth) return "";
    try {
      return digits(window.localStorage.getItem(storageKey) ?? "");
    } catch {
      return "";
    }
  });
  const [report, setReport] = useState<CashEnvelopeReport | null>(null);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [finalizedFingerprint, setFinalizedFingerprint] = useState<string | null>(null);
  const maxAdditionalGrossBudgetKrw = Math.max(
    0,
    maxGrossBudgetKrw - recorded1688SpendKrw,
  );

  useEffect(() => {
    if (!currentMonth) return;
    try {
      if (cashInput) window.localStorage.setItem(storageKey, cashInput);
      else window.localStorage.removeItem(storageKey);
    } catch {
      // Local persistence is optional; the server-side calculation remains authoritative.
    }
  }, [cashInput, currentMonth, storageKey]);

  const parsedCash = Number(cashInput || 0);
  const inputOverLimit = parsedCash > maxAdditionalGrossBudgetKrw;
  const recommendations = useMemo(
    () => report?.rows.filter((row) => row.allocatedQuantity > 0) ?? [],
    [report],
  );

  const calculate = async () => {
    setNotice("");
    setReport(null);
    setFinalizedFingerprint(null);
    if (!currentMonth) {
      setNotice("과거 발주월은 현재 판매·재고 기준으로 다시 계산하지 않습니다.");
      return;
    }
    if (!Number.isFinite(parsedCash) || parsedCash <= 0) {
      setNotice("현재 추가 발주에 실제 투입 가능한 현금을 입력하세요.");
      return;
    }
    setLoading(true);
    try {
      const response = await fetch("/api/fast-purchase/cash-envelope", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ cashKrw: parsedCash }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        report?: CashEnvelopeReport;
      };
      if (payload.report) {
        setReport(payload.report);
        if (payload.report.state !== "READY") {
          setNotice(
            [payload.report.message, ...payload.report.blockers].filter(Boolean).join(" · "),
          );
        }
      } else if (!response.ok || !payload.ok) {
        setNotice(payload.message || "V2 발주권장안을 계산하지 못했습니다.");
      }
    } catch {
      setNotice("V2 발주권장안 계산 요청이 일시적으로 실패했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const finalize = async () => {
    if (!report || report.state !== "READY" || !recommendations.length) return;
    if (monthlyClosed) {
      setNotice("이미 마감된 발주월에는 새로운 예산확정 스냅샷을 만들지 않습니다.");
      return;
    }
    setFinalizing(true);
    setNotice("");
    try {
      const response = await fetch("/api/fast-purchase/finalized", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          finalizationId: `v2-${report.cycleMonth}-${shortFingerprint(report.calculationFingerprint)}`,
          cycleMonth: report.cycleMonth,
          budgetMonth: report.budgetMonth,
          generatedAt: report.generatedAt,
          requestedCashKrw: report.requestedCashKrw,
          effectiveCashKrw: report.effectiveCashKrw,
          productOrderBudgetKrw: report.productOrderBudgetKrw,
          expectedProductSpendKrw: report.expectedProductSpendKrw,
          expectedAllInSpendKrw: report.expectedAllInSpendKrw,
          remainingCashKrw: report.remainingCashKrw,
          calculationFingerprint: report.calculationFingerprint,
          ruleVersion: report.ruleVersion,
          rows: report.rows.map((row) => ({
            barcode: row.barcode,
            modelNo: row.modelNo,
            productName: row.productName,
            pattern: row.pattern,
            decision: row.decision,
            forecast30Quantity: row.forecast30Quantity,
            target44Quantity: row.target44Quantity,
            inventorySource: row.inventorySource,
            inventoryLowQuantity: row.inventoryLowQuantity,
            inventoryHighQuantity: row.inventoryHighQuantity,
            openCommitmentQuantity: row.openCommitmentQuantity,
            recommendedQuantity: row.recommendedQuantity,
            allocatedQuantity: row.allocatedQuantity,
            unitCostKrw: row.unitCostKrw,
            expectedProductCostKrw: row.expectedProductCostKrw,
            priceEffect: row.priceEffect,
            stockoutDemandRecovered: row.stockoutDemandRecovered,
            recent30StockoutDays: row.recent30StockoutDays,
            priorityScore: row.priorityScore,
          })),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || "예산확정 저장에 실패했습니다.");
      }
      setFinalizedFingerprint(report.calculationFingerprint);
      setNotice(payload.message || "예산과 발주권장안을 확정했습니다.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "예산확정 실패");
    } finally {
      setFinalizing(false);
    }
  };

  return (
    <section className="rounded-2xl border border-amber-300 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="text-xs font-black tracking-[0.12em] text-amber-700">
            CASH ENVELOPE · PURCHASE V2
          </span>
          <h2 className="mt-1 text-xl font-black text-slate-950">
            현금 제약 발주 V2
          </h2>
          <p className="mt-1 max-w-5xl text-sm leading-6 text-slate-600">
            품절로 못 판 수요, 가격변동, 성장형·핵심 안정형, 44일 목표수요, 추정재고 또는 0 기준점 이후 정확재고, 중국 미입고를 함께 계산합니다. MOQ와 박스입수는 수량 계산에서 제거했습니다.
          </p>
        </div>
        <span
          className={`rounded-full border px-3 py-1.5 text-xs font-black ${
            monthlyClosed
              ? "border-emerald-300 bg-emerald-50 text-emerald-800"
              : "border-amber-300 bg-amber-50 text-amber-900"
          }`}
        >
          {monthlyClosed ? "발주 마감 · 미리보기만" : "발주 열림 · 예산확정 가능"}
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Metric
          label="전체 지출가능금액"
          value={`${money.format(maxGrossBudgetKrw)}원`}
          note="에이블리 주문당 배송비 3,000원 차감 후 ÷ 2"
        />
        <Metric
          label="이미 기록된 1688 결제"
          value={`${money.format(recorded1688SpendKrw)}원`}
          note="상품 + 중국내운임 + 서비스비"
        />
        <Metric
          label="현재 추가 지출가능 상한"
          value={`${money.format(maxAdditionalGrossBudgetKrw)}원`}
          note="최종 배송대행 비용 확정 전 기준"
          emphasized
        />
      </div>

      <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4">
        <label className="block text-sm font-black text-amber-950">
          현재 추가 발주에 실제 투입 가능한 현금
        </label>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <input
              inputMode="numeric"
              value={cashInput ? money.format(Number(cashInput)) : ""}
              onChange={(event) => setCashInput(digits(event.target.value))}
              placeholder="예: 1,500,000"
              disabled={!currentMonth}
              className="w-full rounded-xl border border-amber-300 bg-white px-4 py-3 pr-12 text-right text-lg font-black text-slate-950 outline-none focus:border-amber-500 disabled:bg-slate-100 disabled:text-slate-400"
            />
            <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-500">
              원
            </span>
          </div>
          <button
            type="button"
            onClick={calculate}
            disabled={!currentMonth || loading || parsedCash <= 0}
            className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {loading ? "V2 계산 중..." : "V2 현금 기준 발주권장안 계산"}
          </button>
        </div>
        <p className="mt-2 text-xs leading-5 text-amber-900">
          {currentMonth
            ? inputOverLimit
              ? `입력액이 현재 추가 지출가능 상한 ${money.format(maxAdditionalGrossBudgetKrw)}원을 넘습니다. 계산 시 상한까지만 적용합니다.`
              : "계산만으로는 주문·결제되지 않습니다. 실제 주문하는 날 아래 예산확정을 눌러 스냅샷을 고정합니다."
            : `${monthLabel(cycleMonth)}은 과거 월이므로 현재 데이터로 재계산하지 않습니다.`}
        </p>
      </div>

      {notice ? (
        <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-bold leading-6 text-amber-950">
          {notice}
        </div>
      ) : null}

      {report?.state === "READY" ? (
        <div className="mt-4 space-y-4 rounded-2xl border border-blue-200 bg-blue-50 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <span className="text-xs font-black tracking-[0.12em] text-blue-700">
                PURCHASE V2 RESULT · {report.ruleVersion}
              </span>
              <h3 className="mt-1 text-lg font-black text-slate-950">
                44일 목표 · 다단계 현금배분 발주안
              </h3>
              <p className="mt-1 max-w-5xl text-xs leading-5 text-slate-600">{report.message}</p>
            </div>
            <span className="rounded-full border border-blue-300 bg-white px-3 py-1.5 text-xs font-black text-blue-800">
              실제 배정 {report.allocatedSkuCount} SKU
            </span>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            <ResultMetric label="적용 현금" value={`${money.format(report.effectiveCashKrw)}원`} />
            <ResultMetric label="상품대금 안전한도" value={`${money.format(report.productOrderBudgetKrw)}원`} />
            <ResultMetric label="예상 상품대금" value={`${money.format(report.expectedProductSpendKrw)}원`} />
            <ResultMetric label={`예상 총비용 · ×${report.purchaseCostMultiplier.toFixed(2)}`} value={`${money.format(report.expectedAllInSpendKrw)}원`} />
            <ResultMetric label="예상 잔여현금" value={`${money.format(report.remainingCashKrw)}원`} />
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
            <MiniMetric label="성장형" value={report.patternCounts.GROWTH} />
            <MiniMetric label="핵심 안정형" value={report.patternCounts.STABLE_CORE} />
            <MiniMetric label="정확재고" value={report.exactInventorySkuCount} />
            <MiniMetric label="재고확인 필요" value={report.inventoryReviewSkuCount} />
            <MiniMetric label="소액검토" value={report.smallReviewSkuCount} />
            <MiniMetric label="학습 관측" value={report.feedbackObservationCount} />
          </div>

          <div className="rounded-xl border border-blue-200 bg-white p-3 text-xs leading-5 text-slate-700">
            <strong className="text-slate-950">현금 배분 순서</strong>
            <span className="ml-2">14일 긴급 {money.format(report.roundSpendKrw.URGENT_14_DAY)}원</span>
            <span className="ml-3">안정형 30일 {money.format(report.roundSpendKrw.STABLE_CORE_30_DAY)}원</span>
            <span className="ml-3">성장형 30일 {money.format(report.roundSpendKrw.GROWTH_30_DAY)}원</span>
            <span className="ml-3">44일 완성 {money.format(report.roundSpendKrw.FULL_44_DAY)}원</span>
          </div>

          <div className="overflow-x-auto rounded-xl border border-blue-200 bg-white">
            <table className="min-w-[1450px] text-left text-xs">
              <thead className="bg-blue-50 font-bold text-slate-500">
                <tr>
                  <th className="px-3 py-3">우선</th>
                  <th className="px-3 py-3">B코드 / 상품</th>
                  <th className="px-3 py-3">유형</th>
                  <th className="px-3 py-3">재고근거</th>
                  <th className="px-3 py-3 text-right">30일예상</th>
                  <th className="px-3 py-3 text-right">44일목표</th>
                  <th className="px-3 py-3 text-right">재고범위</th>
                  <th className="px-3 py-3 text-right">미입고</th>
                  <th className="px-3 py-3 text-right">필요수량</th>
                  <th className="px-3 py-3 text-right">현금배정</th>
                  <th className="px-3 py-3 text-right">상품대금</th>
                  <th className="px-3 py-3">근거</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recommendations.slice(0, 80).map((row, index) => (
                  <tr key={row.barcode}>
                    <td className="px-3 py-3 font-black text-blue-700">{index + 1}</td>
                    <td className="px-3 py-3">
                      <strong className="font-mono text-slate-950">{row.barcode}</strong>
                      <span className="ml-2 text-slate-500">
                        {row.modelNo ? `${row.modelNo} · ` : ""}{row.productName}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <span className="rounded-full bg-slate-100 px-2 py-1 font-black text-slate-700">
                        {patternLabel(row.pattern)}
                      </span>
                      <span className="ml-2 font-bold text-blue-700">{decisionLabel(row.decision)}</span>
                    </td>
                    <td className="px-3 py-3 text-slate-600">{inventoryLabel(row.inventorySource)}</td>
                    <td className="px-3 py-3 text-right font-bold">{money.format(row.forecast30Quantity)}</td>
                    <td className="px-3 py-3 text-right font-bold">{money.format(row.target44Quantity)}</td>
                    <td className="px-3 py-3 text-right">{money.format(row.inventoryLowQuantity)}~{money.format(row.inventoryHighQuantity)}</td>
                    <td className="px-3 py-3 text-right">{money.format(row.openCommitmentQuantity)}</td>
                    <td className="px-3 py-3 text-right font-bold">{money.format(row.recommendedQuantity)}</td>
                    <td className="px-3 py-3 text-right text-base font-black text-blue-700">{money.format(row.allocatedQuantity)}</td>
                    <td className="px-3 py-3 text-right font-bold text-slate-950">{money.format(row.expectedProductCostKrw)}원</td>
                    <td className="max-w-md px-3 py-3 text-[11px] leading-5 text-slate-500">{row.reasons.slice(0, 2).join(" · ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {recommendations.length > 80 ? (
            <p className="text-xs text-slate-500">
              상위 80개만 표시했습니다. 전체 현금 배정 SKU는 {recommendations.length}개입니다.
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-300 bg-emerald-50 p-4">
            <div>
              <strong className="text-sm text-emerald-950">실제 주문하는 날 예산확정</strong>
              <p className="mt-1 text-xs leading-5 text-emerald-900">
                현재 계산 fingerprint {shortFingerprint(report.calculationFingerprint)}를 불변 스냅샷으로 저장합니다. 저장 후 월별 1688 주문·발주마감 화면에서 같은 권장안을 조회합니다.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/china-order-manager/stock-control"
                className="rounded-xl border border-emerald-300 bg-white px-4 py-2.5 text-sm font-black text-emerald-900"
              >
                품절 0 기준점 관리
              </Link>
              <button
                type="button"
                onClick={finalize}
                disabled={monthlyClosed || finalizing || Boolean(finalizedFingerprint)}
                className="rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-black text-white hover:bg-emerald-800 disabled:bg-slate-400"
              >
                {finalizing
                  ? "예산확정 저장 중..."
                  : finalizedFingerprint
                    ? "예산확정 완료"
                    : "이 예산·발주안 확정"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Metric({
  label,
  value,
  note,
  emphasized = false,
}: {
  label: string;
  value: string;
  note: string;
  emphasized?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        emphasized ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-slate-50"
      }`}
    >
      <span className="text-[11px] font-bold text-slate-500">{label}</span>
      <strong className="mt-1 block text-lg font-black text-slate-950">{value}</strong>
      <p className="mt-1 text-[11px] leading-5 text-slate-500">{note}</p>
    </div>
  );
}

function ResultMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-blue-200 bg-white p-3">
      <span className="text-[10px] font-bold text-slate-500">{label}</span>
      <strong className="mt-1 block text-base font-black text-slate-950">{value}</strong>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
      <span className="text-[10px] font-bold text-slate-500">{label}</span>
      <strong className="ml-2 text-sm font-black text-slate-950">{money.format(value)}</strong>
    </div>
  );
}
