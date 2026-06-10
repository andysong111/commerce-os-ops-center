"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import {
  calculateChinaOrders,
  createEmptyChinaOrder,
  getChinaOrderWarnings,
  SAMPLE_CHINA_ORDERS,
} from "@/lib/chinaOrders";
import type {
  ChinaOrderRow,
  EditableChinaOrderField,
} from "@/types/chinaOrders";

const integerFormatter = new Intl.NumberFormat("ko-KR", {
  maximumFractionDigits: 0,
});
const cnyFormatter = new Intl.NumberFormat("ko-KR", {
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});
const cnyTotalFormatter = new Intl.NumberFormat("ko-KR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const textFields: Array<{
  key: Extract<EditableChinaOrderField, string>;
  label: string;
  width: string;
}> = [
  { key: "freightGroupId", label: "운임 그룹 ID", width: "min-w-40" },
  { key: "modelNo", label: "모델 번호", width: "min-w-28" },
  { key: "modelName", label: "모델명", width: "min-w-36" },
  { key: "optionName", label: "옵션명", width: "min-w-24" },
];

export default function ChinaOrdersPage() {
  const [rows, setRows] = useState<ChinaOrderRow[]>(() => cloneSampleRows());
  const calculatedRows = useMemo(() => calculateChinaOrders(rows), [rows]);
  const warningCount = rows.reduce(
    (count, row) => count + getChinaOrderWarnings(row).length,
    0,
  );
  const grandTotalKrw = calculatedRows.reduce(
    (total, row) => total + row.totalFinalPurchaseCostKrw,
    0,
  );

  function updateRow(
    id: string,
    field: EditableChinaOrderField,
    value: string,
  ) {
    setRows((current) =>
      current.map((row) => {
        if (row.id !== id) return row;

        if (isNumericField(field)) {
          return { ...row, [field]: value === "" ? 0 : Number(value) };
        }

        return { ...row, [field]: value };
      }),
    );
  }

  function addRow() {
    setRows((current) => [
      ...current,
      createEmptyChinaOrder(createRowId()),
    ]);
  }

  function duplicateRow(id: string) {
    setRows((current) => {
      const sourceIndex = current.findIndex((row) => row.id === id);
      if (sourceIndex < 0) return current;
      const copy = { ...current[sourceIndex], id: createRowId() };
      return [
        ...current.slice(0, sourceIndex + 1),
        copy,
        ...current.slice(sourceIndex + 1),
      ];
    });
  }

  function deleteRow(id: string) {
    setRows((current) => current.filter((row) => row.id !== id));
  }

  return (
    <>
      <PageHeader
        title="중국주문 원가계산"
        description="동일한 운임 그룹 ID의 중국 내륙운송비를 그룹 전체 수량으로 나누어 옵션별 최종 매입 원가를 계산합니다."
        actions={
          <>
            <button
              type="button"
              onClick={() => setRows(cloneSampleRows())}
              className="rounded-md border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
            >
              샘플 초기화
            </button>
            <button
              type="button"
              onClick={addRow}
              className="rounded-md bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
            >
              + 행 추가
            </button>
          </>
        }
      />

      <section className="mb-4 grid gap-3 sm:grid-cols-3" aria-label="계산 요약">
        <SummaryCard label="구매 행" value={`${integerFormatter.format(rows.length)}개`} />
        <SummaryCard
          label="검토 필요"
          value={warningCount ? `${warningCount}건` : "없음"}
          tone={warningCount ? "warning" : "default"}
        />
        <SummaryCard
          label="최종 매입 합계"
          value={`${integerFormatter.format(Math.round(grandTotalKrw))}원`}
          emphasized
        />
      </section>

      <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        <span className="font-semibold">계산식</span>
        <span className="ml-2 text-blue-800">
          최종 단가(CNY) = 상품 단가 + 운임 그룹 총 중국 내륙운송비 ÷ 운임 그룹 총 수량
        </span>
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" aria-label="중국주문 원가표">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="bg-slate-100 text-slate-600">
              <tr>
                <th className="sticky left-0 z-10 min-w-14 border-b border-r border-slate-200 bg-slate-100 px-3 py-3 text-center font-semibold">#</th>
                <th className="min-w-32 border-b border-r border-slate-200 px-3 py-3 font-semibold">상태</th>
                {textFields.map((field) => (
                  <th key={field.key} className={`${field.width} border-b border-r border-slate-200 px-3 py-3 font-semibold`}>{field.label}</th>
                ))}
                <th className="min-w-24 border-b border-r border-slate-200 px-3 py-3 text-right font-semibold">수량</th>
                <th className="min-w-28 border-b border-r border-slate-200 px-3 py-3 text-right font-semibold">상품 단가<br />(CNY)</th>
                <th className="min-w-32 border-b border-r border-slate-200 px-3 py-3 text-right font-semibold">중국 내륙운송비<br />(CNY)</th>
                <th className="min-w-28 border-b border-r border-slate-200 px-3 py-3 text-right font-semibold">내부 환율<br />(KRW/CNY)</th>
                <CalculatedHeader label="그룹 총 수량" />
                <CalculatedHeader label="그룹 총 운송비 (CNY)" />
                <CalculatedHeader label="개당 운송비 (CNY)" />
                <CalculatedHeader label="최종 단가 (CNY)" highlighted />
                <CalculatedHeader label="최종 단가 (KRW)" highlighted />
                <CalculatedHeader label="최종 매입 합계 (KRW)" highlighted />
                <th className="min-w-36 border-b border-slate-200 px-3 py-3 text-center font-semibold">작업</th>
              </tr>
            </thead>
            <tbody>
              {calculatedRows.map((row, index) => {
                const warnings = getChinaOrderWarnings(row);
                return (
                  <tr key={row.id} className="group hover:bg-slate-50/80">
                    <td className="sticky left-0 z-10 border-b border-r border-slate-200 bg-white px-3 py-2 text-center font-medium text-slate-400 group-hover:bg-slate-50">{index + 1}</td>
                    <td className="border-b border-r border-slate-200 px-3 py-2">
                      <div className="flex max-w-28 flex-wrap gap-1">
                        {warnings.length ? warnings.map((warning) => (
                          <span key={warning} className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">{warning}</span>
                        )) : (
                          <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">정상</span>
                        )}
                      </div>
                    </td>
                    {textFields.map((field) => (
                      <td key={field.key} className="border-b border-r border-slate-200 p-1.5">
                        <input
                          aria-label={`${index + 1}행 ${field.label}`}
                          value={String(row[field.key])}
                          onChange={(event) => updateRow(row.id, field.key, event.target.value)}
                          className="w-full rounded border border-transparent bg-transparent px-2 py-1.5 text-slate-800 outline-none hover:border-slate-300 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100"
                        />
                      </td>
                    ))}
                    <NumberCell label="수량" value={row.quantity} step="1" min="0" onChange={(value) => updateRow(row.id, "quantity", value)} />
                    <NumberCell label="상품 단가" value={row.unitCostCny} step="0.01" min="0" onChange={(value) => updateRow(row.id, "unitCostCny", value)} />
                    <NumberCell label="중국 내륙운송비" value={row.domesticChinaFreightCny} step="0.01" min="0" onChange={(value) => updateRow(row.id, "domesticChinaFreightCny", value)} />
                    <NumberCell label="내부 환율" value={row.internalExchangeRateKrwPerCny} step="1" min="0" onChange={(value) => updateRow(row.id, "internalExchangeRateKrwPerCny", value)} />
                    <CalculatedCell value={integerFormatter.format(row.groupTotalQuantity)} />
                    <CalculatedCell value={cnyTotalFormatter.format(row.groupTotalDomesticChinaFreightCny)} />
                    <CalculatedCell value={cnyFormatter.format(row.domesticFreightPerUnitCny)} />
                    <CalculatedCell value={cnyFormatter.format(row.finalUnitCostCny)} highlighted />
                    <CalculatedCell value={integerFormatter.format(Math.round(row.finalUnitCostKrw))} highlighted />
                    <CalculatedCell value={integerFormatter.format(Math.round(row.totalFinalPurchaseCostKrw))} highlighted strong />
                    <td className="border-b border-slate-200 px-2 py-2 text-center">
                      <div className="flex justify-center gap-1">
                        <button type="button" onClick={() => duplicateRow(row.id)} className="rounded border border-slate-300 px-2 py-1.5 font-medium text-slate-600 hover:bg-slate-100">복제</button>
                        <button type="button" onClick={() => deleteRow(row.id)} className="rounded border border-red-200 px-2 py-1.5 font-medium text-red-600 hover:bg-red-50">삭제</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && (
          <div className="px-6 py-16 text-center">
            <p className="font-medium text-slate-700">등록된 구매 행이 없습니다.</p>
            <p className="mt-1 text-sm text-slate-500">행 추가 버튼으로 첫 구매 내역을 입력하세요.</p>
          </div>
        )}
      </section>
      <p className="mt-3 text-xs leading-5 text-slate-500">
        같은 운임 그룹의 운송비는 어느 행에 입력해도 모두 합산됩니다. 중복 입력 여부를 확인한 뒤 사용하세요.
      </p>
    </>
  );
}

function SummaryCard({ label, value, tone = "default", emphasized = false }: { label: string; value: string; tone?: "default" | "warning"; emphasized?: boolean }) {
  return (
    <div className={`rounded-lg border bg-white px-4 py-3 shadow-sm ${emphasized ? "border-blue-200" : "border-slate-200"}`}>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-bold ${emphasized ? "text-blue-700" : tone === "warning" ? "text-amber-700" : "text-slate-900"}`}>{value}</p>
    </div>
  );
}

function NumberCell({ label, value, onChange, step, min }: { label: string; value: number; onChange: (value: string) => void; step: string; min: string }) {
  return (
    <td className="border-b border-r border-slate-200 p-1.5">
      <input
        aria-label={label}
        type="number"
        value={Number.isFinite(value) ? value : ""}
        onChange={(event) => onChange(event.target.value)}
        step={step}
        min={min}
        className="w-full rounded border border-transparent bg-transparent px-2 py-1.5 text-right tabular-nums text-slate-800 outline-none hover:border-slate-300 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100"
      />
    </td>
  );
}

function CalculatedHeader({ label, highlighted = false }: { label: string; highlighted?: boolean }) {
  return <th className={`min-w-32 border-b border-r border-slate-200 px-3 py-3 text-right font-semibold ${highlighted ? "bg-blue-50 text-blue-800" : ""}`}>{label}</th>;
}

function CalculatedCell({ value, highlighted = false, strong = false }: { value: string; highlighted?: boolean; strong?: boolean }) {
  return <td className={`border-b border-r border-slate-200 px-3 py-2 text-right tabular-nums ${highlighted ? "bg-blue-50/50 text-blue-950" : "bg-slate-50/50 text-slate-700"} ${strong ? "font-bold" : "font-medium"}`}>{value}</td>;
}

function isNumericField(field: EditableChinaOrderField): field is "quantity" | "unitCostCny" | "domesticChinaFreightCny" | "internalExchangeRateKrwPerCny" {
  return ["quantity", "unitCostCny", "domesticChinaFreightCny", "internalExchangeRateKrwPerCny"].includes(field);
}

function createRowId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function cloneSampleRows(): ChinaOrderRow[] {
  return SAMPLE_CHINA_ORDERS.map((row) => ({ ...row }));
}
