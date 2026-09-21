"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  receiptRequestFingerprint,
  receiptRequestStorageKey,
  validReceiptRequestId,
} from "@/domain/china-receipt-request";
import type { InternalChinaForwarderCostSummary } from "@/lib/internalChinaForwarderCost";
import { runInboundReceiptOnSaleSync } from "@/lib/inboundReceiptOnSaleSync";

export type InternalChinaReceiptPanelLine = {
  barcode: string;
  modelNo: string;
  modelName: string;
  saleOption: string;
  orderedQuantity: number;
  receivedQuantity: number;
  openQuantity: number;
  status: string;
};

const number = new Intl.NumberFormat("ko-KR");

function monthLabel(month: string) {
  const matched = month.match(/^(\d{4})-(\d{2})$/);
  return matched ? `${Number(matched[1])}년 ${Number(matched[2])}월` : month;
}

function clamp(value: unknown, maximum: number) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(maximum, Math.max(0, parsed));
}

function won(value: unknown) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, parsed);
}

type ForwarderCostResponse = {
  ok?: boolean;
  message?: string;
  result?: InternalChinaForwarderCostSummary;
};

export function InternalChinaReceiptPanel({
  draftId,
  cycleMonth,
  lines,
  forwarderCost,
}: {
  draftId: string;
  cycleMonth: string;
  lines: InternalChinaReceiptPanelLine[];
  forwarderCost: InternalChinaForwarderCostSummary;
}) {
  const router = useRouter();
  const openLines = useMemo(
    () => lines.filter((line) => line.openQuantity > 0),
    [lines],
  );
  const [expanded, setExpanded] = useState(
    () => openLines.length === 0 && !forwarderCost.actualCostKrw,
  );
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(openLines.map((line) => [line.barcode, line.openQuantity])),
  );
  const [forwarderCostInput, setForwarderCostInput] = useState(
    forwarderCost.actualCostKrw ? String(forwarderCost.actualCostKrw) : "",
  );

  const selected = openLines
    .map((line) => ({
      barcode: line.barcode,
      quantity: clamp(quantities[line.barcode], line.openQuantity),
    }))
    .filter((line) => line.quantity > 0);
  const selectedQuantity = selected.reduce((sum, line) => sum + line.quantity, 0);
  const remainingTotal = openLines.reduce((sum, line) => sum + line.openQuantity, 0);
  const actualForwarderCostKrw = won(forwarderCostInput);
  const existingForwarderCostKrw = forwarderCost.actualCostKrw ?? 0;
  const actualMultiplierPreview =
    actualForwarderCostKrw > 0 && forwarderCost.productPurchaseCostKrw > 0
      ? (forwarderCost.productPurchaseCostKrw + actualForwarderCostKrw) /
        forwarderCost.productPurchaseCostKrw
      : null;
  const actualTotalOutflowKrw =
    actualForwarderCostKrw > 0
      ? forwarderCost.productPurchaseCostKrw +
        forwarderCost.domesticChinaFreightKrw +
        actualForwarderCostKrw
      : null;

  function fillAll() {
    setQuantities(
      Object.fromEntries(openLines.map((line) => [line.barcode, line.openQuantity])),
    );
    setNotice("모든 품목의 남은 미입고수량을 이번 입고수량으로 채웠습니다.");
  }

  function clearAll() {
    setQuantities(Object.fromEntries(openLines.map((line) => [line.barcode, 0])));
    setNotice("이번 입고수량을 모두 0으로 초기화했습니다.");
  }

  function pendingReceiptRequest(linesToReceive: { barcode: string; quantity: number }[]) {
    const key = receiptRequestStorageKey(draftId, cycleMonth);
    const fingerprint = receiptRequestFingerprint(draftId, cycleMonth, linesToReceive);
    try {
      const stored = JSON.parse(window.sessionStorage.getItem(key) || "null") as {
        requestId?: unknown;
        fingerprint?: unknown;
      } | null;
      const existingId = validReceiptRequestId(stored?.requestId);
      if (existingId && stored?.fingerprint === fingerprint) {
        return { key, requestId: existingId, fingerprint };
      }
    } catch {
      // Corrupted local retry state is replaced with a new request identity.
    }
    const requestId = crypto.randomUUID();
    window.sessionStorage.setItem(key, JSON.stringify({ requestId, fingerprint }));
    return { key, requestId, fingerprint };
  }

  function clearPendingReceiptRequest(entry: {
    key: string;
    requestId: string;
    fingerprint: string;
  }) {
    try {
      const stored = JSON.parse(window.sessionStorage.getItem(entry.key) || "null") as {
        requestId?: unknown;
        fingerprint?: unknown;
      } | null;
      if (
        stored?.requestId === entry.requestId &&
        stored?.fingerprint === entry.fingerprint
      ) {
        window.sessionStorage.removeItem(entry.key);
      }
    } catch {
      // Diagnostic retry state is best effort only.
    }
  }

  async function persistForwarderCost() {
    const response = await fetch("/api/china-order-manager/forwarder-cost", {
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
        actualCostKrw: actualForwarderCostKrw,
      }),
    });
    const body = (await response.json().catch(() => ({}))) as ForwarderCostResponse;
    if (!response.ok || body.ok !== true || !body.result) {
      throw new Error(
        body.message || `배송대행 비용·원가 마감 실패 (${response.status})`,
      );
    }
    return body;
  }

  async function saveForwarderCost() {
    if (openLines.length > 0) {
      setNotice("남은 미입고를 전량 입고확정할 때 배송대행 비용과 실제 원가배수를 함께 마감합니다.");
      return;
    }
    if (actualForwarderCostKrw <= 0) {
      setNotice("배송대행지에서 실제 청구된 총비용을 원 단위로 입력하세요.");
      return;
    }
    if (
      !window.confirm(
        `${monthLabel(cycleMonth)} 배송대행지 실제비용 ${number.format(actualForwarderCostKrw)}원을 반영해 실제 원가배수를 확정할까요?\n\n실제 원가배수 = (상품 총 매입금액 + 배송대행지 실제비용) ÷ 상품 총 매입금액\n최종 SKU 매입원가 = (상품원가 × 실제 원가배수) + 중국내운임\n\n이 확정원가는 이후 가격조정 판단에 사용되며, 실제 판매가는 별도 승인 절차 없이 즉시 변경하지 않습니다.`,
      )
    ) {
      return;
    }

    setSaving(true);
    setNotice("");
    try {
      const body = await persistForwarderCost();
      setNotice(body.message || "배송대행 비용과 실제 원가배수를 마감했습니다.");
      router.refresh();
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "배송대행 비용·원가 마감을 완료하지 못했습니다.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function confirmReceipt() {
    if (!selected.length || selectedQuantity <= 0) {
      setNotice("이번에 실제 입고된 품목의 수량을 1개 이상 입력하세요.");
      return;
    }
    const fullReceipt = selectedQuantity === remainingTotal;
    if (fullReceipt && actualForwarderCostKrw <= 0) {
      setNotice(
        "전량 입고 마감에는 배송대행지에서 실제 청구된 총비용 입력이 필요합니다.",
      );
      return;
    }
    const prompt = fullReceipt
      ? `${monthLabel(cycleMonth)} 발주 건의 남은 ${number.format(remainingTotal)}개를 전량 입고확정하고 배송대행지 실제비용 ${number.format(actualForwarderCostKrw)}원으로 실제 원가배수까지 확정할까요?`
      : `${monthLabel(cycleMonth)} 발주 건에서 ${number.format(selected.length)} SKU · ${number.format(selectedQuantity)}개를 부분입고로 확정할까요?`;
    const detail = fullReceipt
      ? "입고수량을 원장과 Product Master에 반영한 뒤 실제 원가배수를 계산합니다. 정확재고가 1개 이상이고 Shopling 매핑이 정상인 입고 품목은 곧바로 판매중 자동전환까지 이어집니다. SKU 최종 매입원가는 (상품원가 × 실제 원가배수) + 중국내운임으로 확정되고 이후 가격조정 판단의 원가로 이어집니다."
      : "확정 즉시 중국 발주·입고 원장의 미입고 수량이 차감됩니다. 정확재고가 1개 이상이고 Shopling 매핑이 정상인 품목은 판매중 자동전환까지 이어집니다. 실제 원가배수는 최종 전량 입고 시 배송대행 비용으로 확정합니다.";
    if (!window.confirm(`${prompt}\n\n${detail}`)) return;

    const receiptRequest = pendingReceiptRequest(selected);
    setSaving(true);
    setNotice("");
    try {
      const response = await fetch("/api/china-order-manager/receipts", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({
          requestId: receiptRequest.requestId,
          draftId,
          cycleMonth,
          lines: selected,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };
      if (!response.ok || body.ok !== true) {
        throw new Error(body.message || `입고확정 실패 (${response.status})`);
      }
      clearPendingReceiptRequest(receiptRequest);

      const receiptMessage = body.message || "입고확정을 완료했습니다.";
      let onSaleMessage = "";
      try {
        const onSale = await runInboundReceiptOnSaleSync(
          selected.map((line) => line.barcode),
          setNotice,
        );
        onSaleMessage = onSale.message;
      } catch (error) {
        onSaleMessage = `입고확정은 완료됐습니다. 다만 Shopling 판매중 자동전환 확인 과정은 실패했습니다. 재고·품절·판매재개 큐에서 다시 확인하세요: ${
          error instanceof Error ? error.message : "재시도 필요"
        }`;
      }

      if (
        fullReceipt &&
        (existingForwarderCostKrw <= 0 ||
          existingForwarderCostKrw !== actualForwarderCostKrw)
      ) {
        try {
          const costBody = await persistForwarderCost();
          setNotice(
            `${receiptMessage} ${costBody.message || "배송대행 비용과 실제 원가배수도 마감했습니다."} ${onSaleMessage}`,
          );
        } catch (error) {
          setNotice(
            `${receiptMessage} ${onSaleMessage} 다만 배송대행 비용·실제 원가 마감은 실패했습니다. 아래 입력값을 확인해 다시 저장하세요: ${
              error instanceof Error ? error.message : "재시도 필요"
            }`,
          );
          setExpanded(true);
          router.refresh();
          return;
        }
      } else {
        setNotice(`${receiptMessage} ${onSaleMessage}`);
      }
      setExpanded(false);
      router.refresh();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "입고확정을 완료하지 못했습니다.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-black text-emerald-800">
              {monthLabel(cycleMonth)} 사이클
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">
              월 1회 발주·입고
            </span>
            {forwarderCost.actualCostKrw ? (
              <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-black text-blue-800">
                실제 원가 마감완료
              </span>
            ) : null}
          </div>
          <h2 className="mt-3 text-lg font-black text-slate-950">
            {openLines.length ? "입고 처리" : "배송대행지 비용 · 실제 원가 마감"}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {openLines.length
              ? `${openLines.length.toLocaleString("ko-KR")} SKU · 남은 미입고 ${number.format(remainingTotal)}개. 전량 도착했다면 배송대행지 실제 청구 총액을 입력해 실제 원가배수까지 함께 마감하고, 일부만 왔다면 실제 도착수량만 수정하세요. 입고확정 후 재고가 생긴 품절상품은 Shopling 판매중 전환까지 자동으로 이어집니다.`
              : `입고수량은 모두 마감됐습니다. 배송대행지 실제 청구 총액으로 기존 임시 ${forwarderCost.estimatedMultiplier.toFixed(2)} 대신 실제 원가배수를 확정하세요.`}
          </p>
          <p className="mt-1 font-mono text-[11px] text-slate-400">{draftId}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {forwarderCost.actualCostKrw ? (
            <a
              href="/china-order-manager/price-review"
              className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-black text-blue-800 hover:bg-blue-100"
            >
              가격조정 검토
            </a>
          ) : null}
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-black text-white hover:bg-emerald-800"
          >
            {expanded
              ? "입력 닫기"
              : openLines.length
                ? "입고 처리 열기"
                : "배송대행 비용 · 원가 입력"}
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="mt-5 space-y-4">
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <CostMetric
                label="상품 총 매입금액"
                value={`${number.format(forwarderCost.productPurchaseCostKrw)}원`}
                note="상품대금만 · 중국내운임 제외"
              />
              <CostMetric
                label="중국내운임"
                value={`${number.format(forwarderCost.domesticChinaFreightKrw)}원`}
                note="원가배수 적용 후 SKU별 별도 가산"
              />
              <CostMetric
                label={`기존 ${forwarderCost.estimatedMultiplier.toFixed(2)} 추정 배대지 비용`}
                value={`${number.format(forwarderCost.estimatedForwarderCostKrw)}원`}
                note={`임시 예상 총지출 ${number.format(forwarderCost.estimatedTotalOutflowKrw)}원`}
              />
              <div className="rounded-lg border border-blue-200 bg-white p-3">
                <label
                  htmlFor={`forwarder-cost-${draftId}`}
                  className="block text-xs font-bold text-slate-600"
                >
                  배송대행지 실제비용(원)
                </label>
                <input
                  id={`forwarder-cost-${draftId}`}
                  type="number"
                  min={1}
                  max={1_000_000_000}
                  step={1}
                  value={forwarderCostInput}
                  onChange={(event) => setForwarderCostInput(event.target.value)}
                  placeholder="예: 907820"
                  className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-right font-black outline-none focus:border-blue-500"
                />
                <span className="mt-1 block text-[11px] text-slate-500">
                  관세·부가세·스티커 작업 등 최종 청구 총액
                </span>
              </div>
              <CostMetric
                label="실제 원가배수"
                value={
                  actualMultiplierPreview === null
                    ? "입력 대기"
                    : actualMultiplierPreview.toFixed(4)
                }
                note={
                  actualTotalOutflowKrw === null
                    ? "실제비용 입력 후 자동 계산"
                    : `실제 총지출 ${number.format(actualTotalOutflowKrw)}원`
                }
              />
            </div>
            <p className="mt-3 rounded-lg bg-white px-3 py-2 text-xs font-bold leading-5 text-blue-950">
              실제 원가배수 = (상품 총 매입금액 + 배송대행지 실제비용) ÷ 상품 총 매입금액. 최종 SKU 매입원가 = (상품원가 × 실제 원가배수) + 중국내운임. 이 확정원가는 Product Master와 가격조정 판단에 사용되지만, 실제 판매가격은 별도 승인 절차 없이 즉시 변경하지 않습니다.
            </p>
            {forwarderCost.closedAt ? (
              <p className="mt-2 text-xs text-blue-800">
                최근 마감 · {new Date(forwarderCost.closedAt).toLocaleString("ko-KR")}
              </p>
            ) : null}
            {!openLines.length ? (
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  disabled={saving || actualForwarderCostKrw <= 0}
                  onClick={() => void saveForwarderCost()}
                  className="rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {saving
                    ? "실제 원가 저장 중…"
                    : forwarderCost.actualCostKrw
                      ? "배송대행 비용 · 원가 수정 저장"
                      : "배송대행 비용 · 원가 마감"}
                </button>
              </div>
            ) : null}
          </div>

          {openLines.length ? (
            <>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={fillAll}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700"
                >
                  남은 수량 전부 채우기
                </button>
                <button
                  type="button"
                  onClick={clearAll}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700"
                >
                  전체 0으로 초기화
                </button>
                <span className="self-center text-xs font-bold text-emerald-800">
                  이번 입고 예정 · {number.format(selected.length)} SKU · {number.format(selectedQuantity)}개
                </span>
              </div>

              <div className="max-h-[560px] overflow-auto rounded-xl border border-slate-200">
                <table className="min-w-[980px] text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-slate-50 text-xs font-bold text-slate-500">
                    <tr>
                      <th className="px-3 py-3">B-code / 상품</th>
                      <th className="px-3 py-3">옵션</th>
                      <th className="px-3 py-3 text-right">실주문</th>
                      <th className="px-3 py-3 text-right">누적 입고</th>
                      <th className="px-3 py-3 text-right">남은 미입고</th>
                      <th className="px-3 py-3 text-right">이번 입고수량</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {openLines.map((line) => (
                      <tr key={line.barcode}>
                        <td className="px-3 py-3">
                          <strong className="font-mono text-slate-950">
                            {line.barcode}
                          </strong>
                          <span className="mt-1 block text-xs text-slate-600">
                            {[line.modelNo, line.modelName]
                              .filter(Boolean)
                              .join(" · ") || "상품정보 확인 중"}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-slate-700">
                          {line.saleOption || "-"}
                        </td>
                        <td className="px-3 py-3 text-right font-semibold">
                          {number.format(line.orderedQuantity)}
                        </td>
                        <td className="px-3 py-3 text-right font-semibold">
                          {number.format(line.receivedQuantity)}
                        </td>
                        <td className="px-3 py-3 text-right font-black text-blue-700">
                          {number.format(line.openQuantity)}
                        </td>
                        <td className="px-3 py-3 text-right">
                          <input
                            type="number"
                            min={0}
                            max={line.openQuantity}
                            step={1}
                            value={quantities[line.barcode] ?? 0}
                            onChange={(event) =>
                              setQuantities((current) => ({
                                ...current,
                                [line.barcode]: clamp(
                                  event.target.value,
                                  line.openQuantity,
                                ),
                              }))
                            }
                            className="w-28 rounded-lg border border-slate-300 px-2.5 py-2 text-right font-black outline-none focus:border-emerald-500"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                <p className="text-xs leading-5 text-emerald-950">
                  일부만 입력하면 PARTIALLY_RECEIVED, 남은 수량까지 모두 입고되면 RECEIVED로 자동 전환합니다. 입고확정 직후 정확재고가 1개 이상이고 Shopling 매핑이 정상인 품절상품은 판매중으로 자동 전환합니다. 차단·불확실 건은 억지로 재시도하지 않고 재고상태 예외 큐에 남깁니다. 전량 입고 시 배송대행지 실제비용으로 원가배수를 확정하고, 최종 SKU 매입원가는 (상품원가 × 실제 원가배수) + 중국내운임으로 Product Master에 연결합니다.
                </p>
                <button
                  type="button"
                  disabled={
                    saving ||
                    selectedQuantity <= 0 ||
                    (selectedQuantity === remainingTotal &&
                      actualForwarderCostKrw <= 0)
                  }
                  onClick={() => void confirmReceipt()}
                  className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {saving
                    ? "입고확정·판매재개 처리 중…"
                    : `입고확정 · ${number.format(selectedQuantity)}개`}
                </button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {notice ? (
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-700">
          {notice}
        </p>
      ) : null}
    </section>
  );
}

function CostMetric({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="rounded-lg border border-blue-200 bg-white p-3">
      <span className="block text-xs font-bold text-slate-600">{label}</span>
      <strong className="mt-2 block text-right text-base font-black text-slate-950">
        {value}
      </strong>
      <span className="mt-1 block text-[11px] text-slate-500">{note}</span>
    </div>
  );
}
