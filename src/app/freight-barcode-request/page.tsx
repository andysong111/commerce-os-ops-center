"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { parseFreightApplicationText } from "@/lib/freightApplicationParser";
import { findProductByModelNoOrModelName } from "@/lib/productMaster";
import type {
  FreightApplication,
  FreightApplicationItem,
} from "@/types/freightBarcodeRequest";

const SAMPLE_TEXT = `신청번호:642247

제품정보:(1)
품목: Poultry Drinker
옵션(색상,사이즈): 产品规格: 固定螺丝水碗
상품상세url: https://detail.1688.com/offer/552689871722.html
hs_code: 3926909000
단가: 0.61
수량: 300
오픈마켓 주문번호: 3306760070065591852

제품정보:(2)
품목: Key Ring
옵션(색상,사이즈): 颜色: 金色
상품상세url: https://detail.1688.com/offer/710684525681.html
hs_code: 7326209000
단가: 0.35
수량: 200
오픈마켓 주문번호: 3307376352586591852

제품정보:(3)
품목: Key Ring
옵션(색상,사이즈): 颜色: 银色
상품상세url: https://detail.1688.com/offer/710684525681.html
hs_code: 7326209000
단가: 0.35
수량: 200
오픈마켓 주문번호: 3307376352586591852

제품정보:(4)
품목: Key Ring
옵션(색상,사이즈): 颜色: 哑枪
상품상세url: https://detail.1688.com/offer/710684525681.html
hs_code: 7326209000
단가: 0.35
수량: 200
오픈마켓 주문번호: 3307376352586591852`;

const CHINESE_MESSAGE = `请查看附件PDF。
请按照PDF里的序号、商品图片、规格和数量进行条码/原产地标签粘贴。
相同商品但不同颜色或规格的，请务必分开处理。
如有不清楚的地方，请先联系我确认后再操作。`;

const EMPTY_APPLICATION: FreightApplication = { applicationNo: "", items: [] };
const NO_ITEMS_WARNING =
  "분석된 품목이 없습니다. 제품정보 영역을 조금 더 넓게 복사하거나, 표의 번호/사진/수량/품목/옵션/오더번호 영역을 함께 복사해주세요.";

