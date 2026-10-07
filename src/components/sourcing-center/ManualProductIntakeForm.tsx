"use client";

import { useRef, useState } from "react";
import type { FormEvent } from "react";

type Result = {
  ok?: boolean;
  code?: string;
  message?: string;
  conceptId?: string;
  duplicate?: boolean;
  productName?: string;
};

type StorageSize = "" | "S" | "L";

type ManualProductDraft = {
  id: string;
  sourceUrl: string;
  productName: string;
  storageSize: StorageSize;
  unitPriceCny: string;
  moq: string;
  supplierName: string;
  chinaOption: string;
  error: string;
};

type StagedCandidate = {
  conceptId: string;
  productName: string;
  storageSize: "S" | "L";
};

type Props = {
  embedded?: boolean;
  formId?: string;
  calculationFormId?: string;
  knownCandidateIds?: string[];
};

function emptyDraft(id: string): ManualProductDraft {
  return {
    id,
    sourceUrl: "",
    productName: "",
    storageSize: "",
    unitPriceCny: "",
    moq: "",
    supplierName: "",
    chinaOption: "",
    error: "",
  };
}

function optionalNumber(value: string) {
  const trimmed = value.trim();
  return trimmed ? Number(trimmed) : null;
}

export function ManualProductIntakeForm({ embedded = false, formId, calculationFormId, knownCandidateIds = [] }: Props) {
  const rowSequence = useRef(1);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [failed, setFailed] = useState(false);
  const [rows, setRows] = useState<ManualProductDraft[]>(() => [emptyDraft("manual-product-1")]);
  const [stagedCandidates, setStagedCandidates] = useState<StagedCandidate[]>([]);

  function nextDraft() {
    rowSequence.current += 1;
    return emptyDraft(`manual-product-${rowSequence.current}`);
  }

  function addRow() {
    setRows((current) => [...current, nextDraft()]);
    setNotice("");
    setFailed(false);
  }

  function removeRow(id: string) {
    setRows((current) => current.filter((row) => row.id !== id));
    setNotice("");
    setFailed(false);
  }

  function updateRow<K extends keyof Omit<ManualProductDraft, "id">>(id: string, key: K, value: ManualProductDraft[K]) {
    setRows((current) => current.map((row) => row.id === id ? { ...row, [key]: value, error: "" } : row));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submittedRows = rows.map((row) => ({ ...row, error: "" }));
    setBusy(true);
    setNotice("");
    setFailed(false);

    const failedRows: ManualProductDraft[] = [];
    const stagedByConceptId = new Map<string, StagedCandidate>();
    let completedCount = 0;
    let alreadyListedCount = 0;

    for (let index = 0; index < submittedRows.length; index += 1) {
      const row = submittedRows[index];
      setNotice(`상품 ${index + 1}/${submittedRows.length} 후보 추가 중...`);
      try {
        const response = await fetch("/api/sourcing-center/manual-product", {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({
            sourceUrl: row.sourceUrl,
            productName: row.productName,
            storageSize: row.storageSize,
            unitPriceCny: optionalNumber(row.unitPriceCny),
            moq: optionalNumber(row.moq),
            supplierName: row.supplierName,
            chinaOption: row.chinaOption,
          }),
        });
        const result = await response.json().catch(() => ({})) as Result;
        if (!response.ok || !result.ok) {
          failedRows.push({ ...row, error: result.message || `후보 저장 실패 · ${result.code || response.status}` });
          continue;
        }

        const conceptId = String(result.conceptId ?? "").trim();
        const productName = result.productName || row.productName || "신규상품";
        if (calculationFormId && !conceptId) {
          failedRows.push({ ...row, error: "후보는 저장됐지만 계산 목록 식별값을 확인하지 못했습니다. 화면을 새로고침한 뒤 다시 시도하세요." });
          continue;
        }

        completedCount += 1;
        if (calculationFormId && conceptId) {
          if (knownCandidateIds.includes(conceptId)) {
            alreadyListedCount += 1;
          } else {
            stagedByConceptId.set(conceptId, {
              conceptId,
              productName,
              storageSize: row.storageSize as "S" | "L",
            });
          }
        }
      } catch {
        failedRows.push({ ...row, error: "소싱엔진에 연결하지 못했습니다. 주문이나 결제는 실행되지 않았습니다." });
      }
    }

    if (stagedByConceptId.size) {
      setStagedCandidates((current) => {
        const merged = new Map(current.map((candidate) => [candidate.conceptId, candidate]));
        for (const [conceptId, candidate] of stagedByConceptId) merged.set(conceptId, candidate);
        return [...merged.values()];
      });
    }

    setRows(failedRows.length ? failedRows : [nextDraft()]);
    if (failedRows.length) {
      setFailed(true);
      setNotice(`${completedCount}종 추가 완료 · ${failedRows.length}종 실패. 실패한 입력만 남겨두었습니다.`);
    } else if (calculationFormId) {
      const listedMessage = alreadyListedCount ? ` · 기존 후보 ${alreadyListedCount}종은 왼쪽 목록에서 선택` : "";
      setNotice(`${completedCount}종 후보 추가 완료${listedMessage}. 아직 발주안은 계산하지 않았습니다.`);
    } else {
      setNotice(`${completedCount}종 후보를 저장했습니다. 자동 검증을 통과하면 다음 발주 준비 화면에 나타납니다.`);
    }
    setBusy(false);
  }

  return (
    <form id={formId} onSubmit={submit} aria-busy={busy} className={embedded ? "min-w-0 bg-white py-5 xl:border-l xl:border-slate-200 xl:pl-6" : "border-y border-slate-200 bg-white py-5"}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black text-emerald-700">직접 신규상품 추가</p>
          {embedded
            ? <h3 className="mt-1 text-lg font-black text-slate-950">1688 링크 일괄 후보 등록</h3>
            : <h2 className="mt-1 text-xl font-black text-slate-950">1688 링크 일괄 후보 등록</h2>}
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            상품별 링크·모델명·수납 위치를 입력한 뒤 한 번에 후보로 추가하세요. B코드·모델번호·상품출시 카드는 발주 Draft에 최종 포함될 때 생성되며, 여기서는 주문·결제를 실행하지 않습니다.
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">입력 중 {rows.length}종</span>
      </div>

      <div className="mt-5 divide-y divide-slate-200 border-y border-slate-200">
        {rows.map((row, index) => (
          <fieldset key={row.id} className="min-w-0 py-5" disabled={busy}>
            <legend className="sr-only">신규상품 입력 {index + 1}</legend>
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-black text-slate-950">상품 {index + 1}</p>
              {rows.length > 1 ? (
                <button type="button" onClick={() => removeRow(row.id)} className="text-xs font-bold text-slate-600 underline hover:text-rose-700">입력 삭제</button>
              ) : null}
            </div>

            <div className={`mt-3 grid gap-4 ${embedded ? "md:grid-cols-2" : "lg:grid-cols-2"}`}>
              <label className="text-sm font-bold text-slate-900">
                1688 상품 링크
                <input data-manual-source-url name="sourceUrl" value={row.sourceUrl} onChange={(event) => updateRow(row.id, "sourceUrl", event.target.value)} type="url" required placeholder="https://detail.1688.com/offer/...html" className="mt-2 block min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2" />
              </label>
              <label className="text-sm font-bold text-slate-900">
                상품명·모델명
                <input name="productName" value={row.productName} onChange={(event) => updateRow(row.id, "productName", event.target.value)} required maxLength={240} placeholder="예: 접이식 주방 수납선반" className="mt-2 block min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2" />
              </label>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:items-start">
              <fieldset>
                <legend className="text-sm font-black text-slate-900">수납 공간</legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold"><input type="radio" name={`storageSize.${row.id}`} value="S" checked={row.storageSize === "S"} onChange={() => updateRow(row.id, "storageSize", "S")} required />소형 수납</label>
                  <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold"><input type="radio" name={`storageSize.${row.id}`} value="L" checked={row.storageSize === "L"} onChange={() => updateRow(row.id, "storageSize", "L")} required />대형 수납</label>
                </div>
              </fieldset>

              <details className="border-t border-slate-100 pt-3 text-sm lg:border-t-0 lg:pt-0">
                <summary className="cursor-pointer font-bold text-slate-700">알고 있는 공급정보 추가</summary>
                <div className="mt-3 grid gap-4 md:grid-cols-2">
                  <label className="font-bold">1688 단가(위안)<input name="unitPriceCny" value={row.unitPriceCny} onChange={(event) => updateRow(row.id, "unitPriceCny", event.target.value)} type="number" min="0.01" step="0.01" className="mt-2 block min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
                  <label className="font-bold">최소주문수량<input name="moq" value={row.moq} onChange={(event) => updateRow(row.id, "moq", event.target.value)} type="number" min="1" step="1" className="mt-2 block min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
                  <label className="font-bold">중국 옵션<input name="chinaOption" value={row.chinaOption} onChange={(event) => updateRow(row.id, "chinaOption", event.target.value)} maxLength={300} className="mt-2 block min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
                  <label className="font-bold">공급업체명<input name="supplierName" value={row.supplierName} onChange={(event) => updateRow(row.id, "supplierName", event.target.value)} maxLength={200} className="mt-2 block min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
                </div>
              </details>
            </div>

            {row.error ? <p role="alert" className="mt-3 border-l-4 border-rose-500 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-800">{row.error}</p> : null}
          </fieldset>
        ))}
      </div>

      <button type="button" onClick={addRow} disabled={busy} className="mt-4 min-h-11 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-black text-slate-800 hover:border-slate-500 disabled:cursor-wait disabled:opacity-50">
        + 입력항목(상품) 추가
      </button>

      {calculationFormId && stagedCandidates.length ? (
        <section className="mt-5 border-y border-emerald-200 bg-emerald-50 px-3 py-3" aria-label="계산 대기 수동 후보">
          <p className="text-xs font-black text-emerald-900">계산 대기 수동 후보 {stagedCandidates.length}종</p>
          <div className="mt-2 grid gap-2">
            {stagedCandidates.map((candidate) => (
              <div key={candidate.conceptId} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0"><strong className="block truncate">{candidate.productName}</strong><span className="text-xs text-emerald-800">{candidate.storageSize === "S" ? "소형 수납" : "대형 수납"}</span></span>
                <button type="button" onClick={() => setStagedCandidates((current) => current.filter((item) => item.conceptId !== candidate.conceptId))} className="shrink-0 text-xs font-bold text-slate-600 underline">목록에서 제외</button>
                <input type="hidden" name="source" value={candidate.conceptId} form={calculationFormId} />
                <input type="hidden" name={`storage.${candidate.conceptId}`} value={candidate.storageSize} form={calculationFormId} />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-4">
        <button type="submit" disabled={busy} className="min-h-11 rounded-lg bg-emerald-700 px-5 py-2 text-sm font-black text-white hover:bg-emerald-800 disabled:cursor-wait disabled:bg-slate-300">
          {busy ? "일괄 후보 추가 중..." : calculationFormId ? `입력한 상품 ${rows.length}종 후보 목록에 추가` : `입력한 상품 ${rows.length}종 후보 저장`}
        </button>
        {notice ? <p role={failed ? "alert" : "status"} className={`text-sm font-bold ${failed ? "text-rose-700" : "text-emerald-800"}`}>{notice}</p> : null}
      </div>
    </form>
  );
}
