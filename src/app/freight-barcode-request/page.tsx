"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { parseFreightApplicationText } from "@/lib/freightApplicationParser";
import { findProductsByText } from "@/lib/productMaster";
import {
  buildFreightBarcodeHistoryRecordFromCurrentState,
  deleteFreightBarcodeHistory,
  listFreightBarcodeHistory,
  loadFreightBarcodeHistory,
  saveFreightBarcodeHistory,
} from "@/lib/freightBarcodeHistory";
import { createCode128Layout } from "@/lib/code128";
import {
  buildBarcodeLabelPages,
  calculateBarcodeLabelPrint,
  formatBarcodeBundleUnit,
  getTotalBarcodeLabelCount,
} from "@/lib/barcodeLabelPrint";
import {
  BARCODE_ORIGIN_LABEL,
  getEncodedBarcodeValue,
  isValidBarcodeValue,
  sanitizeBarcodeValue,
} from "@/lib/barcodeValue";
import {
  assignPastedImagesToItems,
  createClipboardImageCandidates,
  extractRichPasteImagesFromHtml,
  getFreightItemImageSources,
  mergeRichPasteImages,
} from "@/lib/richPasteExtractor";
import type { RichPasteImageCandidate, RichPasteImageExtraction } from "@/lib/richPasteExtractor";
import type {
  FreightApplication,
  FreightApplicationItem,
  FreightBarcodeHistoryRecord,
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

const KOREAN_MESSAGE = `바코드 라벨 상단에는 MADE IN CHINA 문구가 포함되어 있으므로 원산지 스티커는 별도로 부착하지 않으셔도 됩니다.
같은 상품이라도 옵션별로 바코드번호가 다를 수 있으니 상품 카드별로 구분해서 작업 부탁드립니다.`;

const EMPTY_APPLICATION: FreightApplication = { applicationNo: "", items: [] };
const EMPTY_PASTED_IMAGES: RichPasteImageExtraction = {
  totalImages: 0,
  candidates: [],
  excludedCandidates: [],
  ignoredImages: 0,
  productBlockCount: 0,
};
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
  const [pastedImages, setPastedImages] = useState<RichPasteImageExtraction>(EMPTY_PASTED_IMAGES);
  const richPasteRef = useRef<HTMLDivElement>(null);
  const clipboardObjectUrlsRef = useRef<string[]>([]);
  const localImageObjectUrlsRef = useRef<Map<string, string>>(new Map());
  const [application, setApplication] =
    useState<FreightApplication>(EMPTY_APPLICATION);
  const [lookupFailedIds, setLookupFailedIds] = useState<Set<string>>(new Set());
  const [copyLabel, setCopyLabel] = useState("한국어 메시지 복사");
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus | null>(null);
  const [historyRecords, setHistoryRecords] = useState<FreightBarcodeHistoryRecord[]>([]);
  const [serverHistoryRecords, setServerHistoryRecords] = useState<FreightBarcodeHistoryRecord[]>([]);
  const [loadedHistoryId, setLoadedHistoryId] = useState<string>();
  const [loadedServerHistoryId, setLoadedServerHistoryId] = useState<string>();
  const [historyTitle, setHistoryTitle] = useState("");
  const [historyMemo, setHistoryMemo] = useState("");
  const [historyStatus, setHistoryStatus] = useState("");
  const [printTarget, setPrintTarget] = useState<"work-request" | "labels">("work-request");
  const createdDate = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const matchedCount = application.items.filter(
    (item) => item.matchedModelNo,
  ).length;

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setHistoryRecords(listFreightBarcodeHistory());
      void refreshServerHistoryRecords();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    const localImageObjectUrls = localImageObjectUrlsRef.current;
    return () => {
      clipboardObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      localImageObjectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  function clearClipboardObjectUrls() {
    clipboardObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    clipboardObjectUrlsRef.current = [];
  }

  function clearLocalImageObjectUrls() {
    localImageObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    localImageObjectUrlsRef.current.clear();
  }

  function analyzeText() {
    clearLocalImageObjectUrls();
    try {
      const parsedApplication = parseFreightApplicationText(rawText);
      const applicationWithPastedImages = {
        ...parsedApplication,
        items: assignPastedImagesToItems(
          parsedApplication.items,
          pastedImages,
        ),
      };
      setApplication(applicationWithPastedImages);
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

  function handleRichPaste(event: React.ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    const html = event.clipboardData.getData("text/html");
    const plainText = event.clipboardData.getData("text/plain");
    clearClipboardObjectUrls();
    const clipboardFiles = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    const clipboardInputs = clipboardFiles.map((file) => {
      const url = URL.createObjectURL(file);
      clipboardObjectUrlsRef.current.push(url);
      return { url, type: file.type, name: file.name };
    });
    const imageExtraction = mergeRichPasteImages(
      extractRichPasteImagesFromHtml(html),
      createClipboardImageCandidates(clipboardInputs),
    );

    event.currentTarget.textContent = plainText;
    setRawText(plainText);
    setPastedImages(imageExtraction);
    setAnalysisStatus(null);
  }

  function loadSample() {
    clearLocalImageObjectUrls();
    const parsedApplication = parseFreightApplicationText(SAMPLE_TEXT);
    setRawText(SAMPLE_TEXT);
    clearClipboardObjectUrls();
    setPastedImages(EMPTY_PASTED_IMAGES);
    if (richPasteRef.current) richPasteRef.current.textContent = SAMPLE_TEXT;
    setApplication(parsedApplication);
    setAnalysisStatus({
      kind: "success",
      message: `분석 완료: ${parsedApplication.items.length}개 품목을 찾았습니다.`,
    });
    setLookupFailedIds(new Set());
    setLoadedHistoryId(undefined);
    setLoadedServerHistoryId(undefined);
    setHistoryTitle("");
    setHistoryMemo("");
    setHistoryStatus("");
  }

  function reset() {
    setRawText("");
    clearLocalImageObjectUrls();
    clearClipboardObjectUrls();
    setPastedImages(EMPTY_PASTED_IMAGES);
    if (richPasteRef.current) richPasteRef.current.textContent = "";
    setApplication(EMPTY_APPLICATION);
    setAnalysisStatus(null);
    setLookupFailedIds(new Set());
    setLoadedHistoryId(undefined);
    setLoadedServerHistoryId(undefined);
    setHistoryTitle("");
    setHistoryMemo("");
    setHistoryStatus("");
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

  function updateLocalImage(itemId: string, file?: File) {
    const previousUrl = localImageObjectUrlsRef.current.get(itemId);
    if (previousUrl) {
      URL.revokeObjectURL(previousUrl);
      localImageObjectUrlsRef.current.delete(itemId);
    }

    const localImageUrl = file ? URL.createObjectURL(file) : undefined;
    if (localImageUrl) localImageObjectUrlsRef.current.set(itemId, localImageUrl);
    updateItem(itemId, { localImageUrl });
  }

  function updateCandidateLoadStatus(url: string, loadStatus: "loaded" | "failed") {
    setPastedImages((current) => ({
      ...current,
      candidates: current.candidates.map((candidate) =>
        candidate.url === url ? { ...candidate, loadStatus } : candidate,
      ),
    }));
    if (loadStatus === "failed") {
      setApplication((current) => ({
        ...current,
        items: current.items.map((item) =>
          item.pastedImageUrl === url || item.selectedImageCandidateUrl === url
            ? {
                ...item,
                pastedImageUrl:
                  item.pastedImageUrl === url ? undefined : item.pastedImageUrl,
                selectedImageCandidateUrl:
                  item.selectedImageCandidateUrl === url
                    ? undefined
                    : item.selectedImageCandidateUrl,
              }
            : item,
        ),
      }));
    }
  }

  function applyProductMaster(item: FreightApplicationItem) {
    const product = findProductsByText(item.lookupText ?? "")[0];

    if (!product) {
      setLookupFailedIds((current) => new Set(current).add(item.id));
      return;
    }

    updateItem(item.id, {
      modelNo: product.modelNo,
      modelName: product.modelName,
      optionName: product.optionName,
      barcode: product.barcode,
      origin: product.origin,
      displayName: product.displayName,
      matchedModelNo: product.modelNo,
      matchedModelName: product.modelName,
      matchedProductNameKo: product.productNameKo,
      matchedBarcode: product.barcode,
      matchedOriginLabel: product.origin,
      matchedLabelText: product.labelText,
      matchedImageUrl: product.imageUrl,
      hsCode: item.hsCode || product.hsCode,
    });
    setLookupFailedIds((current) => {
      const next = new Set(current);
      next.delete(item.id);
      return next;
    });
  }

  function refreshHistoryRecords() {
    setHistoryRecords(listFreightBarcodeHistory());
  }

  async function refreshServerHistoryRecords() {
    try {
      const response = await fetch("/api/freight-barcode-requests", { cache: "no-store" });
      if (!response.ok) throw new Error("History list request failed");
      const data = await response.json() as { records: FreightBarcodeHistoryRecord[] };
      setServerHistoryRecords(data.records);
    } catch {
      setHistoryStatus(
        "서버 이력을 불러오지 못했습니다. 로컬 저장과 PDF 생성은 계속 사용할 수 있습니다.",
      );
    }
  }

  function restoreHistoryRecord(record: FreightBarcodeHistoryRecord) {
    clearLocalImageObjectUrls();
    clearClipboardObjectUrls();
    setRawText(record.rawText);
    if (richPasteRef.current) richPasteRef.current.textContent = record.rawText;
    setPastedImages(EMPTY_PASTED_IMAGES);
    setApplication({ applicationNo: record.applicationNo, items: record.parsedItems });
    setLookupFailedIds(new Set());
    setHistoryTitle(record.title);
    setHistoryMemo(record.memo);
    setAnalysisStatus({
      kind: "success",
      message: `저장된 이력을 다시 열었습니다: ${record.itemCount}개 품목`,
    });
  }

  function saveCurrentHistory(createNew: boolean) {
    try {
      const existingRecord = createNew
        ? undefined
        : historyRecords.find((record) => record.id === loadedHistoryId);
      const record = buildFreightBarcodeHistoryRecordFromCurrentState({
        applicationNo: application.applicationNo,
        rawText,
        items: application.items,
        title: historyTitle,
        memo: historyMemo,
        existingRecord,
      });

      saveFreightBarcodeHistory(record);
      setLoadedHistoryId(record.id);
      setLoadedServerHistoryId(undefined);
      setHistoryRecords(listFreightBarcodeHistory());
      setHistoryStatus(
        existingRecord ? "현재 작업 이력을 업데이트했습니다." : "새 작업 이력을 저장했습니다.",
      );
    } catch {
      setHistoryStatus("이력을 저장하지 못했습니다. 브라우저 저장 공간을 확인해주세요.");
    }
  }

  function reopenHistory(id: string) {
    const record = loadFreightBarcodeHistory(id);
    if (!record) {
      refreshHistoryRecords();
      setHistoryStatus("선택한 이력을 찾을 수 없습니다.");
      return;
    }

    restoreHistoryRecord(record);
    setLoadedHistoryId(record.id);
    setLoadedServerHistoryId(undefined);
    setHistoryStatus("로컬에 저장된 작업을 불러왔습니다. 미리보기에서 내용을 확인한 뒤 PDF로 저장하거나 인쇄할 수 있습니다.");
  }

  function removeHistory(id: string) {
    if (!window.confirm("이 작업요청 이력을 삭제하시겠습니까?")) return;

    deleteFreightBarcodeHistory(id);
    if (loadedHistoryId === id) {
      setLoadedHistoryId(undefined);
      setHistoryStatus("현재 열려 있던 이력을 삭제했습니다. 편집 중인 내용은 유지됩니다.");
    } else {
      setHistoryStatus("작업요청 이력을 삭제했습니다.");
    }
    refreshHistoryRecords();
  }


  async function saveCurrentServerHistory() {
    try {
      const response = await fetch("/api/freight-barcode-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          applicationNo: application.applicationNo,
          title: historyTitle,
          rawText,
          parsedItems: application.items,
          memo: historyMemo,
          source: loadedHistoryId || loadedServerHistoryId
            ? "restored-history"
            : "manual-paste",
        }),
      });
      if (!response.ok) throw new Error("History save request failed");
      const data = await response.json() as { record: FreightBarcodeHistoryRecord };
      setLoadedServerHistoryId(data.record.id);
      setLoadedHistoryId(undefined);
      await refreshServerHistoryRecords();
      setHistoryStatus("현재 작업을 임시 서버 이력에 저장했습니다.");
    } catch {
      setHistoryStatus(
        "서버 이력에 저장하지 못했습니다. 현재 편집 내용과 로컬 저장/PDF 기능은 그대로 유지됩니다.",
      );
    }
  }

  async function reopenServerHistory(id: string) {
    try {
      const response = await fetch(`/api/freight-barcode-requests/${encodeURIComponent(id)}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("History load request failed");
      const data = await response.json() as { record: FreightBarcodeHistoryRecord };
      restoreHistoryRecord(data.record);
      setLoadedServerHistoryId(data.record.id);
      setLoadedHistoryId(undefined);
      setHistoryStatus("서버에 저장된 작업을 불러왔습니다. PDF를 다시 저장하거나 인쇄할 수 있습니다.");
    } catch {
      setHistoryStatus(
        "서버 이력을 불러오지 못했습니다. 현재 편집 내용과 로컬 이력은 변경되지 않았습니다.",
      );
    }
  }

  async function removeServerHistory(id: string) {
    if (!window.confirm("이 서버 작업요청 이력을 삭제하시겠습니까?")) return;

    try {
      const response = await fetch(`/api/freight-barcode-requests/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("History delete request failed");
      if (loadedServerHistoryId === id) setLoadedServerHistoryId(undefined);
      await refreshServerHistoryRecords();
      setHistoryStatus("서버 작업요청 이력을 삭제했습니다.");
    } catch {
      setHistoryStatus("서버 이력을 삭제하지 못했습니다. 로컬 이력은 변경되지 않았습니다.");
    }
  }

  function printDocument(target: "work-request" | "labels") {
    setPrintTarget(target);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => window.print());
    });
  }

  async function copyKoreanMessage() {
    await navigator.clipboard.writeText(KOREAN_MESSAGE);
    setCopyLabel("복사 완료");
    window.setTimeout(() => setCopyLabel("한국어 메시지 복사"), 1500);
  }

  return (
    <div className={printTarget === "labels" ? "print-labels" : "print-work-request"}>
      <div className="freight-editing-ui">
        <PageHeader
          title="배대지 바코드 PDF 생성기"
          description="배송대행지 신청서 세부 페이지의 제품정보를 붙여넣어 바코드 작업요청서를 만듭니다."
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
          <div className="mb-5 rounded-lg border border-blue-200 bg-blue-50/60 p-4">
            <h3 className="font-semibold text-slate-950">이미지 포함 붙여넣기</h3>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              1688 장바구니나 배송대행지 신청서처럼 이미지가 포함된 영역을 복사한 뒤 여기에 붙여넣으면 이미지 URL을 함께 추출합니다.
            </p>
            <div
              ref={richPasteRef}
              contentEditable
              suppressContentEditableWarning
              onPaste={handleRichPaste}
              onInput={(event) => {
                setRawText(event.currentTarget.textContent ?? "");
                setAnalysisStatus(null);
              }}
              role="textbox"
              aria-label="이미지 포함 HTML 붙여넣기"
              aria-multiline="true"
              data-placeholder="이미지가 포함된 1688 장바구니 또는 배송대행지 신청서 영역을 여기에 붙여넣으세요."
              className="rich-paste-box mt-3 min-h-28 whitespace-pre-wrap rounded-lg border border-dashed border-blue-300 bg-white p-4 text-sm leading-6 text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-800">
                전체 이미지 {pastedImages.totalImages}개
              </span>
              <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800">
                상품 이미지 후보 {pastedImages.candidates.length}개
              </span>
              <span className="rounded-full bg-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700">
                제외 {pastedImages.ignoredImages}개
              </span>
            </div>
            {(pastedImages.candidates.length > 0 || pastedImages.excludedCandidates.length > 0) && (
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {pastedImages.candidates.map((candidate, index) => (
                  <ImageCandidateDiagnostic
                    key={`${candidate.url}-${index}`}
                    candidate={candidate}
                    label={`상품 이미지 후보 ${index + 1}`}
                    onLoadStatusChange={(status) => updateCandidateLoadStatus(candidate.url, status)}
                  />
                ))}
                {pastedImages.excludedCandidates.map((candidate, index) => (
                  <ImageCandidateDiagnostic
                    key={`${candidate.url ?? candidate.reason}-${index}`}
                    candidate={{ ...candidate, url: candidate.url ?? "", score: 0, loadStatus: "failed" }}
                    label={`제외 이미지 ${index + 1}`}
                    excluded
                  />
                ))}
              </div>
            )}
            <p className="mt-2 text-xs leading-5 text-slate-500">
              온돌패스에서 복사된 일부 1688 이미지는 외부 페이지에서 직접 열리지 않을 수 있습니다. 이미지가 필요한 품목만 상품마스터 이미지 또는 직접 이미지 URL로 보완해주세요.
            </p>
          </div>

          <label className="mb-2 block text-sm font-semibold text-slate-800" htmlFor="freight-plain-text">
            일반 텍스트 붙여넣기
          </label>
          <textarea
            id="freight-plain-text"
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
              일반 텍스트 입력도 그대로 사용할 수 있습니다. 상품 이미지 후보는 제품정보 블록별로 우선 연결됩니다.
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


        <section className="mb-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="freight-history-title">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 id="freight-history-title" className="font-semibold text-slate-950">작업요청 이력</h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                기존 브라우저 로컬 이력은 그대로 유지됩니다. 필요하면 현재 작업을 임시 서버 이력에도 저장해 다시 열 수 있습니다.
              </p>
            </div>
            {(loadedHistoryId || loadedServerHistoryId) && (
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
                {loadedServerHistoryId ? "서버 이력 편집 중" : "로컬 이력 편집 중"}
              </span>
            )}
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label>
              <span className="mb-1 block text-xs font-semibold text-slate-600">제목 (선택)</span>
              <input
                value={historyTitle}
                onChange={(event) => setHistoryTitle(event.target.value)}
                placeholder="예: 6월 2차 바코드 작업"
                className={inputClassName}
              />
            </label>
            <label>
              <span className="mb-1 block text-xs font-semibold text-slate-600">이력 메모 (선택)</span>
              <input
                value={historyMemo}
                onChange={(event) => setHistoryMemo(event.target.value)}
                placeholder="이력 목록에서 확인할 메모"
                className={inputClassName}
              />
            </label>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => saveCurrentHistory(false)} primary>현재 로컬 작업 저장</Button>
            <Button onClick={() => saveCurrentHistory(true)}>새 로컬 이력으로 저장</Button>
            <Button onClick={saveCurrentServerHistory}>서버 이력에 저장</Button>
            <Button onClick={refreshServerHistoryRecords}>서버 목록 새로고침</Button>
          </div>
          {historyStatus && (
            <p role="status" className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-xs font-medium text-slate-700">
              {historyStatus}
            </p>
          )}
          <p className="mt-3 text-xs leading-5 text-amber-700">
            로컬 이미지 파일은 브라우저 임시 이미지이므로, 이력을 다시 열었을 때 이미지가 표시되지 않으면 다시 선택해주세요.
          </p>

          <div className="mt-5">
            <h3 className="text-sm font-semibold text-slate-900">임시 서버 이력</h3>
            <p className="mt-1 text-xs text-slate-500">
              서버가 재시작되면 사라지는 임시 저장소이며, 영구 데이터베이스는 아직 연결되지 않았습니다.
            </p>
            <div className="mt-3 overflow-x-auto">
              {serverHistoryRecords.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
                  저장된 서버 작업요청 이력이 없습니다.
                </p>
              ) : (
                <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                  <thead className="bg-slate-100 text-xs text-slate-600">
                    <tr>
                      <th className="px-3 py-3 font-semibold">신청번호</th>
                      <th className="px-3 py-3 font-semibold">저장일시</th>
                      <th className="px-3 py-3 font-semibold">품목 / 매칭</th>
                      <th className="px-3 py-3 font-semibold">제목 / 메모</th>
                      <th className="px-3 py-3 font-semibold"><span className="sr-only">작업</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {serverHistoryRecords.map((record) => (
                      <tr key={record.id} className={`border-b border-slate-200 ${record.id === loadedServerHistoryId ? "bg-emerald-50/60" : ""}`}>
                        <td className="px-3 py-3 font-semibold text-slate-900">{record.applicationNo || "-"}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-xs text-slate-600">{formatHistoryDate(record.updatedAt)}</td>
                        <td className="px-3 py-3 text-slate-700">{record.itemCount}개 / {record.matchedItemCount}개</td>
                        <td className="max-w-sm px-3 py-3 text-slate-700">
                          <p className="font-medium text-slate-900">{record.title || "제목 없음"}</p>
                          {record.memo && <p className="mt-1 line-clamp-2 text-xs text-slate-500">{record.memo}</p>}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex justify-end gap-2">
                            <button type="button" onClick={() => reopenServerHistory(record.id)} className="rounded-md bg-slate-800 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-950">다시 열기</button>
                            <button type="button" onClick={() => removeServerHistory(record.id)} className="rounded-md border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50">삭제</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="mt-5 overflow-x-auto">
            <h3 className="mb-3 text-sm font-semibold text-slate-900">이 브라우저의 로컬 이력</h3>
            {historyRecords.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
                저장된 작업요청 이력이 없습니다.
              </p>
            ) : (
              <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                <thead className="bg-slate-100 text-xs text-slate-600">
                  <tr>
                    <th className="px-3 py-3 font-semibold">신청번호</th>
                    <th className="px-3 py-3 font-semibold">저장일시</th>
                    <th className="px-3 py-3 font-semibold">품목 수</th>
                    <th className="px-3 py-3 font-semibold">제목 / 메모</th>
                    <th className="px-3 py-3 font-semibold"><span className="sr-only">작업</span></th>
                  </tr>
                </thead>
                <tbody>
                  {historyRecords.map((record) => (
                    <tr key={record.id} className={`border-b border-slate-200 ${record.id === loadedHistoryId ? "bg-emerald-50/60" : ""}`}>
                      <td className="px-3 py-3 font-semibold text-slate-900">{record.applicationNo || "-"}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-xs text-slate-600">{formatHistoryDate(record.updatedAt)}</td>
                      <td className="px-3 py-3 text-slate-700">{record.items.length}개</td>
                      <td className="max-w-sm px-3 py-3 text-slate-700">
                        <p className="font-medium text-slate-900">{record.title || "제목 없음"}</p>
                        {record.memo && <p className="mt-1 line-clamp-2 text-xs text-slate-500">{record.memo}</p>}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex justify-end gap-2">
                          <button type="button" onClick={() => reopenHistory(record.id)} className="rounded-md bg-slate-800 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-950">다시 열기</button>
                          <button type="button" onClick={() => removeHistory(record.id)} className="rounded-md border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50">삭제</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
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
            <table className="w-full min-w-[2900px] border-collapse text-left text-xs">
              <thead className="bg-slate-100 text-slate-600">
                <tr>
                  {[
                    "순번", "품목", "옵션", "수량", "단가", "HS CODE", "상세URL", "이미지",
                    "오픈마켓 주문번호", "트래킹번호", "모델번호/모델명 입력", "바코드", "매칭상태",
                    "모델번호", "모델명", "작업메모", "소분단위", "바코드 출력수량",
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
                    imageCandidates={pastedImages.candidates}
                    lookupFailed={lookupFailedIds.has(item.id)}
                    onChange={(changes) => updateItem(item.id, changes)}
                    onLocalImageChange={(file) => updateLocalImage(item.id, file)}
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

        <section className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <h2 className="font-semibold">바코드 스캐너 확인</h2>
          <p className="mt-1 text-xs leading-5">
            스캐너 테스트 시 입력한 바코드값과 스캔 결과가 정확히 일치해야 합니다.
          </p>
          <div className="mt-2 space-y-1 text-xs">
            {application.items.map((item) => {
              const encodedValue = getEncodedBarcodeValue(item.barcode);
              return (
                <p key={item.id}>
                  {item.rowNo}번 · 입력값: {item.barcode || "-"} · 인코딩값: {encodedValue || "생성 안 함"}
                </p>
              );
            })}
          </div>
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
            <Button onClick={() => printDocument("work-request")} primary>작업요청서 PDF 저장/인쇄</Button>
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
        <BarcodeLabelOutput application={application} onPrint={() => printDocument("labels")} />
      </div>

      <WorkRequestPreview application={application} createdDate={createdDate} />
      <BarcodeLabelPrintPreview application={application} active={printTarget === "labels"} />
    </div>
  );
}

function formatHistoryDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function EditableRow({
  item,
  imageCandidates,
  lookupFailed,
  onChange,
  onLocalImageChange,
  onApply,
}: {
  item: FreightApplicationItem;
  imageCandidates: RichPasteImageCandidate[];
  lookupFailed: boolean;
  onChange: (changes: Partial<FreightApplicationItem>) => void;
  onLocalImageChange: (file?: File) => void;
  onApply: () => void;
}) {
  const status = item.matchedModelNo
    ? "Product Master matched"
    : "No Product Master match";
  const statusStyle = item.matchedModelNo
    ? "bg-emerald-50 text-emerald-700"
    : lookupFailed
      ? "bg-red-50 text-red-700"
      : "bg-amber-50 text-amber-700";
  const barcodeValue = item.barcode ?? "";
  const barcodeInvalid = Boolean(barcodeValue) && !isValidBarcodeValue(barcodeValue);

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
      <td className={cellClassName}>
        <div className="w-72 space-y-2">
          <label className="block space-y-1">
            <span className="block font-semibold text-slate-700">이미지 파일</span>
            <input
              key={item.localImageUrl ?? "no-local-image"}
              type="file"
              accept="image/*"
              onChange={(event) => onLocalImageChange(event.target.files?.[0])}
              className={`${inputClassName} file:mr-2 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1 file:text-xs file:font-semibold`}
            />
          </label>
          <p className="text-[11px] leading-4 text-slate-500">
            로컬 이미지 파일은 현재 화면/PDF 생성에만 사용되며 서버에 저장되지 않습니다.
          </p>
          {item.localImageUrl && (
            <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
              <FreightItemImage key={item.localImageUrl} sources={[item.localImageUrl]} alt={`${item.itemName} 로컬 이미지 미리보기`} className="size-14 rounded bg-white object-contain" />
              <button type="button" onClick={() => onLocalImageChange(undefined)} className="font-semibold text-slate-600 hover:text-slate-900">선택 해제</button>
            </div>
          )}
          <textarea value={item.imageUrl ?? ""} onChange={(event) => onChange({ imageUrl: event.target.value })} placeholder="직접 이미지 URL 입력" className={`${inputClassName} min-h-16 resize-y break-all`} />
          <p className="text-[11px] leading-4 text-slate-500">
            일부 외부 이미지 주소는 원본 사이트의 차단 정책 때문에 표시되지 않을 수 있습니다.<br />
            이미지가 꼭 필요한 경우 로컬 이미지 파일을 직접 선택하는 방식이 가장 안정적입니다.
          </p>
          <select
            aria-label={`${item.rowNo}행 이미지 후보 선택`}
            value={item.selectedImageCandidateUrl ?? ""}
            onChange={(event) => onChange({ selectedImageCandidateUrl: event.target.value || undefined })}
            className={inputClassName}
          >
            <option value="">이미지 후보 선택</option>
            {imageCandidates.map((candidate, index) => (
              <option
                key={`${candidate.url}-${index}`}
                value={candidate.url}
                disabled={candidate.loadStatus === "failed"}
              >
                후보 {index + 1} · {candidate.sourceType === "clipboard-file" ? "클립보드 파일" : candidate.loadStatus === "failed" ? "이미지 로딩 실패" : candidate.loadStatus === "pending" ? "로딩 확인 중" : "붙여넣기 이미지"}
              </option>
            ))}
          </select>
          {item.selectedImageCandidateUrl && imageCandidates.find((candidate) => candidate.url === item.selectedImageCandidateUrl)?.loadStatus === "failed" && (
            <p className="text-[11px] font-semibold leading-4 text-red-700">
              선택한 이미지가 로딩되지 않습니다. 다른 이미지 URL을 입력해주세요.
            </p>
          )}
        </div>
      </td>
      <td className={cellClassName}><input value={item.orderNo ?? ""} onChange={(event) => onChange({ orderNo: event.target.value })} className={`${inputClassName} w-48`} /></td>
      <td className={cellClassName}><input value={item.trackingNo ?? ""} onChange={(event) => onChange({ trackingNo: event.target.value })} className={`${inputClassName} w-40`} /></td>
      <td className={cellClassName}>
        <div className="w-52 space-y-2">
          <input value={item.lookupText ?? ""} onChange={(event) => onChange({ lookupText: event.target.value })} placeholder="예: aaa270 또는 말발굽 고리링" className={inputClassName} />
          <button type="button" onClick={onApply} className="w-full rounded-md bg-slate-800 px-3 py-2 font-semibold text-white hover:bg-slate-950">상품마스터 적용</button>
        </div>
      </td>
      <td className={cellClassName}>
        <label className="block w-44">
          <span className="sr-only">바코드</span>
          <input
            value={barcodeValue}
            onChange={(event) => onChange({ barcode: sanitizeBarcodeValue(event.target.value) })}
            placeholder="예: BAA1-1"
            aria-invalid={barcodeInvalid}
            className={`${inputClassName} ${
              barcodeInvalid
                ? "border-red-400 bg-red-50 focus:border-red-500 focus:ring-red-100"
                : ""
            }`}
          />
          {barcodeInvalid && (
            <span className="mt-1 block text-[11px] font-semibold leading-4 text-red-700">
              영문 대문자, 숫자, 하이픈(-)만 입력하세요.
            </span>
          )}
        </label>
      </td>
      <td className={cellClassName}><span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 font-semibold ${statusStyle}`}>{status}</span></td>
      <td className={cellClassName}><input value={item.matchedModelNo ?? ""} onChange={(event) => onChange({ matchedModelNo: event.target.value })} className={`${inputClassName} w-32`} /></td>
      <td className={cellClassName}><input value={item.matchedModelName ?? ""} onChange={(event) => onChange({ matchedModelName: event.target.value })} className={`${inputClassName} w-40`} /></td>
      <td className={cellClassName}>
        <textarea
          value={item.memo ?? ""}
          onChange={(event) => onChange({ memo: event.target.value })}
          placeholder={"예: 개별 부착\n10개씩 소분 후 바코드 부착\n50개씩 소분 후 바코드 부착\n100개씩 소분 후 바코드 부착\n박스 외부 바코드 부착"}
          aria-label={`${item.rowNo}행 작업메모`}
          className={`${inputClassName} min-h-28 w-60 resize-y`}
        />
      </td>
      <td className={cellClassName}>
        <input
          type="number"
          min="1"
          step="1"
          value={item.bundleUnit ?? calculateBarcodeLabelPrint({ quantity: item.quantity, memo: item.memo }).bundleUnit ?? ""}
          onChange={(event) => onChange({ bundleUnit: event.target.value ? Number(event.target.value) : undefined })}
          aria-label={`${item.rowNo}행 소분단위`}
          className={`${inputClassName} w-28`}
        />
      </td>
      <td className={cellClassName}>
        <input
          type="number"
          min="1"
          step="1"
          value={item.labelPrintCount ?? calculateBarcodeLabelPrint({ quantity: item.quantity, memo: item.memo, bundleUnit: item.bundleUnit }).printCount}
          onChange={(event) => onChange({ labelPrintCount: event.target.value ? Number(event.target.value) : undefined })}
          aria-label={`${item.rowNo}행 바코드 출력수량`}
          className={`${inputClassName} w-32`}
        />
      </td>
    </tr>
  );
}

function LocationBarcode({ value, compact = false }: { value?: string; compact?: boolean }) {
  const encodedValue = getEncodedBarcodeValue(value);

  if (!value) {
    return <span className="font-sans text-[10px] font-semibold">바코드 미입력</span>;
  }

  if (!encodedValue) {
    return (
      <span className="font-sans text-[10px] font-semibold text-red-700">
        바코드 형식 확인: {value}
      </span>
    );
  }

  // Keep every CODE128 bar proportional to the shared module width so the
  // larger compact label remains scan-safe without changing its encoding.
  const layout = createCode128Layout(encodedValue);
  const moduleWidth = compact ? 1.4 : 2;
  const barcodeHeight = compact ? 88 : 52;
  const svgWidth = layout.width * moduleWidth;

  return (
    <div className={`location-barcode mx-auto flex flex-col items-center bg-white text-black ${compact ? "label-location-barcode" : "min-w-36 p-1"}`}>
      <span className="mb-1 font-sans text-[11px] font-black tracking-wide">{BARCODE_ORIGIN_LABEL}</span>
      <svg
        aria-label={`바코드 ${encodedValue} CODE128B`}
        className="barcode-svg block bg-white"
        height={barcodeHeight}
        role="img"
        shapeRendering="crispEdges"
        viewBox={`0 0 ${svgWidth} ${barcodeHeight}`}
        width={svgWidth}
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect fill="#fff" height={barcodeHeight} width={svgWidth} />
        {layout.bars.map((bar, index) => (
          <rect
            key={`${bar.x}-${index}`}
            fill="#000"
            height={barcodeHeight}
            width={bar.width * moduleWidth}
            x={bar.x * moduleWidth}
          />
        ))}
      </svg>
      <span className="mt-1 font-mono text-[10px] font-bold tracking-wide">
        {encodedValue}
      </span>
    </div>
  );
}


function getItemLabelCalculation(item: FreightApplicationItem) {
  return calculateBarcodeLabelPrint({
    quantity: item.quantity,
    memo: item.memo,
    bundleUnit: item.bundleUnit,
    printCount: item.labelPrintCount,
  });
}

function getItemBundleUnitText(item: FreightApplicationItem): string {
  return formatBarcodeBundleUnit({
    quantity: item.quantity,
    memo: item.memo,
    bundleUnit: item.bundleUnit,
    printCount: item.labelPrintCount,
  });
}

function BarcodeLabelCard({
  item,
  preview = false,
}: {
  item: FreightApplicationItem;
  preview?: boolean;
}) {
  return (
    <article className={`barcode-label-card${preview ? " barcode-label-card-preview" : ""}`}>
      <LocationBarcode value={item.barcode} compact />
    </article>
  );
}

function BarcodeLabelOutput({ application, onPrint }: { application: FreightApplication; onPrint: () => void }) {
  const barcodeItems = application.items.filter((item) => item.barcode?.trim());
  const totalPrintCount = getTotalBarcodeLabelCount(
    application.items.map((item) => ({ ...item, printCount: item.labelPrintCount })),
  );
  const missingBarcodeItems = application.items.filter((item) => !item.barcode?.trim());
  const sampleLabels = buildBarcodeLabelPages(
    application.items.map((item) => ({ ...item, printCount: item.labelPrintCount })),
  ).slice(0, 3);

  return (
    <section className="mb-8 rounded-xl border border-violet-200 bg-violet-50 p-5 shadow-sm" aria-labelledby="barcode-label-output-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="barcode-label-output-title" className="font-semibold text-violet-950">개별 바코드 라벨 미리보기</h2>
          <p className="mt-1 text-xs leading-5 text-violet-800">
            화면에는 처음 3장만 표시하며, PDF에는 계산된 전체 수량이 한 페이지에 한 라벨씩 출력됩니다.
          </p>
        </div>
        <Button onClick={onPrint} primary>개별 바코드 라벨 PDF 저장/인쇄</Button>
      </div>
      <dl className="mt-4 grid gap-3 sm:grid-cols-3">
        <SummaryCard label="총 품목 수" value={`${application.items.length}개`} />
        <SummaryCard label="바코드 입력 품목 수" value={`${barcodeItems.length}개`} emphasized />
        <SummaryCard label="총 라벨 출력 수량" value={`${totalPrintCount}장`} emphasized />
      </dl>
      {missingBarcodeItems.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-900">
          {missingBarcodeItems.map((item) => (
            <p key={item.id}>{item.rowNo}번 품목 바코드 미입력 · 라벨 PDF에서 제외됩니다.</p>
          ))}
        </div>
      )}
      {sampleLabels.length > 0 && (
        <div className="mt-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-violet-950">개별 라벨 샘플</h3>
            <p className="text-xs font-semibold text-violet-800">총 {totalPrintCount}장 출력 예정</p>
          </div>
          <div className="grid gap-4 xl:grid-cols-3">
            {sampleLabels.map(({ item, labelNumber }) => (
              <BarcodeLabelCard
                item={item}
                key={`${item.id}-${labelNumber}`}
                preview
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function BarcodeLabelPrintPreview({ application, active }: { application: FreightApplication; active: boolean }) {
  const labels = active
    ? buildBarcodeLabelPages(
        application.items.map((item) => ({ ...item, printCount: item.labelPrintCount })),
      )
    : [];

  return (
    <div className="barcode-label-print-wrapper" aria-label="개별 바코드 라벨 인쇄 미리보기">
      <section className="barcode-label-sheet">
        {labels.map(({ item, labelNumber }, index) => (
          <div className="individual-label-page" key={`${item.id}-${labelNumber}-${index}`}>
            <BarcodeLabelCard item={item} />
          </div>
        ))}
        {active && labels.length === 0 && <p className="barcode-label-empty">출력할 바코드 라벨이 없습니다.</p>}
      </section>
    </div>
  );
}

function WorkRequestPreview({ application, createdDate }: { application: FreightApplication; createdDate: string }) {
  return (
    <div className="freight-print-wrapper">
      <section className="freight-print-area rounded-xl border border-slate-300 bg-white p-6 shadow-sm sm:p-8" aria-label="바코드 작업요청서 인쇄 미리보기">
        <div className="print-document-header border-b-2 border-slate-900 pb-4 text-center">
          <h2 className="text-2xl font-bold text-slate-950">바코드 작업요청서</h2>
        </div>
        <div className="print-document-meta mt-4 flex flex-wrap justify-between gap-2 text-sm">
          <p><strong>신청번호:</strong> {application.applicationNo || "-"}</p>
          <p><strong>생성일자:</strong> {createdDate}</p>
        </div>
        <div className="print-instructions mt-5 border-y border-slate-300 py-4 text-sm leading-6">
          <p>바코드 라벨 상단에는 MADE IN CHINA 문구가 포함되어 있으므로 원산지 스티커는 별도로 부착하지 않으셔도 됩니다.</p>
          <p>같은 상품이라도 옵션별로 바코드번호가 다를 수 있으니 상품 카드별로 구분해서 작업 부탁드립니다.</p>
        </div>
        <div className="print-card-list mt-5 space-y-4">
          {application.items.map((item) => {
            return (
              <article key={item.id} className="freight-item-card break-inside-avoid rounded-lg border-2 border-slate-800 p-4 text-xs text-slate-950">
                <div className="item-card-top grid grid-cols-[3rem_4.5rem_minmax(0,1fr)] gap-3">
                  <div className="flex h-12 items-center justify-center rounded border border-slate-400 text-lg font-bold">{item.rowNo}</div>
                  <div className="product-image flex size-[72px] items-center justify-center overflow-hidden rounded border border-slate-300 bg-white text-center text-[10px] text-slate-500">
                    <FreightItemImage
                      key={getFreightItemImageSources(item).join("|")}
                      sources={getFreightItemImageSources(item)}
                      alt={item.matchedModelName || item.itemName}
                      className="size-[72px] object-contain"
                    />
                  </div>
                  <dl className="min-w-0 space-y-1 leading-5">
                    <PrintField label="품목" value={item.matchedProductNameKo || item.itemName} />
                    <PrintField label="옵션" value={item.optionText} multiline />
                    <div className="grid gap-x-4 sm:grid-cols-2">
                      <PrintField label="제품 수량" value={String(item.quantity)} />
                      <PrintField label="HS CODE" value={item.hsCode} />
                      <PrintField label="트래킹번호" value={item.trackingNo} breakAll />
                      <PrintField label="오픈마켓 주문번호" value={item.orderNo} breakAll />
                    </div>
                  </dl>
                </div>

                <dl className="item-card-details mt-3 border-y border-slate-400 py-2">
                  <PrintField className="barcode-info-section" label="바코드" value={item.barcode?.trim() || "바코드 미입력"} mono />
                  <div className="label-calculation-fields grid gap-x-4 sm:grid-cols-2">
                    <PrintField label="소분단위" value={getItemBundleUnitText(item)} />
                    <PrintField label="바코드 출력수량" value={`${getItemLabelCalculation(item).printCount}장`} />
                  </div>
                  {item.memo?.trim() && (
                    <PrintField className="memo-section" label="작업메모" value={item.memo.trim()} multiline />
                  )}
                </dl>

                <div className="barcode-area py-3 text-center">
                  <LocationBarcode value={item.barcode} />
                </div>
              </article>
            );
          })}
        </div>
        {application.items.length === 0 && <p className="py-12 text-center text-sm text-slate-500">분석된 품목이 없습니다.</p>}
      </section>
    </div>
  );
}

function ImageCandidateDiagnostic({
  candidate,
  label,
  excluded = false,
  onLoadStatusChange,
}: {
  candidate: RichPasteImageCandidate;
  label: string;
  excluded?: boolean;
  onLoadStatusChange?: (status: "loaded" | "failed") => void;
}) {
  const [displayFailed, setDisplayFailed] = useState(!candidate.url);
  const failed = candidate.loadStatus === "failed" || displayFailed;
  const statusLabel = excluded
    ? "제외됨"
    : failed
      ? "이미지 로딩 실패"
      : candidate.loadStatus === "pending"
        ? "로딩 확인 중"
        : "정상 이미지";
  const statusStyle = excluded
    ? "bg-slate-200 text-slate-700"
    : failed
      ? "bg-red-100 text-red-700"
      : candidate.loadStatus === "pending"
        ? "bg-amber-100 text-amber-700"
        : "bg-emerald-100 text-emerald-700";

  return (
    <div className="flex min-w-0 items-center gap-3 rounded-lg border border-slate-200 bg-white p-2">
      <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded border border-slate-300 bg-slate-50 text-center text-[10px] font-semibold text-slate-500">
        {candidate.url && !displayFailed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={candidate.url}
            alt={label}
            className="size-full object-contain"
            onLoad={() => onLoadStatusChange?.("loaded")}
            onError={() => {
              setDisplayFailed(true);
              onLoadStatusChange?.("failed");
            }}
          />
        ) : (
          <span className="px-1">{excluded ? "제외된 이미지" : "이미지 로딩 실패"}</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-semibold text-slate-800">{label}</span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${statusStyle}`}>{statusLabel}</span>
        </div>
        <p className="mt-1 truncate text-[10px] text-slate-500" title={candidate.url}>{candidate.url || "직접 로드할 수 없는 이미지"}</p>
        <p className="mt-0.5 text-[10px] text-slate-500">{candidate.sourceType === "clipboard-file" ? "브라우저 임시 이미지" : excluded ? "상품 이미지 필터에서 제외" : "붙여넣기 URL"}</p>
      </div>
    </div>
  );
}

function FreightItemImage({
  sources,
  alt,
  className,
}: {
  sources: string[];
  alt: string;
  className?: string;
}) {
  const [sourceIndex, setSourceIndex] = useState(0);
  const source = sources[sourceIndex];
  if (!source) return <span className="px-1 font-semibold text-slate-500">이미지 없음</span>;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={source}
      alt={alt}
      className={className}
      onError={() => setSourceIndex((current) => current + 1)}
    />
  );
}

function PrintField({
  label,
  value,
  multiline = false,
  breakAll = false,
  mono = false,
  className = "",
}: {
  label: string;
  value?: string;
  multiline?: boolean;
  breakAll?: boolean;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={`min-w-0 ${className}`}>
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
