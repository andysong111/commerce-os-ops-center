"use client";

import { useState, type FormEvent } from "react";
import { isPurchaseDraftQuantityUnit } from "@/lib/purchaseDraftQuantityRounding";

export type ManualDraftCandidate = {
  barcode: string;
  modelNo: string;
  productName: string;
  optionName: string;
  inDraft: boolean;
  currentDraftQuantity: number;
  otherOpenQuantity: number;
};

type SearchResponse = {
  ok?: boolean;
  message?: string;
  candidates?: ManualDraftCandidate[];
};

export type StagedDraftAddition = ManualDraftCandidate & {
  targetQuantity: number;
};

function quantity(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

export function InternalChinaManualDraftLineAdder({
  draftId,
  status,
  stagedAdditions,
  onStagedAdditionsChange,
}: {
  draftId: string;
  status: "DRAFT" | "ORDERED";
  stagedAdditions: StagedDraftAddition[];
  onStagedAdditionsChange: (rows: StagedDraftAddition[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<ManualDraftCandidate[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [searching, setSearching] = useState(false);
  const [notice, setNotice] = useState("");

  const stagedByBarcode = new Map(
    stagedAdditions.map((row) => [row.barcode, row] as const),
  );
  const selectableCandidates = candidates.filter((candidate) => !candidate.inDraft);
  const selectedCandidates = selectableCandidates.filter(
    (candidate) => stagedByBarcode.has(candidate.barcode),
  );
  const allSelected =
    selectableCandidates.length > 0 &&
    selectableCandidates.every((candidate) => stagedByBarcode.has(candidate.barcode));
  const selectedTotalQuantity = selectedCandidates.reduce(
    (sum, candidate) =>
      sum + quantity(stagedByBarcode.get(candidate.barcode)?.targetQuantity ?? 5),
    0,
  );

  async function search(event?: FormEvent) {
    event?.preventDefault();
    const trimmed = query.trim();
    const terms = trimmed
      .split(/[,;\n\r]+/)
      .map((term) => term.trim())
      .filter((term) => term.length >= 2);
    if (!terms.length) {
      setNotice("검색어를 2글자 이상 입력하세요. 여러 개는 콤마로 구분할 수 있습니다.");
      return;
    }
    setSearching(true);
    setNotice("");
    try {
      const response = await fetch(
        `/api/china-order-manager/drafts/${encodeURIComponent(draftId)}/manual-lines?q=${encodeURIComponent(trimmed)}`,
        {
          method: "GET",
          headers: { accept: "application/json" },
          credentials: "same-origin",
          cache: "no-store",
        },
      );
      const body = (await response.json().catch(() => ({}))) as SearchResponse;
      if (!response.ok || !body.ok) {
        throw new Error(body.message || "추가할 상품 검색에 실패했습니다.");
      }
      const next = body.candidates ?? [];
      setCandidates(next);
      setQuantities((current) => {
        const output = { ...current };
        for (const candidate of next) {
          if (!output[candidate.barcode]) {
            output[candidate.barcode] =
              stagedByBarcode.get(candidate.barcode)?.targetQuantity ?? 5;
          }
        }
        return output;
      });
      setNotice(body.message || "검색을 완료했습니다.");
    } catch (error) {
      setCandidates([]);
      setNotice(
        error instanceof Error
          ? error.message
          : "추가할 상품 검색 요청이 일시적으로 실패했습니다.",
      );
    } finally {
      setSearching(false);
    }
  }

  function toggleAll(checked: boolean) {
    const visible = new Set(selectableCandidates.map((candidate) => candidate.barcode));
    const retained = stagedAdditions.filter((row) => !visible.has(row.barcode));
    if (!checked) {
      onStagedAdditionsChange(retained);
      return;
    }
    const additions = selectableCandidates.flatMap((candidate) => {
      const targetQuantity = quantity(quantities[candidate.barcode] ?? 5);
      return isPurchaseDraftQuantityUnit(targetQuantity)
        ? [{ ...candidate, targetQuantity }]
        : [];
    });
    onStagedAdditionsChange([...retained, ...additions]);
  }

  function toggleOne(barcode: string, checked: boolean) {
    const candidate = candidates.find((row) => row.barcode === barcode);
    if (!candidate || candidate.inDraft) return;
    const retained = stagedAdditions.filter((row) => row.barcode !== barcode);
    if (!checked) {
      onStagedAdditionsChange(retained);
      return;
    }
    const targetQuantity = quantity(quantities[barcode] ?? 5);
    if (!isPurchaseDraftQuantityUnit(targetQuantity)) {
      setNotice("추가수량은 5개 이상 9,995개 이하의 5개 단위로 입력하세요.");
      return;
    }
    onStagedAdditionsChange([...retained, { ...candidate, targetQuantity }]);
    setNotice(`${barcode} ${targetQuantity.toLocaleString("ko-KR")}개를 사용자 고정수량으로 재계산 대기에 넣었습니다.`);
  }

  function updateQuantity(candidate: ManualDraftCandidate, value: unknown) {
    const targetQuantity = quantity(value);
    setQuantities((current) => ({ ...current, [candidate.barcode]: targetQuantity }));
    if (!stagedByBarcode.has(candidate.barcode)) return;
    if (!isPurchaseDraftQuantityUnit(targetQuantity)) {
      onStagedAdditionsChange(
        stagedAdditions.filter((row) => row.barcode !== candidate.barcode),
      );
      setNotice(`${candidate.barcode}는 수량이 올바르지 않아 계산 대기에서 뺐습니다.`);
      return;
    }
    onStagedAdditionsChange(
      stagedAdditions.map((row) =>
        row.barcode === candidate.barcode ? { ...row, targetQuantity } : row,
      ),
    );
  }

  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50/70 p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="text-xs font-black tracking-[0.12em] text-amber-700">
            PURCHASE RUN · STEP 3
          </span>
          <h2 className="mt-1 text-xl font-black text-slate-950">주문품목 추가</h2>
          <p className="mt-2 max-w-5xl text-sm leading-6 text-slate-700">
            현재 Draft에 없는 상품을 검색해 체크하면 발주안 재계산 대기에 넣습니다. 입력한 수량은 사용자 고정수량으로 먼저 예산을 확보하며, 마지막 재계산 버튼을 누르기 전까지 기존 Draft와 주문·입고 원장은 바뀌지 않습니다.
          </p>
          <p className="mt-1 max-w-5xl text-xs font-bold leading-5 text-amber-800">
            고정수량을 반영하고 남은 예산을 자동 추천상품에 배분합니다. 고정수량만으로 한도를 넘으면 초안 교체를 막고 초과 이유를 보여줍니다.
          </p>
        </div>
        <span className="rounded-full border border-amber-300 bg-white px-3 py-1.5 text-xs font-black text-amber-800">
          사용자 고정수량 · 재계산 전 원장 미변경
        </span>
      </div>

      {status !== "DRAFT" ? (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-600">
          실제 주문 기록이 시작된 Draft라 추가 기능을 잠갔습니다.
        </div>
      ) : (
        <>
          <form onSubmit={(event) => void search(event)} className="mt-4 flex flex-col gap-2 md:flex-row">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="여러 개는 콤마로 구분 · 예: aaa288, aaa131, BAF1-1, 허리스트레칭"
              className="min-w-0 flex-1 rounded-xl border border-amber-300 bg-white px-4 py-3 text-sm font-semibold text-slate-900 outline-none focus:border-amber-500"
            />
            <button
              type="submit"
              disabled={searching}
              className="rounded-xl bg-amber-600 px-5 py-3 text-sm font-black text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {searching ? "검색 중..." : "추가할 B-code 검색"}
            </button>
          </form>

          {notice ? (
            <div className="mt-3 rounded-xl border border-amber-200 bg-white px-4 py-3 text-sm font-bold text-slate-800">
              {notice}
            </div>
          ) : null}

          {candidates.length ? (
            <div className="mt-4 overflow-hidden rounded-xl border border-amber-200 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-100 bg-amber-50/70 px-4 py-3">
                <div className="text-sm font-bold text-slate-700">
                  이 검색결과에서 계산 대기 <strong className="text-amber-800">{selectedCandidates.length}건</strong>
                  {selectedCandidates.length ? (
                    <span> · 총 {selectedTotalQuantity.toLocaleString("ko-KR")}개</span>
                  ) : null}
                </div>
                <span className="rounded-lg bg-white px-3 py-2 text-xs font-black text-amber-900">
                  전체 계산 대기 {stagedAdditions.length}종
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-[1040px] w-full text-left text-xs">
                  <thead className="border-b border-amber-100 bg-amber-50 font-black text-slate-600">
                    <tr>
                      <th className="w-14 px-3 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          disabled={!selectableCandidates.length}
                          onChange={(event) => toggleAll(event.target.checked)}
                          aria-label="추가 가능한 B-code 전체선택"
                          className="h-4 w-4 accent-amber-600"
                        />
                      </th>
                      <th className="px-3 py-3">B-code</th>
                      <th className="px-3 py-3">모델번호</th>
                      <th className="px-3 py-3">상품 / 옵션</th>
                      <th className="px-3 py-3 text-right">현재 Draft</th>
                      <th className="px-3 py-3 text-right">다른 미입고</th>
                      <th className="px-3 py-3 text-right">추가수량(고정)</th>
                      <th className="px-3 py-3">반영</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-amber-100">
                    {candidates.map((candidate) => (
                      <tr key={candidate.barcode} className="align-middle">
                        <td className="px-3 py-3 text-center">
                          <input
                            type="checkbox"
                            checked={stagedByBarcode.has(candidate.barcode) && !candidate.inDraft}
                            disabled={candidate.inDraft}
                            onChange={(event) =>
                              toggleOne(candidate.barcode, event.target.checked)
                            }
                            aria-label={`${candidate.barcode} 일괄 추가 선택`}
                            className="h-4 w-4 accent-amber-600"
                          />
                        </td>
                        <td className="px-3 py-3 font-black text-slate-950">{candidate.barcode}</td>
                        <td className="px-3 py-3 font-semibold text-slate-700">{candidate.modelNo || "-"}</td>
                        <td className="max-w-[360px] px-3 py-3">
                          <strong className="block text-slate-900">{candidate.productName}</strong>
                          <span className="mt-1 block text-slate-500">옵션 · {candidate.optionName || "단품"}</span>
                        </td>
                        <td className="px-3 py-3 text-right font-bold text-slate-700">
                          {candidate.inDraft ? `${candidate.currentDraftQuantity.toLocaleString("ko-KR")}개` : "없음"}
                        </td>
                        <td className={`px-3 py-3 text-right font-black ${candidate.otherOpenQuantity > 0 ? "text-rose-700" : "text-slate-400"}`}>
                          {candidate.otherOpenQuantity > 0 ? `${candidate.otherOpenQuantity.toLocaleString("ko-KR")}개` : "0"}
                        </td>
                        <td className="px-3 py-3 text-right">
                          <input
                            type="number"
                            min={5}
                            max={9995}
                            step={5}
                            value={stagedByBarcode.get(candidate.barcode)?.targetQuantity ?? quantities[candidate.barcode] ?? 5}
                            disabled={candidate.inDraft}
                            onChange={(event) => updateQuantity(candidate, event.target.value)}
                            className="w-28 rounded-lg border border-amber-300 px-3 py-2 text-right font-black text-slate-900 outline-none focus:border-amber-500 disabled:bg-slate-100 disabled:text-slate-400"
                          />
                        </td>
                        <td className="px-3 py-3">
                          <span className={`inline-flex rounded-lg px-3 py-2 font-black ${candidate.inDraft ? "bg-slate-100 text-slate-500" : stagedByBarcode.has(candidate.barcode) ? "bg-amber-100 text-amber-900" : "bg-slate-50 text-slate-500"}`}>
                            {candidate.inDraft
                              ? "아래 주문표에서 수정"
                              : stagedByBarcode.has(candidate.barcode)
                                ? "고정·재계산 대기"
                                : "체크하면 대기"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
