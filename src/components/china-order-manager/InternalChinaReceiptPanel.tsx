"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  receiptRequestFingerprint,
  receiptRequestStorageKey,
  validReceiptRequestId,
} from "@/domain/china-receipt-request";
import type { InternalChinaForwarderCostSummary } from "@/lib/internalChinaForwarderCost";
import { toFreightImageProxyUrl } from "@/lib/freightImageProxy";
import { runInboundReceiptOnSaleSync } from "@/lib/inboundReceiptOnSaleSync";
import { worldFirstFeeLabel } from "@/lib/productDecisionEngine/purchaseCostPolicy";

export type InternalChinaReceiptPanelLine = {
  barcode: string;
  modelNo: string;
  modelName: string;
  saleOption: string;
  imageUrl: string;
  orderedQuantity: number;
  receivedQuantity: number;
  openQuantity: number;
  status: string;
  ondolpassExpectedQuantity: number | null;
  ondolpassReceivedQuantity: number | null;
  ondolpassRowCount: number;
  ondolpassReceivedRowCount: number;
  ondolpassPendingRowCount: number;
  ondolpassDisposedRowCount: number;
  ondolpassMismatchCount: number;
  suggestedReceiptQuantity: number | null;
};

type ReceiptObservationSummary = {
  observedAt: string;
  snapshotHash: string;
  rowCount: number;
  receivedRowCount: number;
  pendingRowCount: number;
  disposedRowCount: number;
  mismatchCount: number;
  expectedQuantity: number;
  displayedQuantity: number;
  observedReceivedQuantity: number;
  complete: boolean;
  issues: string[];
};

const number = new Intl.NumberFormat("ko-KR");

function ProductThumbnail({
  imageUrl,
  label,
}: {
  imageUrl: string;
  label: string;
}) {
  const [failed, setFailed] = useState(false);
  const proxyUrl = toFreightImageProxyUrl(imageUrl);
  if (!proxyUrl || failed) {
    return (
      <span className="grid size-12 shrink-0 place-items-center rounded-lg border border-dashed border-slate-300 bg-slate-50 px-1 text-center text-[10px] font-bold leading-4 text-slate-400">
        이미지 없음
      </span>
    );
  }
  return (
    <Image
      src={proxyUrl}
      alt={`${label} 상품 이미지`}
      width={48}
      height={48}
      loading="lazy"
      unoptimized
      onError={() => setFailed(true)}
      className="size-12 shrink-0 rounded-lg border border-slate-200 bg-white object-contain"
    />
  );
}

type ReceiptLineViewState = "COMPLETE" | "PARTIAL" | "PENDING" | "REVIEW";

function receiptLineViewState(line: InternalChinaReceiptPanelLine): ReceiptLineViewState {
  if (line.ondolpassMismatchCount > 0 || line.ondolpassDisposedRowCount > 0) {
    return "REVIEW";
  }
  if (
    line.ondolpassRowCount > 0 &&
    line.ondolpassReceivedRowCount === line.ondolpassRowCount &&
    line.ondolpassPendingRowCount === 0 &&
    (line.ondolpassReceivedQuantity ?? 0) > 0
  ) {
    return "COMPLETE";
  }
  if (
    line.ondolpassReceivedRowCount > 0 ||
    (line.ondolpassReceivedQuantity ?? 0) > 0
  ) {
    return "PARTIAL";
  }
  return "PENDING";
}

function observationIssueLabel(issue: string) {
  const parts = issue.split(":");
  if (parts[0] === "QUANTITY_MISMATCH" && parts.length >= 5) {
    return `신청 ${parts[1]} · ${parts[2]}행: 기준 ${number.format(Number(parts[3]))}개보다 현재 표시 ${number.format(Number(parts[4]))}개가 큽니다.`;
  }
  if (parts[0] === "ORDER_NO_MISMATCH" && parts.length >= 3) {
    return `신청 ${parts[1]} · ${parts[2]}행: 1688 주문번호가 바코드 완료 근거와 다릅니다.`;
  }
  return "바코드 완료 근거와 온돌패스 현재 정보가 달라 자동 입력에서 제외했습니다.";
}

