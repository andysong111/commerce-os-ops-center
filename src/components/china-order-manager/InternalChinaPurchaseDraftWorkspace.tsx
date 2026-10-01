"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { internalChinaOrderEvidenceIssues } from "@/lib/internalChinaOrderEvidence";
import type { InternalChinaPurchaseBudgetAudit } from "@/lib/internalChinaPurchaseBudgetAudit";
import type {
  InternalChinaPurchaseDraft,
  InternalChinaPurchaseDraftLine,
} from "@/lib/internalChinaPurchaseDraft";

const number = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });
const cny = new Intl.NumberFormat("ko-KR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 4,
});

function decimal(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function lineKey(line: InternalChinaPurchaseDraftLine) {
  return line.freightGroupId.trim() || `__${line.barcode}`;
}

function validHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function InternalChinaPurchaseDraftWorkspace({
  initialDraft,
  budgetAudit,
}: {
  initialDraft: InternalChinaPurchaseDraft;
  budgetAudit: InternalChinaPurchaseBudgetAudit;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(initialDraft);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [ordering, setOrdering] = useState(false);

  const calculations = useMemo(() => {
    const groups = new Map<string, { quantity: number; freight: number }>();
    for (const line of draft.lines) {
      const key = lineKey(line);
      const current = groups.get(key) ?? { quantity: 0, freight: 0 };
      current.quantity += line.quantity;
      current.freight += decimal(line.domesticChinaFreightCny);
      groups.set(key, current);
    }

    const byBarcode = new Map<
      string,
      {
        freightPerUnitCny: number;
        finalUnitCny: number;
        actualUnitKrw: number;
        internalStandardUnitKrw: number;
        totalCny: number;
        totalKrw: number;
        internalStandardTotalKrw: number;
      }
    >();

    let productCny = 0;
    let freightCny = 0;
    let totalCny = 0;
    let totalKrw = 0;
    let internalStandardTotalKrw = 0;

    for (const line of draft.lines) {
      const group = groups.get(lineKey(line)) ?? { quantity: 0, freight: 0 };
      const freightPerUnitCny =
        group.quantity > 0 ? group.freight / group.quantity : 0;
      const finalUnitCny = decimal(line.unitPriceCny) + freightPerUnitCny;
      const rowTotalCny = finalUnitCny * line.quantity;
      const actualUnitKrw = finalUnitCny * draft.exchangeRateKrwPerCny;
      const rowTotalKrw = rowTotalCny * draft.exchangeRateKrwPerCny;
      const internalStandardUnitKrw =
        actualUnitKrw * draft.internalOrderCostMultiplier;
      const rowInternalStandardTotalKrw =
        rowTotalKrw * draft.internalOrderCostMultiplier;

      byBarcode.set(line.barcode, {
        freightPerUnitCny,
        finalUnitCny,
        actualUnitKrw,
        internalStandardUnitKrw,
        totalCny: rowTotalCny,
        totalKrw: rowTotalKrw,
        internalStandardTotalKrw: rowInternalStandardTotalKrw,
      });

      productCny += decimal(line.unitPriceCny) * line.quantity;
      totalCny += rowTotalCny;
      totalKrw += rowTotalKrw;
      internalStandardTotalKrw += rowInternalStandardTotalKrw;
    }

    freightCny = [...groups.values()].reduce(
      (sum, group) => sum + group.freight,
      0,
    );

    const productKrw = productCny * draft.exchangeRateKrwPerCny;
    const budgetKrw = budgetAudit.productOrderBudgetKrw;
    const budgetUsedPercent =
      budgetKrw > 0 ? Math.round((productKrw / budgetKrw) * 10_000) / 100 : 0;
    const budgetRemainingKrw = Math.max(0, budgetKrw - productKrw);
    const budgetOverKrw = Math.max(0, productKrw - budgetKrw);
    const actualPriceCount = draft.lines.filter(
      (line) => decimal(line.unitPriceCny) > 0,
    ).length;

    return {
      byBarcode,
      productCny,
      productKrw,
      freightCny,
      totalCny,
      totalKrw,
      internalStandardTotalKrw,
      budgetUsedPercent,
      budgetRemainingKrw,
      budgetOverKrw,
      actualPriceCount,
    };
  }, [budgetAudit.productOrderBudgetKrw, draft]);

  const requiredIssues = useMemo(
    () => internalChinaOrderEvidenceIssues(draft.lines),
    [draft.lines],
  );

  const optionReviewCount = useMemo(
    () => draft.lines.filter((line) => !line.chinaOption.trim()).length,
    [draft.lines],
  );

  function updateLine(
    barcode: string,
    patch: Partial<InternalChinaPurchaseDraftLine>,
  ) {
    if (draft.status !== "DRAFT") return;
    setDraft((current) => ({
      ...current,
      lines: current.lines.map((line) =>
        line.barcode === barcode ? { ...line, ...patch } : line,
      ),
    }));
  }

  function payload() {
    return {
      lines: draft.lines.map((line) => ({
        barcode: line.barcode,
        quantity: line.quantity,
        chinaOption: line.chinaOption,
        unitPriceCny: line.unitPriceCny,
        freightGroupId: line.freightGroupId,
        domesticChinaFreightCny: line.domesticChinaFreightCny,
        orderNumber: line.orderNumber,
        note: line.note,
      })),
    };
  }

  async function saveDraft() {
    if (draft.status !== "DRAFT") return;
    setNotice("");
    setSaving(true);
    try {
      const response = await fetch(
        `/api/china-order-manager/drafts/${encodeURIComponent(draft.draftId)}`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify(payload()),
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        draft?: InternalChinaPurchaseDraft;
      };
      if (!response.ok || !body.ok || !body.draft) {
        setNotice(body.message || "중국 발주초안 저장에 실패했습니다.");
        return;
      }
      setDraft(body.draft);
      setNotice(
        body.message ||
          "중국 발주초안을 저장했습니다. 실제 위안단가를 월간 발주예산 검증에도 반영합니다.",
      );
      router.refresh();
    } catch {
      setNotice("중국 발주초안 저장 요청이 일시적으로 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function markOrdered() {
    if (draft.status !== "DRAFT") return;
    setNotice("");
    if (requiredIssues.length) {
      setNotice(
        `실제 주문완료 기록 전에 필수값 ${requiredIssues.length}개를 채우세요. ${requiredIssues
          .slice(0, 6)
          .join(" · ")}`,
      );
      return;
    }
    if (
      !window.confirm(
        `실제로 1688에서 ${draft.lineCount}개 SKU · 총 ${draft.totalQuantity.toLocaleString("ko-KR")}개 주문을 완료했습니까?\n\n이 버튼은 1688 주문·결제를 실행하지 않습니다. 실제 주문이 끝난 뒤에만 Ops Center 원장을 ORDERED로 기록합니다.`,
      )
    ) {
      return;
    }
    setOrdering(true);
    try {
      const response = await fetch(
        `/api/china-order-manager/drafts/${encodeURIComponent(draft.draftId)}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({ action: "MARK_ORDERED", prep: payload() }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        draft?: InternalChinaPurchaseDraft;
      };
      if (!response.ok || !body.ok || !body.draft) {
        setNotice(body.message || "실제 주문완료 기록에 실패했습니다.");
        return;
      }
      setDraft(body.draft);
      setNotice(body.message || "실제 주문완료로 원장에 기록했습니다.");
      router.refresh();
    } catch {
      setNotice(
        "실제 주문완료 기록 요청이 일시적으로 실패했습니다. 1688에서 실제 주문했는지 먼저 확인한 뒤 다시 시도하세요.",
      );
    } finally {
      setOrdering(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric
          label="상태"
          value={draft.status === "ORDERED" ? "실주문 기록" : "주문 준비"}
        />
        <Metric label="SKU" value={`${number.format(draft.lineCount)}개`} />
        <Metric
          label="총 주문수량"
          value={`${number.format(draft.totalQuantity)}개`}
        />
        <Metric
          label="필수 확인"
          value={`${number.format(requiredIssues.length)}건`}
          danger={requiredIssues.length > 0}
        />
        <Metric
          label="내부기준원가"
          value={`${number.format(Math.round(calculations.internalStandardTotalKrw))}원`}
          emphasized
        />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="text-xs font-black tracking-[0.12em] text-blue-700">
              OPS CENTER NATIVE · NO GPT SITE
            </span>
            <h2 className="mt-1 text-xl font-black text-slate-950">
              실제 1688 주문 준비
            </h2>
            <p className="mt-2 max-w-5xl text-sm leading-6 text-slate-600">
              판매옵션은 B-code 기준값을 표시합니다. 1688 주문링크는 B-code별로
              따로 입력하지 않고 해당 모델번호의 상품출시진행관리 고정 1번 중국
              상품링크를 모든 옵션이 공통 사용합니다. B-code별로는 중국옵션만 확인하고,
              실제 주문 시 위안단가와 중국내 운임을 입력하세요. 수량은 빠른 발주안에서
              RESERVED로 확정되어 이 화면에서는 변경하지 않습니다.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[230px] rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5">
              <span className="block text-xs font-bold text-emerald-700">
                내부기준원가
              </span>
              <strong className="mt-0.5 block text-right text-base font-black text-emerald-950">
                {number.format(
                  Math.round(calculations.internalStandardTotalKrw),
                )}
                원
              </strong>
              <span className="mt-0.5 block text-[11px] text-emerald-700">
                실주문 원가 × 내부 주문 수수료율 {draft.internalOrderCostMultiplier.toFixed(2)}
              </span>
            </div>
            <button
              type="button"
              onClick={() => void saveDraft()}
              disabled={saving || draft.status !== "DRAFT"}
              className="rounded-xl border border-blue-300 bg-white px-4 py-2.5 text-sm font-black text-blue-800 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "저장 중..." : "발주초안 저장"}
            </button>
            <button
              type="button"
              onClick={() => void markOrdered()}
              disabled={
                ordering ||
                draft.status !== "DRAFT" ||
                requiredIssues.length > 0
              }
              className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {draft.status === "ORDERED"
                ? "실주문 기록완료"
                : ordering
                  ? "기록 중..."
                  : "1688 주문완료 후 기록"}
            </button>
          </div>
        </div>

        {notice ? (
          <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-950">
            {notice}
          </div>
        ) : null}

        {draft.metadataWarnings.length ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-950">
            {draft.metadataWarnings.slice(0, 4).join(" · ")}
          </div>
        ) : null}

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SubMetric
            label="상품금액"
            value={`${cny.format(calculations.productCny)} CNY`}
          />
          <SubMetric
            label="중국내 운임"
            value={`${cny.format(calculations.freightCny)} CNY`}
          />
          <SubMetric
            label="실주문 원가"
            value={`${number.format(Math.round(calculations.totalKrw))}원`}
          />
          <SubMetric
            label="중국옵션 확인 필요"
            value={`${number.format(optionReviewCount)} SKU`}
          />
        </div>

        <div
          className={`mt-4 rounded-xl border px-4 py-3 text-xs leading-5 ${
            calculations.budgetOverKrw > 0
              ? "border-rose-300 bg-rose-50 text-rose-950"
              : "border-blue-200 bg-blue-50 text-blue-950"
          }`}
        >
          <strong>실시간 월간 발주예산 검증</strong> · 실제 위안단가 입력 완료 {calculations.actualPriceCount}/{draft.lineCount} SKU · 현재 입력 상품대금 {number.format(Math.round(calculations.productKrw))}원 · 상품대금 한도 {number.format(budgetAudit.productOrderBudgetKrw)}원 · 사용률 {calculations.budgetUsedPercent.toLocaleString("ko-KR")}% · {calculations.budgetOverKrw > 0 ? `초과 ${number.format(Math.round(calculations.budgetOverKrw))}원` : `잔여 ${number.format(Math.round(calculations.budgetRemainingKrw))}원`}. 입력 중에는 이 값이 즉시 바뀌며, `발주초안 저장` 후 위의 월간 예산 카드에도 실제 1688 단가가 우선 반영됩니다.
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-[1900px] text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 font-bold text-slate-500">
              <tr>
                <th className="px-3 py-3">B-code / 모델 / 옵션</th>
                <th className="px-3 py-3">중국옵션</th>
                <th className="px-3 py-3">모델 고정 1번 1688 링크</th>
                <th className="px-3 py-3 text-right">수량</th>
                <th className="px-3 py-3 text-right">위안단가</th>
                <th className="px-3 py-3">운임그룹</th>
                <th className="px-3 py-3 text-right">중국내 운임</th>
                <th className="px-3 py-3 text-right">개당 운임</th>
                <th className="px-3 py-3 text-right">최종단가 CNY</th>
                <th className="px-3 py-3 text-right">실주문원가 KRW</th>
                <th className="px-3 py-3 text-right">내부기준원가 KRW</th>
                <th className="px-3 py-3">1688 주문번호</th>
                <th className="px-3 py-3">메모</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {draft.lines.map((line) => {
                const calc = calculations.byBarcode.get(line.barcode)!;
                const editable = draft.status === "DRAFT";
                return (
                  <tr
                    key={line.barcode}
                    className="align-top hover:bg-slate-50/70"
                  >
                    <td className="min-w-[280px] px-3 py-3">
                      <strong className="font-mono text-sm text-slate-950">
                        {line.barcode}
                      </strong>
                      <span className="mt-1 block font-semibold text-slate-700">
                        {line.modelName || "모델명 -"}
                      </span>
                      <span className="mt-1 block font-mono text-[11px] text-slate-400">
                        {line.modelNo}
                      </span>
                      <span className="mt-2 inline-flex rounded-md bg-blue-50 px-2 py-1 font-bold text-blue-800">
                        옵션 · {line.saleOption || "-"}
                      </span>
                    </td>
                    <td className="min-w-[190px] px-2 py-2">
                      <Input
                        value={line.chinaOption}
                        disabled={!editable}
                        required={!line.chinaOption.trim()}
                        placeholder="상품출시진행관리에서 자동입력"
                        onChange={(value) =>
                          updateLine(line.barcode, { chinaOption: value })
                        }
                      />
                    </td>
                    <td className="min-w-[330px] px-2 py-2">
                      {validHttpUrl(line.supplierLink) ? (
                        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-emerald-900">
                            {line.supplierLink}
                          </span>
                          <a
                            href={line.supplierLink}
                            target="_blank"
                            rel="noreferrer"
                            className="shrink-0 rounded-lg border border-emerald-300 bg-white px-2.5 py-1.5 font-black text-emerald-800 hover:bg-emerald-100"
                          >
                            1688 열기
                          </a>
                        </div>
                      ) : (
                        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 font-bold text-amber-900">
                          상품출시진행관리에서 이 모델의 1번 중국 상품링크를 입력하세요.
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right text-sm font-black text-slate-950">
                      {number.format(line.quantity)}
                    </td>
                    <td className="px-2 py-2">
                      <NumberInput
                        value={line.unitPriceCny}
                        disabled={!editable}
                        required={line.unitPriceCny <= 0}
                        onChange={(value) =>
                          updateLine(line.barcode, { unitPriceCny: value })
                        }
                      />
                    </td>
                    <td className="px-2 py-2">
                      <Input
                        value={line.freightGroupId}
                        disabled={!editable}
                        placeholder="같은 공급처면 동일 그룹"
                        onChange={(value) =>
                          updateLine(line.barcode, { freightGroupId: value })
                        }
                      />
                    </td>
                    <td className="px-2 py-2">
                      <NumberInput
                        value={line.domesticChinaFreightCny}
                        disabled={!editable}
                        onChange={(value) =>
                          updateLine(line.barcode, {
                            domesticChinaFreightCny: value,
                          })
                        }
                      />
                    </td>
                    <td className="px-3 py-3 text-right font-semibold text-slate-600">
                      {cny.format(calc.freightPerUnitCny)}
                    </td>
                    <td className="px-3 py-3 text-right font-black text-emerald-800">
                      {cny.format(calc.finalUnitCny)}
                    </td>
                    <td className="px-3 py-3 text-right font-black text-blue-800">
                      {number.format(Math.round(calc.actualUnitKrw))}원
                    </td>
                    <td className="px-3 py-3 text-right font-black text-violet-800">
                      {number.format(
                        Math.round(calc.internalStandardUnitKrw),
                      )}
                      원
                    </td>
                    <td className="px-2 py-2">
                      <Input
                        value={line.orderNumber}
                        disabled={!editable}
                        placeholder="주문 후 입력 가능"
                        onChange={(value) =>
                          updateLine(line.barcode, { orderNumber: value })
                        }
                      />
                    </td>
                    <td className="px-2 py-2">
                      <Input
                        value={line.note}
                        disabled={!editable}
                        onChange={(value) =>
                          updateLine(line.barcode, { note: value })
                        }
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-950">
        <strong>운영 규칙</strong> · 판매옵션은 B-code 기준정보이며 이 화면에서
        수정하지 않습니다. 1688 주문링크는 해당 모델번호의 상품출시진행관리
        고정 1번 중국 상품링크를 자동 사용하고 B-code별 링크 입력은 하지 않습니다.
        중국옵션은 B-code별로 저장해 재사용합니다. `1688 주문완료 후 기록`은 외부
        주문 버튼이 아니며 실제 1688에서 주문·결제를 마친 뒤에만 눌러 Commerce OS의
        RESERVED 약정을 ORDERED로 전환합니다.
      </section>
    </div>
  );
}

function Input({
  value,
  onChange,
  disabled,
  placeholder = "",
  warning = false,
  required = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  placeholder?: string;
  warning?: boolean;
  required?: boolean;
}) {
  const flagged = warning || required;
  return (
    <input
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className={`w-full min-w-[130px] rounded-lg border px-2.5 py-2 outline-none disabled:bg-slate-100 ${
        flagged
          ? "border-amber-300 bg-amber-50 focus:border-amber-500"
          : "border-slate-300 bg-white focus:border-slate-500"
      }`}
    />
  );
}

function NumberInput({
  value,
  onChange,
  disabled,
  required = false,
}: {
  value: number;
  onChange: (value: number) => void;
  disabled: boolean;
  required?: boolean;
}) {
  return (
    <input
      type="number"
      min={0}
      step="0.01"
      value={value || ""}
      disabled={disabled}
      onChange={(event) => onChange(decimal(event.target.value))}
      className={`w-28 rounded-lg border px-2.5 py-2 text-right font-black outline-none disabled:bg-slate-100 ${
        required
          ? "border-amber-300 bg-amber-50 focus:border-amber-500"
          : "border-slate-300 bg-white focus:border-slate-500"
      }`}
    />
  );
}

function Metric({
  label,
  value,
  emphasized = false,
  danger = false,
}: {
  label: string;
  value: string;
  emphasized?: boolean;
  danger?: boolean;
}) {
  return (
    <article
      className={`rounded-2xl border bg-white p-4 shadow-sm ${
        danger
          ? "border-amber-300"
          : emphasized
            ? "border-blue-300"
            : "border-slate-200"
      }`}
    >
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <strong
        className={`mt-1 block text-xl ${
          danger
            ? "text-amber-700"
            : emphasized
              ? "text-blue-700"
              : "text-slate-950"
        }`}
      >
        {value}
      </strong>
    </article>
  );
}

function SubMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
      <span className="text-xs text-slate-500">{label}</span>
      <strong className="mt-1 block text-base text-slate-950">{value}</strong>
    </div>
  );
}
