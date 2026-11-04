"use client";

import {
  useDeferredValue,
  useMemo,
  useState,
  useTransition,
} from "react";
import {
  simulatePurchaseStrategies,
  type PurchaseStrategyLabAllocation,
  type PurchaseStrategyLabRow,
  type PurchaseStrategyLabScenario,
  type PurchaseStrategyLabScenarioId,
} from "@/lib/purchaseStrategyLab";

type Props = {
  rows: PurchaseStrategyLabRow[];
  defaultBudgetKrw: number;
  generatedAt: string;
  sourceAsOf: string | null;
  sourceState: string;
  dataMode: "LIVE" | "SAMPLE";
};

const SCENARIO_STYLES: Record<PurchaseStrategyLabScenarioId, string> = {
  CURRENT: "border-slate-300 bg-white",
  RECENT_PROTECTED: "border-blue-300 bg-blue-50",
  BALANCED_LOW_COST: "border-emerald-300 bg-emerald-50",
};

function integer(value: number) {
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(
    Math.round(value),
  );
}

function won(value: number) {
  return `${integer(value)}원`;
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function inputNumber(value: string, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

function allocationMap(scenario: PurchaseStrategyLabScenario) {
  return new Map(
    scenario.allocations.map((allocation) => [allocation.barcode, allocation]),
  );
}

function allocationQuantity(
  map: Map<string, PurchaseStrategyLabAllocation>,
  barcode: string,
) {
  return map.get(barcode)?.allocatedQuantity ?? 0;
}

function scenarioById(
  scenarios: PurchaseStrategyLabScenario[],
  id: PurchaseStrategyLabScenarioId,
) {
  const scenario = scenarios.find((candidate) => candidate.id === id) ?? scenarios[0];
  if (!scenario) {
    throw new Error("전략 시나리오를 생성하지 못했습니다.");
  }
  return scenario;
}

function ScenarioCard({
  scenario,
  selected,
  pending,
  onSelect,
}: {
  scenario: PurchaseStrategyLabScenario;
  selected: boolean;
  pending: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={pending}
      onClick={onSelect}
      className={`rounded-2xl border p-5 text-left transition ${SCENARIO_STYLES[scenario.id]} ${
        selected ? "ring-2 ring-slate-950 ring-offset-2" : "hover:-translate-y-0.5"
      }`}
    >
      <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">
        {scenario.id === "CURRENT" ? "기준선" : "실험 전략"}
      </p>
      <h2 className="mt-2 text-lg font-black text-slate-950">
        {scenario.label}
      </h2>
      <p className="mt-2 min-h-12 text-sm leading-6 text-slate-600">
        {scenario.description}
      </p>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-slate-500">선정 SKU</dt>
          <dd className="font-black text-slate-950">
            {integer(scenario.selectedSkuCount)}개
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">예상 상품대금</dt>
          <dd className="font-black text-slate-950">
            {won(scenario.estimatedSpendKrw)}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">최근신호 보호</dt>
          <dd className="font-black text-slate-950">
            {integer(scenario.recentSignalSkuCount)}개
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">잔여 예산</dt>
          <dd className="font-black text-slate-950">
            {won(scenario.remainingBudgetKrw)}
          </dd>
        </div>
      </dl>
    </button>
  );
}

export function PurchaseStrategyLabClient({
  rows,
  defaultBudgetKrw,
  generatedAt,
  sourceAsOf,
  sourceState,
  dataMode,
}: Props) {
  const [budgetKrw, setBudgetKrw] = useState(defaultBudgetKrw);
  const [recentMinimumPercent, setRecentMinimumPercent] = useState(35);
  const [stockoutMinimumPercent, setStockoutMinimumPercent] = useState(50);
  const [cheapUnitCostThresholdKrw, setCheapUnitCostThresholdKrw] =
    useState(2_000);
  const [cheapMinimumQuantity, setCheapMinimumQuantity] = useState(20);
  const [optionFamilyMinimumQuantity, setOptionFamilyMinimumQuantity] =
    useState(10);
  const [selectedScenarioId, setSelectedScenarioId] =
    useState<PurchaseStrategyLabScenarioId>("BALANCED_LOW_COST");
  const [search, setSearch] = useState("");
  const [isPending, startTransition] = useTransition();
  const deferredSearch = useDeferredValue(search.trim().toLocaleLowerCase("ko"));

  const scenarios = useMemo(
    () =>
      simulatePurchaseStrategies(rows, {
        budgetKrw,
        recentMinimumRatio: recentMinimumPercent / 100,
        stockoutMinimumRatio: stockoutMinimumPercent / 100,
        cheapUnitCostThresholdKrw,
        cheapMinimumQuantity,
        optionFamilyMinimumQuantity,
      }),
    [
      budgetKrw,
      cheapMinimumQuantity,
      cheapUnitCostThresholdKrw,
      optionFamilyMinimumQuantity,
      recentMinimumPercent,
      rows,
      stockoutMinimumPercent,
    ],
  );
  const currentScenario = scenarioById(scenarios, "CURRENT");
  const recentScenario = scenarioById(scenarios, "RECENT_PROTECTED");
  const balancedScenario = scenarioById(scenarios, "BALANCED_LOW_COST");
  const selectedScenario = scenarioById(scenarios, selectedScenarioId);
  const currentAllocations = useMemo(
    () => allocationMap(currentScenario),
    [currentScenario],
  );
  const recentAllocations = useMemo(
    () => allocationMap(recentScenario),
    [recentScenario],
  );
  const balancedAllocations = useMemo(
    () => allocationMap(balancedScenario),
    [balancedScenario],
  );
  const scenarioAllocationMaps = useMemo(
    () => [currentAllocations, recentAllocations, balancedAllocations],
    [balancedAllocations, currentAllocations, recentAllocations],
  );
  const selectedAllocations = useMemo(
    () => allocationMap(selectedScenario),
    [selectedScenario],
  );

  const backStretcher = rows.find((row) => row.barcode === "BAF1-1") ?? null;
  const rabbitAnchor =
    rows.find((row) => row.barcode === "BBA3-3") ??
    rows.find((row) => row.name.includes("토끼브로치")) ??
    null;
  const rabbitRows = useMemo(() => {
    if (!rabbitAnchor) return [];
    return rows
      .filter(
        (row) =>
          (rabbitAnchor.modelNo && row.modelNo === rabbitAnchor.modelNo) ||
          row.name.includes("토끼브로치"),
      )
      .sort((left, right) => left.barcode.localeCompare(right.barcode));
  }, [rabbitAnchor, rows]);

  const visibleRows = useMemo(() => {
    const relevant = rows.filter((row) => {
      const hasAllocation = scenarioAllocationMaps.some(
        (allocations) => allocationQuantity(allocations, row.barcode) > 0,
      );
      const isFocus =
        row.barcode === "BAF1-1" ||
        row.name.includes("토끼브로치") ||
        (rabbitAnchor?.modelNo && row.modelNo === rabbitAnchor.modelNo);
      if (!hasAllocation && !isFocus) return false;
      if (!deferredSearch) return true;
      return [row.barcode, row.name, row.modelNo ?? ""]
        .join(" ")
        .toLocaleLowerCase("ko")
        .includes(deferredSearch);
    });
    return relevant
      .sort(
        (left, right) =>
          allocationQuantity(selectedAllocations, right.barcode) -
            allocationQuantity(selectedAllocations, left.barcode) ||
          right.averageMonthlyRevenueKrw - left.averageMonthlyRevenueKrw ||
          left.barcode.localeCompare(right.barcode),
      )
      .slice(0, 200);
  }, [
    deferredSearch,
    rabbitAnchor,
    rows,
    scenarioAllocationMaps,
    selectedAllocations,
  ]);

  const currentRabbitColors = rabbitRows.filter(
    (row) => allocationQuantity(currentAllocations, row.barcode) > 0,
  ).length;
  const balancedRabbitColors = rabbitRows.filter(
    (row) => allocationQuantity(balancedAllocations, row.barcode) > 0,
  ).length;

  return (
    <>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-blue-600">
              INPUT → CLIENT CALCULATION → COMPARISON
            </p>
            <h2 className="mt-1 text-xl font-black text-slate-950">
              전략 조건
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              기준일 {sourceAsOf ?? "최신"} · 스냅샷 {generatedAt} · 상태 {sourceState}
            </p>
          </div>
          <p
            className={`rounded-full px-3 py-1 text-xs font-black ${
              dataMode === "SAMPLE"
                ? "bg-amber-100 text-amber-900"
                : "bg-emerald-100 text-emerald-800"
            }`}
          >
            {dataMode === "SAMPLE" ? "샘플 데이터" : "실제 읽기 전용"} · 저장 API 0회 · 운영 Draft 변경 0회
          </p>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <label className="text-sm font-bold text-slate-700">
            총 상품대금 예산(원)
            <input
              type="number"
              min={0}
              step={10_000}
              value={budgetKrw}
              onChange={(event) =>
                setBudgetKrw(inputNumber(event.currentTarget.value))
              }
              className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5"
            />
          </label>
          <label className="text-sm font-bold text-slate-700">
            최근매출 신호 보호 비율(%)
            <input
              type="number"
              min={0}
              max={100}
              value={recentMinimumPercent}
              onChange={(event) =>
                setRecentMinimumPercent(
                  Math.min(100, inputNumber(event.currentTarget.value)),
                )
              }
              className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5"
            />
          </label>
          <label className="text-sm font-bold text-slate-700">
            품절회복 신호 보호 비율(%)
            <input
              type="number"
              min={0}
              max={100}
              value={stockoutMinimumPercent}
              onChange={(event) =>
                setStockoutMinimumPercent(
                  Math.min(100, inputNumber(event.currentTarget.value)),
                )
              }
              className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5"
            />
          </label>
          <label className="text-sm font-bold text-slate-700">
            저가 판정 단가(원 이하)
            <input
              type="number"
              min={0}
              step={100}
              value={cheapUnitCostThresholdKrw}
              onChange={(event) =>
                setCheapUnitCostThresholdKrw(
                  inputNumber(event.currentTarget.value),
                )
              }
              className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5"
            />
          </label>
          <label className="text-sm font-bold text-slate-700">
            저가 상품 최소수량
            <input
              type="number"
              min={0}
              step={5}
              value={cheapMinimumQuantity}
              onChange={(event) =>
                setCheapMinimumQuantity(
                  inputNumber(event.currentTarget.value),
                )
              }
              className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5"
            />
          </label>
          <label className="text-sm font-bold text-slate-700">
            같은 모델 색상별 최소수량
            <input
              type="number"
              min={0}
              step={5}
              value={optionFamilyMinimumQuantity}
              onChange={(event) =>
                setOptionFamilyMinimumQuantity(
                  inputNumber(event.currentTarget.value),
                )
              }
              className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5"
            />
          </label>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-3" aria-label="전략 선택">
        {scenarios.map((scenario) => (
          <ScenarioCard
            key={scenario.id}
            scenario={scenario}
            selected={selectedScenarioId === scenario.id}
            pending={isPending}
            onSelect={() =>
              startTransition(() => setSelectedScenarioId(scenario.id))
            }
          />
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <article className="rounded-2xl border border-amber-300 bg-amber-50 p-5">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-amber-700">
            실제 실패 사례 1
          </p>
          <h2 className="mt-2 text-xl font-black text-slate-950">
            BAF1-1 · 허리펴는 등스트레칭기구
          </h2>
          {backStretcher ? (
            <>
              <p className="mt-2 text-sm leading-6 text-slate-700">
                시스템 권장 {integer(backStretcher.recommendedQuantity)}개를 현재 순차배분이 {integer(allocationQuantity(currentAllocations, backStretcher.barcode))}개로 축소합니다.
              </p>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center text-sm">
                <div className="rounded-xl bg-white p-3">
                  <p className="text-slate-500">현재</p>
                  <strong>{integer(allocationQuantity(currentAllocations, backStretcher.barcode))}개</strong>
                </div>
                <div className="rounded-xl bg-blue-100 p-3">
                  <p className="text-slate-500">최근보호</p>
                  <strong>{integer(allocationQuantity(recentAllocations, backStretcher.barcode))}개</strong>
                </div>
                <div className="rounded-xl bg-emerald-100 p-3">
                  <p className="text-slate-500">균형·저가</p>
                  <strong>{integer(allocationQuantity(balancedAllocations, backStretcher.barcode))}개</strong>
                </div>
              </div>
            </>
          ) : (
            <p className="mt-2 text-sm text-rose-700">
              현재 스냅샷에서 BAF1-1을 찾지 못했습니다. 데이터 연결을 먼저 점검해야 합니다.
            </p>
          )}
        </article>

        <article className="rounded-2xl border border-fuchsia-300 bg-fuchsia-50 p-5">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-fuchsia-700">
            실제 실패 사례 2
          </p>
          <h2 className="mt-2 text-xl font-black text-slate-950">
            토끼브로치 색상군
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-700">
            확인된 {integer(rabbitRows.length)}개 옵션 중 현재 방식은 {integer(currentRabbitColors)}개, 색상균형 전략은 {integer(balancedRabbitColors)}개를 포함합니다.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {rabbitRows.map((row) => {
              const currentQuantity = allocationQuantity(
                currentAllocations,
                row.barcode,
              );
              const balancedQuantity = allocationQuantity(
                balancedAllocations,
                row.barcode,
              );
              return (
                <span
                  key={row.barcode}
                  className="rounded-full border border-fuchsia-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700"
                >
                  {row.barcode} {currentQuantity}→{balancedQuantity}개
                </span>
              );
            })}
          </div>
        </article>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 p-5">
          <div>
            <h2 className="text-xl font-black text-slate-950">
              {selectedScenario.label} 결과
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              예산 사용률 {percent(budgetKrw > 0 ? selectedScenario.estimatedSpendKrw / budgetKrw : 0)} · 검토 필요 {integer(selectedScenario.reviewRequiredSkuCount)}개
            </p>
          </div>
          <label className="w-full max-w-sm text-sm font-bold text-slate-700">
            결과 검색
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
              placeholder="B코드 · 모델번호 · 상품명"
              className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5"
            />
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-black uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">상품</th>
                <th className="px-4 py-3">상태·최근신호</th>
                <th className="px-4 py-3 text-right">권장</th>
                <th className="px-4 py-3 text-right">현재</th>
                <th className="px-4 py-3 text-right">최근보호</th>
                <th className="px-4 py-3 text-right">색상·저가</th>
                <th className="px-4 py-3">선택 전략 근거</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleRows.map((row) => {
                const selected = selectedAllocations.get(row.barcode);
                return (
                  <tr
                    key={row.barcode}
                    className="[content-visibility:auto] [contain-intrinsic-size:72px]"
                  >
                    <td className="px-4 py-3">
                      <strong className="block text-slate-950">{row.barcode}</strong>
                      <span className="block max-w-xs text-slate-600">{row.name}</span>
                      <span className="text-xs text-slate-400">{row.modelNo ?? "모델 없음"}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="block font-bold text-slate-700">{row.purchaseStatus}</span>
                      <span className="block max-w-xs text-xs text-slate-500">
                        {row.entrySignals.join(" · ") || "최근신호 없음"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-bold">{integer(row.recommendedQuantity)}</td>
                    <td className="px-4 py-3 text-right">{integer(allocationQuantity(currentAllocations, row.barcode))}</td>
                    <td className="px-4 py-3 text-right">{integer(allocationQuantity(recentAllocations, row.barcode))}</td>
                    <td className="px-4 py-3 text-right">{integer(allocationQuantity(balancedAllocations, row.barcode))}</td>
                    <td className="max-w-sm px-4 py-3 text-xs leading-5 text-slate-600">
                      {selected?.reasons.join(" · ") || "선정되지 않음"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {visibleRows.length === 0 ? (
          <p className="p-6 text-center text-sm text-slate-500">
            검색 조건에 맞는 비교 대상이 없습니다.
          </p>
        ) : null}
      </section>
    </>
  );
}