function ReceiptLineTable({
  lines,
  quantities,
  onQuantityChange,
  tone,
}: {
  lines: InternalChinaReceiptPanelLine[];
  quantities: Record<string, number>;
  onQuantityChange: (barcode: string, quantity: number) => void;
  tone: "attention" | "complete";
}) {
  if (!lines.length) return null;
  return (
    <div
      className={`overflow-hidden rounded-xl border ${
        tone === "complete"
          ? "border-emerald-200 bg-emerald-50/30"
          : "border-amber-200 bg-amber-50/20"
      }`}
    >
      <table className="w-full table-fixed text-left text-sm">
        <colgroup>
          <col className="w-[44%]" />
          <col className="w-[18%]" />
          <col className="w-[22%]" />
          <col className="w-[16%]" />
        </colgroup>
        <thead className="bg-white/80 text-[11px] font-bold text-slate-500">
          <tr>
            <th className="px-3 py-2">상품 · 옵션</th>
            <th className="px-2 py-2 text-right">OPS 수량</th>
            <th className="px-2 py-2 text-right">온돌패스 확인</th>
            <th className="px-3 py-2 text-right">이번 입고</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {lines.map((line) => {
            const state = receiptLineViewState(line);
            const badge = state === "COMPLETE"
              ? "입고 감지완료"
              : state === "PARTIAL"
                ? "부분입고"
                : state === "REVIEW"
                  ? "근거 확인필요"
                  : line.ondolpassReceivedQuantity === null
                    ? "미확인"
                    : "미입고";
            const badgeClass = state === "COMPLETE"
              ? "bg-emerald-100 text-emerald-800"
              : state === "PARTIAL"
                ? "bg-amber-100 text-amber-800"
                : state === "REVIEW"
                  ? "bg-rose-100 text-rose-800"
                  : "bg-slate-100 text-slate-600";
            return (
              <tr key={line.barcode} className="align-middle">
                <td className="px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <ProductThumbnail
                      key={line.imageUrl || line.barcode}
                      imageUrl={line.imageUrl}
                      label={line.modelName || line.barcode}
                    />
                    <div className="min-w-0 leading-4">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <strong className="font-mono text-slate-950">{line.barcode}</strong>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${badgeClass}`}>
                          {badge}
                        </span>
                      </div>
                      <span className="mt-0.5 block truncate text-xs font-bold text-slate-700">
                        모델명 · {line.modelName || "정보 없음"}
                      </span>
                      <span className="block truncate text-[11px] text-slate-600">
                        모델번호 · {line.modelNo || "정보 없음"}
                      </span>
                      <span className="block truncate text-[11px] text-slate-500">
                        옵션 · {line.saleOption || "-"}
                      </span>
                    </div>
                  </div>
                </td>
                <td className="px-2 py-2 text-right text-[11px] leading-5 text-slate-600">
                  <span className="block">주문 {number.format(line.orderedQuantity)}</span>
                  <span className="block">누적 {number.format(line.receivedQuantity)}</span>
                  <strong className="block text-blue-700">미입고 {number.format(line.openQuantity)}</strong>
                </td>
                <td className="px-2 py-2 text-right text-xs">
                  {line.ondolpassReceivedQuantity === null ? (
                    <span className="text-slate-400">아직 확인하지 않음</span>
                  ) : (
                    <>
                      <strong className={state === "COMPLETE" ? "block text-emerald-700" : "block text-cyan-800"}>
                        {number.format(line.ondolpassReceivedQuantity)} / {number.format(line.ondolpassExpectedQuantity ?? 0)}개
                      </strong>
                      <span className="mt-0.5 block text-[11px] text-slate-500">
                        {line.ondolpassReceivedRowCount}/{line.ondolpassRowCount}행
                        {line.ondolpassDisposedRowCount ? ` · 폐기 ${line.ondolpassDisposedRowCount}` : ""}
                        {line.ondolpassMismatchCount ? ` · 불일치 ${line.ondolpassMismatchCount}` : ""}
                      </span>
                    </>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  <input
                    aria-label={`${line.barcode} 이번 입고수량`}
                    type="number"
                    min={0}
                    max={line.openQuantity}
                    step={1}
                    value={quantities[line.barcode] ?? 0}
                    onChange={(event) => onQuantityChange(
                      line.barcode,
                      clamp(event.target.value, line.openQuantity),
                    )}
                    className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-right font-black outline-none focus:border-emerald-500"
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

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
  invoiceAmount,
  lines,
  forwarderCost,
  observation,
}: {
  draftId: string;
  cycleMonth: string;
  invoiceAmount?: number | null;
  lines: InternalChinaReceiptPanelLine[];
  forwarderCost: InternalChinaForwarderCostSummary;
  observation: ReceiptObservationSummary | null;
}) {
  const router = useRouter();
  const openLines = useMemo(
    () => lines.filter((line) => line.openQuantity > 0),
    [lines],
  );
  const observedCompleteLines = useMemo(
    () => openLines.filter((line) => receiptLineViewState(line) === "COMPLETE"),
    [openLines],
  );
  const attentionLines = useMemo(
    () => openLines.filter((line) => receiptLineViewState(line) !== "COMPLETE"),
    [openLines],
  );
  const partialLineCount = attentionLines.filter(
    (line) => receiptLineViewState(line) === "PARTIAL",
  ).length;
  const pendingLineCount = attentionLines.filter(
    (line) => receiptLineViewState(line) === "PENDING",
  ).length;
  const reviewLineCount = attentionLines.filter(
    (line) => receiptLineViewState(line) === "REVIEW",
  ).length;
  const [expanded, setExpanded] = useState(
    () => openLines.length > 0 || !forwarderCost.actualCostKrw,
  );
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      openLines.map((line) => [
        line.barcode,
        line.suggestedReceiptQuantity ?? line.openQuantity,
      ]),
    ),
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
  const actualForwarderCostKrw = invoiceAmount === undefined ? won(forwarderCostInput) : invoiceAmount ?? 0;
  const existingForwarderCostKrw = forwarderCost.actualCostKrw ?? 0;
  const actualMultiplierPreview =
    actualForwarderCostKrw > 0 && forwarderCost.orderPaymentCostKrw > 0
      ? (forwarderCost.orderPaymentCostKrw + actualForwarderCostKrw) /
        forwarderCost.orderPaymentCostKrw
      : null;
  const actualTotalOutflowKrw =
    actualForwarderCostKrw > 0
      ? forwarderCost.orderPaymentCostKrw + actualForwarderCostKrw
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

  function fillObserved() {
    setQuantities(
      Object.fromEntries(
        openLines.map((line) => [
          line.barcode,
          line.suggestedReceiptQuantity ?? 0,
        ]),
      ),
    );
    setNotice("최근 온돌패스 확인값 중 완료 근거와 일치한 수량만 채웠습니다.");
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
        `${monthLabel(cycleMonth)} 배송대행지 실제비용 ${number.format(actualForwarderCostKrw)}원을 반영해 실제 한국 도착 원가배수를 확정할까요?\n\n결제원가 = 1688 실결제 + 월드퍼스트 콰징바오 수수료\n실제 도착 원가배수 = (결제원가 + 배송대행지 실제비용) ÷ 결제원가\n최종 SKU 매입원가 = SKU별 결제원가 × 실제 도착 원가배수\n\n이 확정원가는 이후 가격조정 판단에 사용되며, 실제 판매가는 별도 승인 절차 없이 즉시 변경하지 않습니다.`,
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
      ? "입고수량을 원장과 Product Master에 반영한 뒤 실제 원가배수를 계산합니다. 정확재고가 1개 이상이고 Shopling 매핑이 정상인 입고 품목은 곧바로 판매중 자동전환까지 이어집니다. SKU 최종 매입원가는 결제수수료를 포함한 주문원가에 실제 도착 원가배수를 적용해 확정되고 이후 가격조정 판단의 원가로 이어집니다."
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
              발주차시별 입고
            </span>
            {forwarderCost.actualCostKrw ? (
              <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-black text-blue-800">
                실제 비용 저장됨
              </span>
            ) : null}
            {observation ? (
              <span className="rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-1 text-xs font-black text-cyan-800">
                온돌패스 {number.format(observation.receivedRowCount)}/{number.format(observation.rowCount)}행 입고
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
          {observation ? (
            <p className="mt-2 text-xs leading-5 text-cyan-800">
              최근 자동확인 · {new Date(observation.observedAt).toLocaleString("ko-KR", {
                timeZone: "Asia/Seoul",
              })} · 입고 {number.format(observation.observedReceivedQuantity)} / 근거 {number.format(observation.expectedQuantity)}개
              {observation.pendingRowCount
                ? ` · 대기 ${number.format(observation.pendingRowCount)}행`
                : ""}
              {observation.disposedRowCount
                ? ` · 폐기 ${number.format(observation.disposedRowCount)}행`
                : ""}
              {observation.mismatchCount
                ? ` · 근거 불일치 ${number.format(observation.mismatchCount)}행`
                : ""}
            </p>
          ) : (
            <p className="mt-2 text-xs leading-5 text-slate-500">
              업무센터의 11-2 입고현황 확인을 실행하면 온돌패스에서 확인된 수량이 이 입력칸에 준비됩니다.
            </p>
          )}
          {observation?.mismatchCount ? (
            <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-900">
              <strong className="block">근거 불일치란?</strong>
              <span>
                신청번호·행번호는 찾았지만 1688 주문번호가 다르거나, 온돌패스 표시수량이 바코드 완료 기준수량보다 큰 경우입니다. 정상 부분입고(1개 이상·기준수량 이하)는 불일치로 보지 않습니다.
              </span>
              {observation.issues
                .filter((issue) => issue.startsWith("QUANTITY_MISMATCH:") || issue.startsWith("ORDER_NO_MISMATCH:"))
                .slice(0, 3)
                .map((issue) => (
                  <span key={issue} className="block font-bold">· {observationIssueLabel(issue)}</span>
                ))}
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {forwarderCost.actualCostKrw ? (
            <a
              href={`/china-order-manager?month=${encodeURIComponent(cycleMonth)}#monthly-price`}
              className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-black text-blue-800 hover:bg-blue-100"
            >
              월 가격조정으로 이동
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
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
              <CostMetric
                label="상품 총 매입금액"
                value={`${number.format(forwarderCost.productPurchaseCostKrw)}원`}
                note="상품대금만 · 중국내운임 제외"
              />
              <CostMetric
                label="중국내운임"
                value={`${number.format(forwarderCost.domesticChinaFreightKrw)}원`}
                note="1688 실결제에 포함 · 가감 반영"
              />
              <CostMetric
                label={worldFirstFeeLabel(forwarderCost.paymentFeeMultiplier)}
                value={`${number.format(forwarderCost.paymentFeeCostKrw)}원`}
                note={`내부환율 기준 · 결제원가 ${number.format(forwarderCost.orderPaymentCostKrw)}원`}
              />
                <CostMetric
                  label={forwarderCost.actualCostKrw ? "확정 배송대행비" : "추정 배송대행비"}
                  value={`${number.format(forwarderCost.actualCostKrw ?? forwarderCost.estimatedForwarderCostKrw)}원`}
                  note={forwarderCost.actualCostKrw
                    ? `확정 도착 총액 ${number.format(forwarderCost.actualTotalOutflowKrw ?? 0)}원`
                    : `예상 도착 총액 ${number.format(forwarderCost.estimatedTotalOutflowKrw)}원 · 결제원가 ×${forwarderCost.estimatedMultiplier.toFixed(2)}`}
                />
              <div className="rounded-lg border border-blue-200 bg-white p-3">
                {invoiceAmount !== undefined ? (
                  <a href="#purchase-run-forwarder-cost" className="text-sm font-bold text-blue-800 underline">
                    {invoiceAmount ? `5번에 저장한 청구액 ${number.format(invoiceAmount)}원` : "5번에서 청구액 입력"}
                  </a>
                ) : (<>
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
                </>)}
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
              결제원가 = 1688 실결제(서비스비 포함) + 월드퍼스트 콰징바오 수수료. 실제 도착 원가배수 = (결제원가 + 배송대행지 실제비용) ÷ 결제원가. 최종 SKU 매입원가는 SKU별 결제원가 × 실제 도착 원가배수로 확정합니다. 이 확정원가는 Product Master와 가격조정 판단에 사용되지만, 실제 판매가격은 별도 승인 절차 없이 즉시 변경하지 않습니다.
            </p>
            {forwarderCost.closedAt ? (
              <p className="mt-2 text-xs text-blue-800">
                최근 마감 · {new Date(forwarderCost.closedAt).toLocaleString("ko-KR", {
                  timeZone: "Asia/Seoul",
                })}
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
                {observation ? (
                  <button
                    type="button"
                    onClick={fillObserved}
                    className="rounded-lg border border-cyan-300 bg-cyan-50 px-3 py-2 text-xs font-black text-cyan-800"
                  >
                    온돌패스 확인수량 채우기
                  </button>
                ) : null}
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

              <div className="space-y-3">
                {attentionLines.length ? (
                  <section aria-labelledby={`receipt-attention-${draftId}`}>
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 id={`receipt-attention-${draftId}`} className="font-black text-amber-950">
                          확인이 필요한 품목 · {number.format(attentionLines.length)}개
                        </h3>
                        <p className="text-[11px] text-amber-800">
                          미입고 {number.format(pendingLineCount)} · 부분입고 {number.format(partialLineCount)} · 근거확인 {number.format(reviewLineCount)}
                        </p>
                      </div>
                    </div>
                    <ReceiptLineTable
                      lines={attentionLines}
                      quantities={quantities}
                      onQuantityChange={(barcode, quantity) => setQuantities((current) => ({
                        ...current,
                        [barcode]: quantity,
                      }))}
                      tone="attention"
                    />
                  </section>
                ) : null}

                {observedCompleteLines.length ? (
                  <section aria-labelledby={`receipt-complete-${draftId}`}>
                    <div className="mb-2">
                      <h3 id={`receipt-complete-${draftId}`} className="font-black text-emerald-900">
                        입고 감지완료 품목 · {number.format(observedCompleteLines.length)}개
                      </h3>
                      <p className="text-[11px] text-emerald-700">
                        온돌패스에서 모든 신청행에 입고수량이 확인된 품목입니다. 실제 재고 반영은 아래 입고확정 버튼을 눌러야 완료됩니다.
                      </p>
                    </div>
                    <ReceiptLineTable
                      lines={observedCompleteLines}
                      quantities={quantities}
                      onQuantityChange={(barcode, quantity) => setQuantities((current) => ({
                        ...current,
                        [barcode]: quantity,
                      }))}
                      tone="complete"
                    />
                  </section>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                <p className="text-xs leading-5 text-emerald-950">
                  일부만 입력하면 PARTIALLY_RECEIVED, 남은 수량까지 모두 입고되면 RECEIVED로 자동 전환합니다. 입고확정 직후 정확재고가 1개 이상이고 Shopling 매핑이 정상인 품절상품은 판매중으로 자동 전환합니다. 차단·불확실 건은 억지로 재시도하지 않고 재고상태 예외 큐에 남깁니다. 전량 입고 시 결제수수료를 포함한 주문원가에 배송대행지 실제비용을 반영해 최종 SKU 매입원가를 Product Master에 연결합니다.
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
