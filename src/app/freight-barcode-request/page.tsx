"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { parseFreightApplicationText } from "@/lib/freightApplicationParser";
import { findProductByModelNoOrModelName } from "@/lib/productMaster";
import { createCode128Layout } from "@/lib/code128";
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

const KOREAN_MESSAGE = `첨부드린 PDF 기준으로 상품별 바코드/원산지 라벨 부착 작업 부탁드립니다.

각 품목은 순번, 상품 이미지, 옵션, 수량, 위치코드를 기준으로 구분해 주세요.
같은 상품명이라도 색상, 규격, 옵션이 다르면 위치코드 또는 바코드번호가 다를 수 있으니 반드시 각 행별로 확인 후 작업 부탁드립니다.
바코드는 PDF에 표시된 바코드 이미지와 하단 텍스트 기준으로 부착해 주시면 됩니다.
수량이나 옵션이 불명확한 부분이 있으면 작업 전 확인 부탁드립니다.`;

const EMPTY_APPLICATION: FreightApplication = { applicationNo: "", items: [] };
const NO_ITEMS_WARNING =
  "분석된 품목이 없습니다. 복사한 텍스트에서 품목/옵션/수량/URL을 찾지 못했습니다. 신청서 세부 페이지에서 제품정보 영역을 더 넓게 복사해주세요.";
const ANALYSIS_ERROR =
  "분석 중 오류가 발생했습니다. 원문 형식이 예상과 다릅니다.";

type AnalysisStatus =
  | { kind: "success"; message: string }
  | { kind: "warning"; message: string }
  | { kind: "error"; message: string };

