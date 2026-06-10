"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import {
  calculateAppliedExchangeRate,
  calculateChinaOrders,
  createEmptyChinaOrder,
  DEFAULT_CHINA_ORDER_EXCHANGE_SETTINGS,
  getChinaOrderWarnings,
  SAMPLE_CHINA_ORDERS,
} from "@/lib/chinaOrders";
import {
  getProductByModelName,
  getProductByModelNo,
} from "@/lib/productMaster";
import type {
  ChinaOrderExchangeSettings,
  ChinaOrderRow,
  EditableChinaOrderField,
} from "@/types/chinaOrders";
import type { ProductMaster } from "@/types/productMaster";

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
const exchangeRateFormatter = new Intl.NumberFormat("ko-KR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

type MasterConnectionStatus = "connected" | "missing" | "review";

export default function ChinaOrdersPage() {
  const [rows, setRows] = useState<ChinaOrderRow[]>(() => cloneSampleRows());
  const [exchangeSettings, setExchangeSettings] =
    useState<ChinaOrderExchangeSettings>(() => ({
      ...DEFAULT_CHINA_ORDER_EXCHANGE_SETTINGS,
    }));
  const appliedExchangeRateKrwPerCny = useMemo(
    () => calculateAppliedExchangeRate(exchangeSettings),
    [exchangeSettings],
  );
  const calculatedRows = useMemo(
    () => calculateChinaOrders(rows, appliedExchangeRateKrwPerCny),
    [appliedExchangeRateKrwPerCny, rows],
  );
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

  function updateExchangeSetting(
    field: keyof ChinaOrderExchangeSettings,
    value: string,
  ) {
    setExchangeSettings((current) => ({
      ...current,
      [field]: value === "" ? 0 : Number(value),
    }));
  }

  function applyProductMaster(id: string) {
    setRows((current) =>
      current.map((row) => {
        if (row.id !== id) return row;

        const product = findLookupCandidate(row);
        if (!product) return row;

        const optionStillExists = product.options.some(
          (option) => option.optionName === row.optionName,
        );

        return {
          ...row,
          modelNo: product.modelNo,
          modelName: product.modelName,
          optionName: optionStillExists ? row.optionName : "",
        };
      }),
    );
  }

  function addRow() {
    setRows((current) => [
      ...current,
      createEmptyChinaOrder(createRowId()),
    ]);
  }

  function resetSample() {
    setRows(cloneSampleRows());
    setExchangeSettings({ ...DEFAULT_CHINA_ORDER_EXCHANGE_SETTINGS });
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
        description="상품마스터의 상품·옵션 정보를 연결하고, 발주 회차별 원가와 운임을 직접 입력해 최종 매입 원가를 계산합니다."
        actions={
          <>
            <button
              type="button"
              onClick={resetSample}
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

      <section
        className="mb-4 grid gap-3 sm:grid-cols-3"
        aria-label="계산 요약"
      >
        <SummaryCard
          label="구매 행"
          value={`${integerFormatter.format(rows.length)}개`}
        />
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

      <ExchangeSettingsPanel
        settings={exchangeSettings}
        appliedExchangeRateKrwPerCny={appliedExchangeRateKrwPerCny}
        onChange={updateExchangeSetting}
      />

      <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        <p>
          <span className="font-semibold">CNY 계산식</span>
          <span className="ml-2 text-blue-800">
            최종 단가 = 상품 단가 + 운임 그룹 총 중국 내륙운송비 ÷ 운임
            그룹 총 수량
          </span>
        </p>
        <p className="mt-1 text-xs text-blue-700">
          상품 단가는 발주·협상·옵션·선적 회차마다 달라지므로 상품마스터에서
          가져오지 않고 각 행에서 직접 입력합니다.
        </p>
      </div>

      <section
        className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
        aria-label="중국주문 원가표"
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="bg-slate-100 text-slate-600">
              <tr>
                <th className="sticky left-0 z-10 min-w-14 border-b border-r border-slate-200 bg-slate-100 px-3 py-3 text-center font-semibold">
                  #
                </th>
                <th className="min-w-40 border-b border-r border-slate-200 px-3 py-3 font-semibold">
                  상태 / 상품마스터
                </th>
                <th className="min-w-40 border-b border-r border-slate-200 px-3 py-3 font-semibold">
                  운임 그룹 ID
                </th>
                <th className="min-w-36 border-b border-r border-slate-200 px-3 py-3 font-semibold">
                  모델 번호
                </th>
                <th className="min-w-44 border-b border-r border-slate-200 px-3 py-3 font-semibold">
                  모델명
                </th>
                <th className="min-w-36 border-b border-r border-slate-200 px-3 py-3 font-semibold">
                  옵션명
                </th>
                <th className="min-w-24 border-b border-r border-slate-200 px-3 py-3 text-right font-semibold">
                  수량
                </th>
                <th className="min-w-28 border-b border-r border-slate-200 px-3 py-3 text-right font-semibold">
                  상품 단가
                  <br />
                  (CNY, 직접 입력)
                </th>
                <th className="min-w-32 border-b border-r border-slate-200 px-3 py-3 text-right font-semibold">
                  중국 내륙운송비
                  <br />
                  (CNY)
                </th>
                <CalculatedHeader label="그룹 총 수량" />
                <CalculatedHeader label="그룹 총 운송비 (CNY)" />
                <CalculatedHeader label="개당 운송비 (CNY)" />
                <CalculatedHeader label="적용 환율 (KRW/CNY)" />
                <CalculatedHeader label="최종 단가 (CNY)" highlighted />
                <CalculatedHeader label="최종 단가 (KRW)" highlighted />
                <CalculatedHeader label="최종 매입 합계 (KRW)" highlighted />
                <th className="min-w-36 border-b border-slate-200 px-3 py-3 text-center font-semibold">
                  작업
                </th>
              </tr>
            </thead>
            <tbody>
              {calculatedRows.map((row, index) => {
                const warnings = getChinaOrderWarnings(row);
                const product = findLookupCandidate(row);
                const masterStatus = getMasterConnectionStatus(row);

                return (
                  <tr key={row.id} className="group hover:bg-slate-50/80">
                    <td className="sticky left-0 z-10 border-b border-r border-slate-200 bg-white px-3 py-2 text-center font-medium text-slate-400 group-hover:bg-slate-50">
                      {index + 1}
                    </td>
                    <td className="border-b border-r border-slate-200 px-3 py-2">
                      <div className="flex max-w-36 flex-wrap gap-1">
                        <MasterStatusBadge status={masterStatus} />
                        {warnings.map((warning) => (
                          <span
                            key={warning}
                            className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800"
                          >
                            {warning}
                          </span>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => applyProductMaster(row.id)}
                        disabled={!product}
                        className="mt-2 rounded border border-blue-200 bg-white px-2 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
                      >
                        상품마스터 적용
                      </button>
                    </td>
                    <TextCell
                      label={`${index + 1}행 운임 그룹 ID`}
                      value={row.freightGroupId}
                      onChange={(value) =>
                        updateRow(row.id, "freightGroupId", value)
                      }
                    />
                    <td className="border-b border-r border-slate-200 p-1.5">
                      <input
                        aria-label={`${index + 1}행 모델 번호`}
                        value={row.modelNo}
                        onChange={(event) =>
                          updateRow(row.id, "modelNo", event.target.value)
                        }
                        onBlur={() => applyProductMaster(row.id)}
                        className={textInputClassName}
                      />
                      {product?.mainImageUrl && (
                        <div className="mt-1.5 flex items-center gap-1.5 px-2 text-[10px] text-slate-500">
                          <span
                            role="img"
                            aria-label={`${product.modelName} 대표 이미지`}
                            className="size-6 rounded border border-slate-200 bg-cover bg-center"
                            style={{
                              backgroundImage: `url(${product.mainImageUrl})`,
                            }}
                          />
                          대표 이미지
                        </div>
                      )}
                    </td>
                    <TextCell
                      label={`${index + 1}행 모델명`}
                      value={row.modelName}
                      onChange={(value) =>
                        updateRow(row.id, "modelName", value)
                      }
                      onBlur={() => applyProductMaster(row.id)}
                    />
                    <td className="border-b border-r border-slate-200 p-1.5">
                      {product ? (
                        <select
                          aria-label={`${index + 1}행 옵션명`}
                          value={row.optionName}
                          onChange={(event) =>
                            updateRow(row.id, "optionName", event.target.value)
                          }
                          className={textInputClassName}
                        >
                          <option value="">옵션 선택</option>
                          {product.options.map((option) => (
                            <option
                              key={option.optionId}
                              value={option.optionName}
                            >
                              {option.optionName}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          aria-label={`${index + 1}행 옵션명`}
                          value={row.optionName}
                          onChange={(event) =>
                            updateRow(row.id, "optionName", event.target.value)
                          }
                          className={textInputClassName}
                        />
                      )}
                    </td>
                    <NumberCell
                      label="수량"
                      value={row.quantity}
                      step="1"
                      min="0"
                      onChange={(value) =>
                        updateRow(row.id, "quantity", value)
                      }
                    />
                    <NumberCell
                      label="상품 단가"
                      value={row.unitCostCny}
                      step="0.01"
                      min="0"
                      emphasized
                      onChange={(value) =>
                        updateRow(row.id, "unitCostCny", value)
                      }
                    />
                    <NumberCell
                      label="중국 내륙운송비"
                      value={row.domesticChinaFreightCny}
                      step="0.01"
                      min="0"
                      onChange={(value) =>
                        updateRow(row.id, "domesticChinaFreightCny", value)
                      }
                    />
                    <CalculatedCell
                      value={integerFormatter.format(row.groupTotalQuantity)}
                    />
                    <CalculatedCell
                      value={cnyTotalFormatter.format(
                        row.groupTotalDomesticChinaFreightCny,
                      )}
                    />
                    <CalculatedCell
                      value={cnyFormatter.format(
                        row.domesticFreightPerUnitCny,
                      )}
                    />
                    <CalculatedCell
                      value={exchangeRateFormatter.format(
                        row.appliedExchangeRateKrwPerCny,
                      )}
                    />
                    <CalculatedCell
                      value={cnyFormatter.format(row.finalUnitCostCny)}
                      highlighted
                    />
                    <CalculatedCell
                      value={integerFormatter.format(
                        Math.round(row.finalUnitCostKrw),
                      )}
                      highlighted
                    />
                    <CalculatedCell
                      value={integerFormatter.format(
                        Math.round(row.totalFinalPurchaseCostKrw),
                      )}
                      highlighted
                      strong
                    />
                    <td className="border-b border-slate-200 px-2 py-2 text-center">
                      <div className="flex justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => duplicateRow(row.id)}
                          className="rounded border border-slate-300 px-2 py-1.5 font-medium text-slate-600 hover:bg-slate-100"
                        >
                          복제
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteRow(row.id)}
                          className="rounded border border-red-200 px-2 py-1.5 font-medium text-red-600 hover:bg-red-50"
                        >
                          삭제
                        </button>
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
            <p className="font-medium text-slate-700">
              등록된 구매 행이 없습니다.
            </p>
            <p className="mt-1 text-sm text-slate-500">
              행 추가 버튼으로 첫 구매 내역을 입력하세요.
            </p>
          </div>
        )}
      </section>
      <p className="mt-3 text-xs leading-5 text-slate-500">
        같은 운임 그룹의 운송비는 어느 행에 입력해도 모두 합산됩니다. 중복
        입력 여부를 확인한 뒤 사용하세요.
      </p>
    </>
  );
}

function ExchangeSettingsPanel({
  settings,
  appliedExchangeRateKrwPerCny,
  onChange,
}: {
  settings: ChinaOrderExchangeSettings;
  appliedExchangeRateKrwPerCny: number;
  onChange: (
    field: keyof ChinaOrderExchangeSettings,
    value: string,
  ) => void;
}) {
  return (
    <section
      className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      aria-labelledby="exchange-settings-title"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
        <div className="lg:w-60">
          <h2
            id="exchange-settings-title"
            className="text-sm font-bold text-slate-900"
          >
            환율 및 환전 수수료 설정
          </h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            기준환율은 현재 수동 입력입니다. 추후 외부 환율 API 연결 예정.
          </p>
        </div>
        <ExchangeNumberInput
          label="기준환율 (KRW/CNY)"
          value={settings.baseExchangeRateKrwPerCny}
          step="0.01"
          onChange={(value) =>
            onChange("baseExchangeRateKrwPerCny", value)
          }
        />
        <ExchangeNumberInput
          label="비율 수수료 (%)"
          value={settings.feeRatePercent}
          step="0.01"
          onChange={(value) => onChange("feeRatePercent", value)}
        />
        <ExchangeNumberInput
          label="고정 수수료 (KRW/CNY)"
          value={settings.feeFixedKrwPerCny}
          step="0.01"
          onChange={(value) => onChange("feeFixedKrwPerCny", value)}
        />
        <div className="min-w-52 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5">
          <p className="text-xs font-semibold text-blue-700">적용 환율</p>
          <p className="mt-0.5 text-lg font-bold tabular-nums text-blue-950">
            {exchangeRateFormatter.format(appliedExchangeRateKrwPerCny)} 원
          </p>
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        적용 환율 = 기준환율 × (1 + 비율 수수료 ÷ 100) + 고정 수수료
      </p>
    </section>
  );
}

function ExchangeNumberInput({
  label,
  value,
  step,
  onChange,
}: {
  label: string;
  value: number;
  step: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block min-w-40 flex-1">
      <span className="mb-1.5 block text-xs font-semibold text-slate-600">
        {label}
      </span>
      <input
        type="number"
        min="0"
        step={step}
        value={Number.isFinite(value) ? value : ""}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-right text-sm tabular-nums text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
      />
    </label>
  );
}

function MasterStatusBadge({ status }: { status: MasterConnectionStatus }) {
  const styles: Record<MasterConnectionStatus, string> = {
    connected: "bg-emerald-50 text-emerald-700",
    missing: "bg-slate-100 text-slate-600",
    review: "bg-amber-100 text-amber-800",
  };
  const labels: Record<MasterConnectionStatus, string> = {
    connected: "마스터 연결됨",
    missing: "마스터 없음",
    review: "확인 필요",
  };

  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${styles[status]}`}
    >
      {labels[status]}
    </span>
  );
}

function SummaryCard({
  label,
  value,
  tone = "default",
  emphasized = false,
}: {
  label: string;
  value: string;
  tone?: "default" | "warning";
  emphasized?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border bg-white px-4 py-3 shadow-sm ${emphasized ? "border-blue-200" : "border-slate-200"}`}
    >
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p
        className={`mt-1 text-lg font-bold ${emphasized ? "text-blue-700" : tone === "warning" ? "text-amber-700" : "text-slate-900"}`}
      >
        {value}
      </p>
    </div>
  );
}

const textInputClassName =
  "w-full rounded border border-transparent bg-transparent px-2 py-1.5 text-slate-800 outline-none hover:border-slate-300 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100";

function TextCell({
  label,
  value,
  onChange,
  onBlur,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
}) {
  return (
    <td className="border-b border-r border-slate-200 p-1.5">
      <input
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        className={textInputClassName}
      />
    </td>
  );
}

function NumberCell({
  label,
  value,
  onChange,
  step,
  min,
  emphasized = false,
}: {
  label: string;
  value: number;
  onChange: (value: string) => void;
  step: string;
  min: string;
  emphasized?: boolean;
}) {
  return (
    <td
      className={`border-b border-r border-slate-200 p-1.5 ${emphasized ? "bg-amber-50/50" : ""}`}
    >
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

function CalculatedHeader({
  label,
  highlighted = false,
}: {
  label: string;
  highlighted?: boolean;
}) {
  return (
    <th
      className={`min-w-32 border-b border-r border-slate-200 px-3 py-3 text-right font-semibold ${highlighted ? "bg-blue-50 text-blue-800" : ""}`}
    >
      {label}
    </th>
  );
}

function CalculatedCell({
  value,
  highlighted = false,
  strong = false,
}: {
  value: string;
  highlighted?: boolean;
  strong?: boolean;
}) {
  return (
    <td
      className={`border-b border-r border-slate-200 px-3 py-2 text-right tabular-nums ${highlighted ? "bg-blue-50/50 text-blue-950" : "bg-slate-50/50 text-slate-700"} ${strong ? "font-bold" : "font-medium"}`}
    >
      {value}
    </td>
  );
}

function findLookupCandidate(row: ChinaOrderRow): ProductMaster | undefined {
  const productByModelNo = getProductByModelNo(row.modelNo);
  const productByModelName = getProductByModelName(row.modelName);

  if (
    productByModelNo &&
    productByModelName &&
    productByModelNo.modelNo !== productByModelName.modelNo
  ) {
    return undefined;
  }

  return productByModelNo ?? productByModelName;
}

function getMasterConnectionStatus(
  row: ChinaOrderRow,
): MasterConnectionStatus {
  const hasLookupValue = Boolean(row.modelNo.trim() || row.modelName.trim());
  if (!hasLookupValue) return "missing";

  const productByModelNo = getProductByModelNo(row.modelNo);
  const productByModelName = getProductByModelName(row.modelName);

  if (
    productByModelNo &&
    productByModelName &&
    productByModelNo.modelNo === productByModelName.modelNo
  ) {
    return "connected";
  }

  if (productByModelNo || productByModelName) return "review";
  return "missing";
}

function isNumericField(
  field: EditableChinaOrderField,
): field is "quantity" | "unitCostCny" | "domesticChinaFreightCny" {
  return ["quantity", "unitCostCny", "domesticChinaFreightCny"].includes(
    field,
  );
}

function createRowId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function cloneSampleRows(): ChinaOrderRow[] {
  return SAMPLE_CHINA_ORDERS.map((row) => ({ ...row }));
}