export default function FreightBarcodeRequestPage() {
  const [rawText, setRawText] = useState("");
  const [application, setApplication] =
    useState<FreightApplication>(EMPTY_APPLICATION);
  const [lookupFailedIds, setLookupFailedIds] = useState<Set<string>>(new Set());
  const [copyLabel, setCopyLabel] = useState("중국어 메시지 복사");
  const [analysisWarning, setAnalysisWarning] = useState("");
  const createdDate = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const matchedCount = application.items.filter(
    (item) => item.matchedModelNo,
  ).length;

  function analyzeText() {
    const parsedApplication = parseFreightApplicationText(rawText);
    setApplication(parsedApplication);
    setAnalysisWarning(
      parsedApplication.items.length === 0 ? NO_ITEMS_WARNING : "",
    );
    setLookupFailedIds(new Set());
  }

  function loadSample() {
    setRawText(SAMPLE_TEXT);
    setApplication(parseFreightApplicationText(SAMPLE_TEXT));
    setAnalysisWarning("");
    setLookupFailedIds(new Set());
  }

  function reset() {
    setRawText("");
    setApplication(EMPTY_APPLICATION);
    setAnalysisWarning("");
    setLookupFailedIds(new Set());
  }

  function updateApplicationNo(value: string) {
    setApplication((current) => ({ ...current, applicationNo: value }));
  }

  function updateItem(
    id: string,
    changes: Partial<FreightApplicationItem>,
  ) {
    setApplication((current) => ({
      ...current,
      items: current.items.map((item) =>
        item.id === id ? { ...item, ...changes } : item,
      ),
    }));
  }

  function applyProductMaster(item: FreightApplicationItem) {
    const product = findProductByModelNoOrModelName(item.lookupText ?? "");

    if (!product) {
      setLookupFailedIds((current) => new Set(current).add(item.id));
      return;
    }

    updateItem(item.id, {
      matchedModelNo: product.modelNo,
      matchedModelName: product.modelName,
      matchedProductNameKo: product.productNameKo,
      matchedBarcode: product.barcode,
      matchedOriginLabel: product.originLabel,
      matchedLabelText: product.labelText,
      matchedImageUrl: product.mainImageUrl,
      hsCode: item.hsCode || product.hsCode,
    });
    setLookupFailedIds((current) => {
      const next = new Set(current);
      next.delete(item.id);
      return next;
    });
  }

  async function copyChineseMessage() {
    await navigator.clipboard.writeText(CHINESE_MESSAGE);
    setCopyLabel("복사 완료");
    window.setTimeout(() => setCopyLabel("중국어 메시지 복사"), 1500);
  }

  return (
    <>
      <div className="freight-editing-ui">
        <PageHeader
          title="배대지 바코드 PDF 생성기"
          description="배송대행지 신청서 세부 페이지의 제품정보를 붙여넣어 바코드/원산지 라벨 작업요청서를 만듭니다."
        />

        <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-semibold text-slate-950">배송대행지 신청서 텍스트</h2>
              <p className="mt-1 text-xs text-slate-500">
                제품정보 블록을 그대로 붙여넣으면 신청번호와 품목별 필드를 분석합니다.
              </p>
            </div>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
              붙여넣기 기반 MVP
            </span>
          </div>
          <textarea
            value={rawText}
            onChange={(event) => {
              setRawText(event.target.value);
              setAnalysisWarning("");
            }}
            placeholder="배송대행지 신청서 세부 페이지에서 제품정보 영역을 드래그해서 복사한 뒤 여기에 붙여넣으세요."
            className="min-h-72 w-full resize-y rounded-lg border border-slate-300 bg-slate-50 p-4 font-mono text-sm leading-6 text-slate-900 outline-none placeholder:font-sans placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100"
          />
          <p className="mt-2 text-xs leading-5 text-slate-500">
            배송대행지 화면을 복사할 때 번호, 사진, 수량, 품목, 옵션, 오더번호가 함께 포함되도록 드래그하면 분석률이 높아집니다.
          </p>
          {analysisWarning && (
            <p role="alert" className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium leading-6 text-amber-900">
              {analysisWarning}
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={analyzeText} primary>신청서 분석하기</Button>
            <Button onClick={loadSample}>샘플 불러오기</Button>
            <Button onClick={reset}>초기화</Button>
          </div>
        </section>

        <section className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="분석 결과 요약">
          <SummaryCard label="신청번호" value={application.applicationNo || "-"} />
          <SummaryCard label="품목 수" value={`${application.items.length}개`} />
          <SummaryCard label="매칭 완료" value={`${matchedCount}개`} emphasized />
          <SummaryCard label="확인 필요" value={`${application.items.length - matchedCount}개`} warning />
        </section>

        <section className="mb-8 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="font-semibold text-slate-950">분석 품목 편집 및 상품마스터 매칭</h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                파싱 결과를 직접 수정하고 모델번호 또는 모델명으로 안정적인 기준정보를 적용하세요.
              </p>
            </div>
            <label className="w-full sm:w-64">
              <span className="mb-1 block text-xs font-semibold text-slate-600">신청번호 수정</span>
              <input
                value={application.applicationNo}
                onChange={(event) => updateApplicationNo(event.target.value)}
                className={inputClassName}
              />
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[2700px] border-collapse text-left text-xs">
              <thead className="bg-slate-100 text-slate-600">
                <tr>
                  {[
                    "순번", "품목", "옵션", "수량", "단가", "HS CODE", "상세URL",
                    "오픈마켓 주문번호", "트래킹번호", "모델번호/모델명 입력", "매칭상태",
                    "모델번호", "모델명", "바코드", "원산지/라벨 문구", "비고",
                  ].map((heading) => (
                    <th key={heading} className="border-b border-r border-slate-200 px-3 py-3 font-semibold last:border-r-0">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {application.items.map((item) => (
                  <EditableRow
                    key={item.id}
                    item={item}
                    lookupFailed={lookupFailedIds.has(item.id)}
                    onChange={(changes) => updateItem(item.id, changes)}
                    onApply={() => applyProductMaster(item)}
                  />
                ))}
              </tbody>
            </table>
          </div>
          {application.items.length === 0 && (
            <div className="px-6 py-14 text-center text-sm text-slate-500">
              신청서 텍스트를 붙여넣고 분석하면 편집 가능한 품목이 표시됩니다.
            </div>
          )}
        </section>

        <section className="mb-5 rounded-xl border border-blue-200 bg-blue-50 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-semibold text-blue-950">인쇄 및 전달</h2>
              <p className="mt-1 text-sm text-blue-800">
                권장 파일명: <strong>barcode-work-request-{application.applicationNo || "unknown"}.pdf</strong>
              </p>
              <p className="mt-1 text-xs text-blue-700">
                인쇄 창에서 &quot;PDF로 저장&quot;을 선택해 파일명으로 저장하세요.
              </p>
            </div>
            <Button onClick={() => window.print()} primary>PDF로 저장/인쇄</Button>
          </div>
          <div className="mt-4 rounded-lg border border-blue-200 bg-white p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-xs font-semibold text-slate-600">배송대행지 전달용 중국어 메시지</span>
              <button type="button" onClick={copyChineseMessage} className="text-xs font-semibold text-blue-700 hover:text-blue-900">
                {copyLabel}
              </button>
            </div>
            <pre className="whitespace-pre-wrap font-sans text-sm leading-6 text-slate-700">{CHINESE_MESSAGE}</pre>
          </div>
        </section>
      </div>

      <WorkRequestPreview application={application} createdDate={createdDate} />
    </>
  );
}

function EditableRow({
  item,
  lookupFailed,
  onChange,
  onApply,
}: {
  item: FreightApplicationItem;
  lookupFailed: boolean;
  onChange: (changes: Partial<FreightApplicationItem>) => void;
  onApply: () => void;
}) {
  const status = item.matchedModelNo
    ? "매칭 완료"
    : lookupFailed
      ? "마스터 없음"
      : "확인 필요";
  const statusStyle = item.matchedModelNo
    ? "bg-emerald-50 text-emerald-700"
    : lookupFailed
      ? "bg-red-50 text-red-700"
      : "bg-amber-50 text-amber-700";

  return (
    <tr className="align-top odd:bg-white even:bg-slate-50/50">
      <td className={cellClassName}>
        <input type="number" value={item.rowNo} onChange={(event) => onChange({ rowNo: Number(event.target.value) })} className={`${inputClassName} w-16`} />
      </td>
      <td className={cellClassName}><input value={item.itemName} onChange={(event) => onChange({ itemName: event.target.value })} className={`${inputClassName} w-44`} /></td>
      <td className={cellClassName}><textarea value={item.optionText} onChange={(event) => onChange({ optionText: event.target.value })} className={`${inputClassName} min-h-16 w-56 resize-y`} /></td>
      <td className={cellClassName}><input type="number" min="0" value={item.quantity} onChange={(event) => onChange({ quantity: Number(event.target.value) })} className={`${inputClassName} w-24`} /></td>
      <td className={cellClassName}><input type="number" step="0.01" value={item.unitPrice ?? ""} onChange={(event) => onChange({ unitPrice: event.target.value === "" ? undefined : Number(event.target.value) })} className={`${inputClassName} w-24`} /></td>
      <td className={cellClassName}><input value={item.hsCode ?? ""} onChange={(event) => onChange({ hsCode: event.target.value })} className={`${inputClassName} w-32`} /></td>
      <td className={cellClassName}><textarea value={item.detailUrl ?? ""} onChange={(event) => onChange({ detailUrl: event.target.value })} className={`${inputClassName} min-h-16 w-64 resize-y break-all`} /></td>
      <td className={cellClassName}><input value={item.orderNo ?? ""} onChange={(event) => onChange({ orderNo: event.target.value })} className={`${inputClassName} w-48`} /></td>
      <td className={cellClassName}><input value={item.trackingNo ?? ""} onChange={(event) => onChange({ trackingNo: event.target.value })} className={`${inputClassName} w-40`} /></td>
      <td className={cellClassName}>
        <div className="w-52 space-y-2">
          <input value={item.lookupText ?? ""} onChange={(event) => onChange({ lookupText: event.target.value })} placeholder="예: aaa270 또는 말발굽 고리링" className={inputClassName} />
          <button type="button" onClick={onApply} className="w-full rounded-md bg-slate-800 px-3 py-2 font-semibold text-white hover:bg-slate-950">상품마스터 적용</button>
        </div>
      </td>
      <td className={cellClassName}><span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 font-semibold ${statusStyle}`}>{status}</span></td>
      <td className={cellClassName}><input value={item.matchedModelNo ?? ""} onChange={(event) => onChange({ matchedModelNo: event.target.value })} className={`${inputClassName} w-32`} /></td>
      <td className={cellClassName}><input value={item.matchedModelName ?? ""} onChange={(event) => onChange({ matchedModelName: event.target.value })} className={`${inputClassName} w-40`} /></td>
      <td className={cellClassName}><input value={item.matchedBarcode ?? ""} onChange={(event) => onChange({ matchedBarcode: event.target.value })} className={`${inputClassName} w-40`} /></td>
      <td className={cellClassName}>
        <div className="w-48 space-y-2">
          <input value={item.matchedOriginLabel ?? ""} onChange={(event) => onChange({ matchedOriginLabel: event.target.value })} placeholder="원산지" className={inputClassName} />
          <input value={item.matchedLabelText ?? ""} onChange={(event) => onChange({ matchedLabelText: event.target.value })} placeholder="라벨 문구" className={inputClassName} />
        </div>
      </td>
      <td className={cellClassName}><textarea value={item.memo ?? ""} onChange={(event) => onChange({ memo: event.target.value })} className={`${inputClassName} min-h-16 w-44 resize-y`} /></td>
    </tr>
  );
}

function WorkRequestPreview({ application, createdDate }: { application: FreightApplication; createdDate: string }) {
  return (
    <section className="freight-print-area rounded-xl border border-slate-300 bg-white p-6 shadow-sm sm:p-8" aria-label="바코드 작업요청서 인쇄 미리보기">
      <div className="border-b-2 border-slate-900 pb-4 text-center">
        <p className="text-xs font-semibold tracking-[0.2em] text-slate-500">COMMERCE OS</p>
        <h2 className="mt-2 text-2xl font-bold text-slate-950">바코드 작업요청서</h2>
      </div>
      <div className="mt-4 flex flex-wrap justify-between gap-2 text-sm">
        <p><strong>신청번호:</strong> {application.applicationNo || "-"}</p>
        <p><strong>생성일자:</strong> {createdDate}</p>
      </div>
      <div className="mt-5 grid gap-4 border-y border-slate-300 py-4 text-sm leading-6 md:grid-cols-2">
        <div>
          <p className="mb-1 font-bold">작업 안내</p>
          <p>아래 품목별 이미지, 옵션, 수량에 맞춰 바코드/원산지 라벨을 부착해주세요.</p>
          <p>같은 상품이라도 색상/규격이 다른 경우 반드시 구분해서 작업해주세요.</p>
          <p>불명확한 부분은 작업 전 확인 부탁드립니다.</p>
        </div>
        <div lang="zh-CN">
          <p className="mb-1 font-bold">作业说明</p>
          <p>请按照以下商品明细、图片、规格和数量粘贴条码/原产地标签。</p>
          <p>相同商品但不同颜色或规格的，请务必分开处理。</p>
          <p>如有不清楚的地方，请先联系我确认后再操作。</p>
        </div>
      </div>
      <div className="mt-5 overflow-x-auto">
        <table className="print-table w-full min-w-[1120px] border-collapse text-left text-xs">
          <thead>
            <tr>
              {["순번", "상품이미지", "품목", "옵션", "수량", "오픈마켓 주문번호", "모델번호", "모델명", "바코드", "원산지/라벨 문구", "작업지시"].map((heading) => (
                <th key={heading} className="border border-slate-400 bg-slate-100 px-2 py-2 font-bold">{heading}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {application.items.map((item) => (
              <tr key={item.id} className="break-inside-avoid align-top">
                <td className="border border-slate-400 px-2 py-3 text-center font-bold">{item.rowNo}</td>
                <td className="border border-slate-400 px-2 py-3 text-center">
                  {item.matchedImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.matchedImageUrl} alt={item.matchedModelName || item.itemName} className="mx-auto size-16 object-contain" />
                  ) : "이미지 없음"}
                </td>
                <td className="border border-slate-400 px-2 py-3">{item.matchedProductNameKo || item.itemName || "-"}</td>
                <td className="border border-slate-400 px-2 py-3 whitespace-pre-wrap">{item.optionText || "-"}</td>
                <td className="border border-slate-400 px-2 py-3 text-right font-bold">{item.quantity}</td>
                <td className="border border-slate-400 px-2 py-3 break-all">{item.orderNo || "-"}</td>
                <td className="border border-slate-400 px-2 py-3">{item.matchedModelNo || "확인 필요"}</td>
                <td className="border border-slate-400 px-2 py-3">{item.matchedModelName || "확인 필요"}</td>
                <td className="border border-slate-400 px-2 py-3 font-mono">{item.matchedBarcode || "확인 필요"}</td>
                <td className="border border-slate-400 px-2 py-3">
                  <p>{item.matchedOriginLabel || "확인 필요"}</p>
                  {item.matchedLabelText && <p className="mt-1">{item.matchedLabelText}</p>}
                </td>
                <td className="border border-slate-400 px-2 py-3">바코드/원산지 라벨 부착</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {application.items.length === 0 && <p className="py-12 text-center text-sm text-slate-500">분석된 품목이 없습니다.</p>}
    </section>
  );
}

function Button({ children, onClick, primary = false }: { children: React.ReactNode; onClick: () => void; primary?: boolean }) {
  return <button type="button" onClick={onClick} className={`rounded-lg px-4 py-2.5 text-sm font-semibold transition ${primary ? "bg-blue-600 text-white hover:bg-blue-700" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>{children}</button>;
}

function SummaryCard({ label, value, emphasized = false, warning = false }: { label: string; value: string; emphasized?: boolean; warning?: boolean }) {
  return (
    <div className={`rounded-lg border bg-white px-4 py-3 shadow-sm ${emphasized ? "border-emerald-200" : warning ? "border-amber-200" : "border-slate-200"}`}>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-bold ${emphasized ? "text-emerald-700" : warning ? "text-amber-700" : "text-slate-900"}`}>{value}</p>
    </div>
  );
}

const inputClassName = "w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
const cellClassName = "border-b border-r border-slate-200 p-2 last:border-r-0";