export default function FreightBarcodeRequestPage() {
  const [rawText, setRawText] = useState("");
  const [application, setApplication] =
    useState<FreightApplication>(EMPTY_APPLICATION);
  const [lookupFailedIds, setLookupFailedIds] = useState<Set<string>>(new Set());
  const [copyLabel, setCopyLabel] = useState("한국어 메시지 복사");
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus | null>(null);
  const createdDate = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const matchedCount = application.items.filter(
    (item) => item.matchedModelNo,
  ).length;

  function analyzeText() {
    try {
      const parsedApplication = parseFreightApplicationText(rawText);
      setApplication(parsedApplication);
      const hasParseWarnings = Boolean(
        parsedApplication.diagnostics?.warnings.length,
      );
      setAnalysisStatus(
        parsedApplication.items.length > 0
          ? {
              kind: hasParseWarnings ? "warning" : "success",
              message: `분석 완료: ${parsedApplication.items.length}개 품목을 찾았습니다.${
                hasParseWarnings ? " 일부 품목은 값이 없어 제외되었습니다." : ""
              }`,
            }
          : { kind: "warning", message: NO_ITEMS_WARNING },
      );
    } catch {
      setApplication(EMPTY_APPLICATION);
      setAnalysisStatus({ kind: "error", message: ANALYSIS_ERROR });
    }
    setLookupFailedIds(new Set());
  }

  function loadSample() {
    const parsedApplication = parseFreightApplicationText(SAMPLE_TEXT);
    setRawText(SAMPLE_TEXT);
    setApplication(parsedApplication);
    setAnalysisStatus({
      kind: "success",
      message: `분석 완료: ${parsedApplication.items.length}개 품목을 찾았습니다.`,
    });
    setLookupFailedIds(new Set());
  }

  function reset() {
    setRawText("");
    setApplication(EMPTY_APPLICATION);
    setAnalysisStatus(null);
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

  async function copyKoreanMessage() {
    await navigator.clipboard.writeText(KOREAN_MESSAGE);
    setCopyLabel("복사 완료");
    window.setTimeout(() => setCopyLabel("한국어 메시지 복사"), 1500);
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
              setAnalysisStatus(null);
            }}
            placeholder="배송대행지 신청서 세부 페이지에서 제품정보 영역을 드래그해서 복사한 뒤 여기에 붙여넣으세요."
            className="min-h-72 w-full resize-y rounded-lg border border-slate-300 bg-slate-50 p-4 font-mono text-sm leading-6 text-slate-900 outline-none placeholder:font-sans placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100"
          />
          <div className="mt-2 space-y-1 text-xs leading-5 text-slate-500">
            <p>
              세부 페이지에서는 제품정보 영역의 *품목, 옵션, 상품상세url, hs_code, 단가, 수량이 함께 포함되도록 복사하면 분석률이 높습니다.
            </p>
            <p>
              textarea는 이미지를 직접 받을 수 없습니다. 이미지는 상품마스터 이미지 또는 이미지 URL 기준으로 표시됩니다.
            </p>
            <p>
              분석 결과가 비어 있으면 아래 진단 정보를 보고 복사 범위를 넓혀 다시 시도하세요.
            </p>
          </div>
          {analysisStatus && (
            <p
              role="status"
              className={`mt-3 rounded-lg border px-4 py-3 text-sm font-medium leading-6 ${
                analysisStatus.kind === "success"
                  ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                  : analysisStatus.kind === "error"
                    ? "border-red-300 bg-red-50 text-red-900"
                    : "border-amber-300 bg-amber-50 text-amber-900"
              }`}
            >
              {analysisStatus.message}
            </p>
          )}
          {analysisStatus && application.diagnostics && (
            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-700">
              <p className="font-semibold text-slate-900">분석 진단 정보</p>
              <dl className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
                <div><dt className="inline font-medium">파서 모드: </dt><dd className="inline">{application.diagnostics.parserMode}</dd></div>
                <div><dt className="inline font-medium">감지된 줄 수: </dt><dd className="inline">{application.diagnostics.detectedCounts.lines}</dd></div>
                <div><dt className="inline font-medium">감지된 품목 라벨 수: </dt><dd className="inline">{application.diagnostics.detectedCounts.itemLabels}</dd></div>
                <div><dt className="inline font-medium">감지된 URL 수: </dt><dd className="inline">{application.diagnostics.detectedCounts.urls}</dd></div>
                <div><dt className="inline font-medium">감지된 수량 라벨 수: </dt><dd className="inline">{application.diagnostics.detectedCounts.quantityLabels}</dd></div>
                <div><dt className="inline font-medium">감지된 오더번호 수: </dt><dd className="inline">{application.diagnostics.detectedCounts.orderNumbers}</dd></div>
              </dl>
            </div>
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
            <table className="w-full min-w-[2860px] border-collapse text-left text-xs">
              <thead className="bg-slate-100 text-slate-600">
                <tr>
                  {[
                    "순번", "품목", "옵션", "수량", "단가", "HS CODE", "상세URL", "이미지 URL",
                    "오픈마켓 주문번호", "트래킹번호", "모델번호/모델명 입력", "위치코드", "매칭상태",
                    "모델번호", "모델명", "상품 바코드", "원산지/라벨 문구", "비고",
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
                PDF 저장 시 대상은 &apos;PDF로 저장&apos;, 용지는 A4, 배율은 기본값 또는 100%를 권장합니다.
              </p>
            </div>
            <Button onClick={() => window.print()} primary>PDF로 저장/인쇄</Button>
          </div>
          <div className="mt-4 rounded-lg border border-blue-200 bg-white p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-xs font-semibold text-slate-600">배송대행지 전달용 한국어 메시지</span>
              <button type="button" onClick={copyKoreanMessage} className="text-xs font-semibold text-blue-700 hover:text-blue-900">
                {copyLabel}
              </button>
            </div>
            <pre className="whitespace-pre-wrap font-sans text-sm leading-6 text-slate-700">{KOREAN_MESSAGE}</pre>
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
      <td className={cellClassName}><textarea value={item.imageUrl ?? ""} onChange={(event) => onChange({ imageUrl: event.target.value })} placeholder="https://..." className={`${inputClassName} min-h-16 w-64 resize-y break-all`} /></td>
      <td className={cellClassName}><input value={item.orderNo ?? ""} onChange={(event) => onChange({ orderNo: event.target.value })} className={`${inputClassName} w-48`} /></td>
      <td className={cellClassName}><input value={item.trackingNo ?? ""} onChange={(event) => onChange({ trackingNo: event.target.value })} className={`${inputClassName} w-40`} /></td>
      <td className={cellClassName}>
        <div className="w-52 space-y-2">
          <input value={item.lookupText ?? ""} onChange={(event) => onChange({ lookupText: event.target.value })} placeholder="예: aaa270 또는 말발굽 고리링" className={inputClassName} />
          <button type="button" onClick={onApply} className="w-full rounded-md bg-slate-800 px-3 py-2 font-semibold text-white hover:bg-slate-950">상품마스터 적용</button>
        </div>
      </td>
      <td className={cellClassName}>
        <label className="block w-36">
          <span className="sr-only">위치코드</span>
          <input value={item.locationCode ?? ""} onChange={(event) => onChange({ locationCode: event.target.value })} placeholder="예: BAA1-1" className={inputClassName} />
        </label>
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

function LocationBarcode({ value }: { value?: string }) {
  const normalizedValue = value?.trim();

  if (!normalizedValue) {
    return <span className="font-sans text-[10px] font-semibold">위치코드 미입력</span>;
  }

  let layout: ReturnType<typeof createCode128Layout> | null = null;

  try {
    layout = createCode128Layout(normalizedValue);
  } catch {
    layout = null;
  }

  if (!layout) {
    return (
      <span className="font-sans text-[10px] font-semibold">
        위치코드 형식 확인: {normalizedValue}
      </span>
    );
  }

  return (
    <div className="location-barcode mx-auto flex min-w-36 flex-col items-center bg-white p-1 text-black">
      <svg
        aria-label={`위치코드 ${normalizedValue} CODE128 바코드`}
        className="block h-12 w-40 max-w-none bg-white"
        role="img"
        shapeRendering="crispEdges"
        viewBox={`0 0 ${layout.width} 40`}
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect fill="white" height="40" width={layout.width} />
        {layout.bars.map((bar, index) => (
          <rect key={`${bar.x}-${index}`} fill="black" height="40" width={bar.width} x={bar.x} />
        ))}
      </svg>
      <span className="mt-1 font-mono text-[10px] font-bold tracking-wide">{normalizedValue}</span>
    </div>
  );
}

function WorkRequestPreview({ application, createdDate }: { application: FreightApplication; createdDate: string }) {
  return (
    <section className="freight-print-area print-root rounded-xl border border-slate-300 bg-white p-6 shadow-sm sm:p-8" aria-label="바코드 작업요청서 인쇄 미리보기">
      <div className="print-document">
        <div className="border-b-2 border-slate-900 pb-4 text-center">
          <p className="text-xs font-semibold tracking-[0.2em] text-slate-500">COMMERCE OS</p>
          <h2 className="mt-2 text-2xl font-bold text-slate-950">바코드 작업요청서</h2>
        </div>
        <div className="mt-4 flex flex-wrap justify-between gap-2 text-sm">
          <p><strong>신청번호:</strong> {application.applicationNo || "-"}</p>
          <p><strong>생성일자:</strong> {createdDate}</p>
        </div>
        <div className="print-instructions mt-5 border-y border-slate-300 py-4 text-sm leading-6">
          <p className="mb-1 font-bold">작업 안내</p>
          <p>아래 품목별 이미지, 옵션, 수량, 위치코드에 맞춰 바코드/원산지 라벨을 부착해주세요.</p>
          <p>같은 상품명이라도 색상, 규격, 옵션이 다르면 위치코드 또는 바코드번호가 다를 수 있으니 각 품목 행을 반드시 구분해서 확인해주세요.</p>
          <p>바코드는 각 품목 카드의 바코드 이미지와 하단 텍스트를 기준으로 부착해주세요.</p>
          <p>수량과 옵션이 불명확한 경우 작업 전 확인 부탁드립니다.</p>
        </div>
        <div className="print-card-list mt-5 space-y-4">
          {application.items.map((item) => {
            const imageUrl = item.matchedImageUrl || item.imageUrl;

            return (
              <article key={item.id} className="freight-item-card print-card break-inside-avoid rounded-lg border-2 border-slate-800 p-4 text-xs text-slate-950">
                <div className="item-card-top grid grid-cols-[3rem_4.5rem_minmax(0,1fr)] gap-3">
                  <div className="flex h-12 items-center justify-center rounded border border-slate-400 text-lg font-bold">{item.rowNo}</div>
                  <div className="product-image flex size-[72px] items-center justify-center overflow-hidden rounded border border-slate-300 bg-white text-center text-[10px] text-slate-500">
                    {imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={imageUrl} alt={item.matchedModelName || item.itemName} className="size-[72px] object-contain" />
                    ) : "이미지 없음"}
                  </div>
                  <dl className="min-w-0 space-y-1 leading-5">
                    <PrintField label="품목" value={item.matchedProductNameKo || item.itemName} />
                    <PrintField label="옵션" value={item.optionText} multiline />
                    <div className="grid gap-x-4 sm:grid-cols-3">
                      <PrintField label="수량" value={String(item.quantity)} />
                      <PrintField label="HS CODE" value={item.hsCode} />
                      <PrintField label="오픈마켓 주문번호" value={item.orderNo} breakAll />
                    </div>
                  </dl>
                </div>

                <dl className="item-model-grid mt-3 grid grid-cols-3 border-y border-slate-400 py-2">
                  <PrintField label="모델번호" value={item.matchedModelNo || "확인 필요"} />
                  <PrintField label="모델명" value={item.matchedModelName || "확인 필요"} />
                  <PrintField label="위치코드" value={item.locationCode?.trim() || "위치코드 미입력"} mono />
                </dl>

                <div className="barcode-area py-3 text-center">
                  <LocationBarcode value={item.locationCode} />
                </div>

                <dl className="space-y-2 border-t border-slate-400 pt-3 leading-5">
                  <PrintField
                    label="원산지/라벨 문구"
                    value={[item.matchedOriginLabel, item.matchedLabelText].filter(Boolean).join(" / ") || "확인 필요"}
                    multiline
                  />
                  <PrintField label="작업지시" value={item.memo || "위치코드 바코드/원산지 라벨 부착"} multiline />
                </dl>
              </article>
            );
          })}
        </div>
        {application.items.length === 0 && <p className="py-12 text-center text-sm text-slate-500">분석된 품목이 없습니다.</p>}
      </div>
    </section>
  );
}

function PrintField({
  label,
  value,
  multiline = false,
  breakAll = false,
  mono = false,
}: {
  label: string;
  value?: string;
  multiline?: boolean;
  breakAll?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="inline font-bold">{label}: </dt>
      <dd className={`inline ${multiline ? "whitespace-pre-wrap break-words" : ""} ${breakAll ? "break-all" : ""} ${mono ? "font-mono font-bold" : ""}`}>
        {value || "-"}
      </dd>
    </div>
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
