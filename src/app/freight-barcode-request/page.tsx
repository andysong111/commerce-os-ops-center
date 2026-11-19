"use client";

import {
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { PageHeader } from "@/components/PageHeader";
import {
  parseFreightApplicationBatchText,
  parseFreightApplicationText,
} from "@/lib/freightApplicationParser";
import {
  combineFreightApplications,
  parseFreightApplicationNumberList,
} from "@/lib/freightApplicationBatch";
import {
  applyFreightBundleUnitPreferences,
  findFreightBundleUnitPreference,
  isFreightBundleUnitEmpty,
  saveFreightBundleUnitPreference,
} from "@/lib/freightBundleUnitPreferences";
import { buildFreightForwarderMvpZip } from "@/lib/freightForwarderZipMvp";
import {
  applyFreightProductMasterMatches,
  type FreightProductMasterMatchResponse,
} from "@/lib/freightProductMasterMatcher";
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
  getSampleBarcodeLabelCount,
  getTotalBarcodeLabelCount,
} from "@/lib/barcodeLabelPrint";
import { buildFreightWorkRequestZip } from "@/lib/freightWorkRequestZip";
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
import {
  ONDOLPASS_FREIGHT_BRIDGE_CHANNEL,
  ONDOLPASS_FREIGHT_PAGE_SOURCE,
  buildOndolpassFreightDateRangeImport,
  buildOndolpassFreightImport,
  getOndolpassFreightBridgeErrorMessage,
  normalizeOndolpassDateRange,
  parseOndolpassFreightExtensionMessage,
} from "@/lib/ondolpassFreightBridge";
import type {
  RichPasteImageCandidate,
  RichPasteImageExtraction,
} from "@/lib/richPasteExtractor";
import {
  DEFAULT_PINNED_EDIT_TABLE_COLUMN_IDS,
  EDIT_TABLE_COLUMNS,
  EDIT_TABLE_PINNED_COLUMNS_STORAGE_KEY,
  EDIT_TABLE_TOTAL_WIDTH,
  MAX_PINNED_EDIT_TABLE_COLUMNS,
  getOrderedPinnedColumns,
  getPinnedColumnOffset,
  isLastPinnedColumn,
  normalizePinnedColumnIds,
  togglePinnedColumnId,
  type EditTableColumnId,
} from "@/lib/freightEditTableColumns";
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

const EMPTY_APPLICATION: FreightApplication = {
  applicationNo: "",
  applicationNos: [],
  items: [],
};
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

type OndolpassBridgeStatus =
  | { kind: "loading" | "success" | "warning" | "error"; message: string }
  | null;

type OndolpassBatchResult = {
  rawText: string;
  pastedImages: RichPasteImageExtraction;
  application: FreightApplication;
};

type OndolpassBatchState = {
  applicationNos: string[];
  currentIndex: number;
  results: OndolpassBatchResult[];
};

type BundleUnitLedgerResponse = {
  ok?: boolean;
  savedCount?: number;
  updates?: Array<{ barcode: string; bundleUnit: number; updatedAt: string }>;
  message?: string;
};

function combinePastedImageExtractions(
  results: OndolpassBatchResult[],
): RichPasteImageExtraction {
  let blockOffset = 0;
  return results.reduce<RichPasteImageExtraction>(
    (total, result) => {
      const shiftBlockIndex = (blockIndex: number | undefined) =>
        blockIndex === undefined ? undefined : blockIndex + blockOffset;
      total.totalImages += result.pastedImages.totalImages;
      total.ignoredImages += result.pastedImages.ignoredImages;
      total.candidates.push(
        ...result.pastedImages.candidates.map((candidate) => ({
          ...candidate,
          blockIndex: shiftBlockIndex(candidate.blockIndex),
        })),
      );
      total.excludedCandidates.push(
        ...result.pastedImages.excludedCandidates.map((candidate) => ({ ...candidate })),
      );
      total.productBlockCount += result.pastedImages.productBlockCount;
      blockOffset += result.pastedImages.productBlockCount;
      return total;
    },
    {
      totalImages: 0,
      candidates: [],
      excludedCandidates: [],
      ignoredImages: 0,
      productBlockCount: 0,
    },
  );
}

function downloadZipFile(zipBytes: Uint8Array, filename: string) {
  const blob = new Blob([new Uint8Array(zipBytes)], {
    type: "application/zip",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function requestFreightProductMasterMatches(
  application: FreightApplication,
): Promise<FreightProductMasterMatchResponse> {
  const draftId = new URLSearchParams(window.location.search).get("draft") ?? "";
  const response = await fetch("/api/freight-product-master-match", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...(draftId ? { draftId } : {}),
      items: application.items.map((item) => ({
        id: item.id,
        applicationNo: item.applicationNo,
        rowNo: item.rowNo,
        itemName: item.itemName,
        optionText: item.optionText,
        detailUrl: item.detailUrl,
        lookupText: item.lookupText,
        quantity: item.quantity,
        orderNo: item.orderNo,
        trackingNo: item.trackingNo,
      })),
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as
    | FreightProductMasterMatchResponse
    | { ok?: false; message?: string };
  if (!response.ok || payload.ok !== true) {
    throw new Error(
      "message" in payload && payload.message
        ? payload.message
        : "커머스OS 내부상품 자동매칭에 실패했습니다.",
    );
  }
  return payload;
}

function applyLiveProductMasterMatches(
  application: FreightApplication,
  response: FreightProductMasterMatchResponse,
) {
  const matched = applyFreightProductMasterMatches(
    application,
    response.matches,
  );
  return {
    ...matched,
    items: applyFreightBundleUnitPreferences(matched.items),
  };
}

function productMasterMatchMessage(
  prefix: string,
  response: FreightProductMasterMatchResponse,
) {
  const { total, matched, unmatched, ambiguous } = response.summary;
  const draftMatched = response.matches.filter(
    (match) => match.status === "MATCHED" && match.source === "PURCHASE_DRAFT",
  ).length;
  const masterMatched = matched - draftMatched;
  const orderAutoResolved =
    response.purchaseDraftResolution?.mode === "ORDER_NUMBER_AUTO";
  const sourceText = draftMatched
    ? ` · ${orderAutoResolved ? "1688 주문번호로 " : ""}발주초안 ${draftMatched}개${masterMatched ? `, 상품마스터 ${masterMatched}개` : ""}`
    : "";
  return `${prefix} 내부상품 ${matched}/${total}개 자동매칭 완료${sourceText}${
    unmatched ? ` · 미등록/옵션 불일치 ${unmatched}개` : ""
  }${ambiguous ? ` · 중복 후보 확인 필요 ${ambiguous}개` : ""}`;
}

export default function FreightBarcodeRequestPage() {
  const [rawText, setRawText] = useState("");
  const [ondolpassApplicationNo, setOndolpassApplicationNo] = useState("");
  const [ondolpassStartDate, setOndolpassStartDate] = useState("");
  const [ondolpassEndDate, setOndolpassEndDate] = useState("");
  const [ondolpassBridgeReady, setOndolpassBridgeReady] = useState(false);
  const [ondolpassBridgeStatus, setOndolpassBridgeStatus] =
    useState<OndolpassBridgeStatus>(null);
  const [pastedImages, setPastedImages] =
    useState<RichPasteImageExtraction>(EMPTY_PASTED_IMAGES);
  const richPasteRef = useRef<HTMLDivElement>(null);
  const editTableTopScrollRef = useRef<HTMLDivElement>(null);
  const editTableScrollRef = useRef<HTMLDivElement>(null);
  const clipboardObjectUrlsRef = useRef<string[]>([]);
  const localImageObjectUrlsRef = useRef<Map<string, string>>(new Map());
  const ondolpassRequestRef = useRef<{
    requestId: string;
    applicationNo: string;
  } | null>(null);
  const ondolpassBatchRef = useRef<OndolpassBatchState | null>(null);
  const ondolpassDateRangeRequestRef = useRef<{
    requestId: string;
    startDate: string;
    endDate: string;
  } | null>(null);
  const startOndolpassRequestRef = useRef<
    (applicationNo: string, currentIndex: number, totalCount: number) => void
  >(() => undefined);
  const ondolpassTimeoutRef = useRef<number | undefined>(undefined);
  const ondolpassDateRangeTimeoutRef = useRef<number | undefined>(undefined);
  const [application, setApplication] =
    useState<FreightApplication>(EMPTY_APPLICATION);
  const [lookupFailedIds, setLookupFailedIds] = useState<Set<string>>(
    new Set(),
  );
  const [copyLabel, setCopyLabel] = useState("한국어 메시지 복사");
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus | null>(
    null,
  );
  const [productMasterMatchStatus, setProductMasterMatchStatus] =
    useState<AnalysisStatus | null>(null);
  const [productMasterMatchBusy, setProductMasterMatchBusy] = useState(false);
  const [historyRecords, setHistoryRecords] = useState<
    FreightBarcodeHistoryRecord[]
  >([]);
  const [serverHistoryRecords, setServerHistoryRecords] = useState<
    FreightBarcodeHistoryRecord[]
  >([]);
  const [loadedHistoryId, setLoadedHistoryId] = useState<string>();
  const [loadedServerHistoryId, setLoadedServerHistoryId] = useState<string>();
  const [historyTitle, setHistoryTitle] = useState("");
  const [historyMemo, setHistoryMemo] = useState("");
  const [historyStatus, setHistoryStatus] = useState("");
  const [freightForwarderZipStatus, setFreightForwarderZipStatus] =
    useState("");
  const [workRequestZipStatus, setWorkRequestZipStatus] = useState("");
  const [workRequestZipBusy, setWorkRequestZipBusy] = useState(false);
  const [bulkBundleUnit, setBulkBundleUnit] = useState("");
  const [bulkBundleNote, setBulkBundleNote] = useState("");
  const [bundleUnitLedgerStatus, setBundleUnitLedgerStatus] = useState("");
  const bundleUnitSyncTimerRef = useRef<number | undefined>(undefined);
  const bundleUnitSyncSequenceRef = useRef(0);
  const lastBundleUnitSyncSignatureRef = useRef("");
  const [pinnedColumnIds, setPinnedColumnIds] = useState<EditTableColumnId[]>(
    DEFAULT_PINNED_EDIT_TABLE_COLUMN_IDS,
  );
  const [pinnedColumnsStorageReady, setPinnedColumnsStorageReady] =
    useState(false);
  const createdDate = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const matchedCount = application.items.filter(
    (item) => item.matchedModelNo,
  ).length;

  useEffect(() => {
    const latestByBarcode = new Map<
      string,
      { barcode: string; bundleUnit: number; updatedAt: string }
    >();
    for (const item of application.items) {
      const barcode = (item.barcode ?? "").trim().toUpperCase();
      const bundleUnit = Number(item.bundleUnit);
      const updatedAt = item.bundleUnitUpdatedAt ?? "";
      if (
        !/^B[A-Z]{2}\d+-\d+$/.test(barcode) ||
        !Number.isSafeInteger(bundleUnit) ||
        bundleUnit < 1 ||
        !Number.isFinite(Date.parse(updatedAt))
      ) continue;
      const current = latestByBarcode.get(barcode);
      if (!current || Date.parse(current.updatedAt) <= Date.parse(updatedAt)) {
        latestByBarcode.set(barcode, { barcode, bundleUnit, updatedAt });
      }
    }
    const updates = [...latestByBarcode.values()].sort((left, right) =>
      left.barcode.localeCompare(right.barcode),
    );
    const signature = JSON.stringify(updates);
    if (!updates.length || signature === lastBundleUnitSyncSignatureRef.current) return;
    if (bundleUnitSyncTimerRef.current !== undefined) {
      window.clearTimeout(bundleUnitSyncTimerRef.current);
    }
    bundleUnitSyncTimerRef.current = window.setTimeout(async () => {
      const sequence = ++bundleUnitSyncSequenceRef.current;
      lastBundleUnitSyncSignatureRef.current = signature;
      setBundleUnitLedgerStatus(`B코드 ${updates.length}개의 소분단위를 상품마스터에 저장 중입니다.`);
      try {
        const response = await fetch("/api/freight-bundle-units", {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          credentials: "same-origin",
          cache: "no-store",
          body: JSON.stringify({ updates }),
        });
        const body = (await response.json().catch(() => ({}))) as BundleUnitLedgerResponse;
        if (!response.ok || body.ok !== true || !Array.isArray(body.updates)) {
          throw new Error(body.message || "상품마스터 소분단위 저장에 실패했습니다.");
        }
        if (sequence !== bundleUnitSyncSequenceRef.current) return;
        const storedByBarcode = new Map(
          body.updates.map((row) => [row.barcode.trim().toUpperCase(), row] as const),
        );
        setApplication((current) => ({
          ...current,
          items: current.items.map((item) => {
            const stored = storedByBarcode.get((item.barcode ?? "").trim().toUpperCase());
            if (!stored) return item;
            const localTime = Date.parse(item.bundleUnitUpdatedAt ?? "");
            const storedTime = Date.parse(stored.updatedAt);
            if (Number.isFinite(localTime) && localTime > storedTime) return item;
            if (
              item.bundleUnit === stored.bundleUnit &&
              item.bundleUnitUpdatedAt === stored.updatedAt
            ) return item;
            return {
              ...item,
              bundleUnit: stored.bundleUnit,
              bundleUnitUpdatedAt: stored.updatedAt,
            };
          }),
        }));
        setBundleUnitLedgerStatus(
          `상품마스터 B코드 원장에 소분단위 ${body.savedCount ?? body.updates.length}개를 저장했습니다.`,
        );
      } catch (error) {
        if (sequence !== bundleUnitSyncSequenceRef.current) return;
        lastBundleUnitSyncSignatureRef.current = "";
        setBundleUnitLedgerStatus(
          error instanceof Error
            ? `소분단위 원장 저장 확인 필요: ${error.message}`
            : "소분단위 원장 저장 확인이 필요합니다.",
        );
      }
    }, 450);
    return () => {
      if (bundleUnitSyncTimerRef.current !== undefined) {
        window.clearTimeout(bundleUnitSyncTimerRef.current);
        bundleUnitSyncTimerRef.current = undefined;
      }
    };
  }, [application.items]);

  useEffect(() => {
    function clearPendingRequest() {
      if (ondolpassTimeoutRef.current !== undefined) {
        window.clearTimeout(ondolpassTimeoutRef.current);
        ondolpassTimeoutRef.current = undefined;
      }
      ondolpassRequestRef.current = null;
    }

    function clearPendingDateRangeRequest() {
      if (ondolpassDateRangeTimeoutRef.current !== undefined) {
        window.clearTimeout(ondolpassDateRangeTimeoutRef.current);
        ondolpassDateRangeTimeoutRef.current = undefined;
      }
      ondolpassDateRangeRequestRef.current = null;
    }

    function startRequest(
      applicationNo: string,
      currentIndex: number,
      totalCount: number,
    ) {
      clearPendingRequest();
      const requestId = crypto.randomUUID();
      ondolpassRequestRef.current = { requestId, applicationNo };
      setOndolpassBridgeStatus({
        kind: "loading",
        message: `신청서 ${applicationNo}의 제품정보를 읽는 중입니다. (${currentIndex + 1}/${totalCount})`,
      });
      ondolpassTimeoutRef.current = window.setTimeout(() => {
        if (ondolpassRequestRef.current?.requestId !== requestId) return;
        clearPendingRequest();
        ondolpassBatchRef.current = null;
        setOndolpassBridgeStatus({
          kind: "error",
          message: `신청서 ${applicationNo} 가져오기가 제한시간 안에 끝나지 않았습니다. 온돌패스 로그인과 인터넷 연결을 확인한 뒤 다시 시도해주세요.`,
        });
      }, 35_000);

      window.postMessage(
        {
          channel: ONDOLPASS_FREIGHT_BRIDGE_CHANNEL,
          source: ONDOLPASS_FREIGHT_PAGE_SOURCE,
          type: "FETCH_APPLICATION",
          requestId,
          applicationNo,
        },
        window.location.origin,
      );
    }
    startOndolpassRequestRef.current = startRequest;

    async function handleBridgeMessage(event: MessageEvent) {
      if (event.source !== window || event.origin !== window.location.origin) {
        return;
      }

      const message = parseOndolpassFreightExtensionMessage(event.data);
      if (!message) return;
      if (message.type === "READY") {
        setOndolpassBridgeReady(true);
        return;
      }

      if (
        message.type === "DATE_RANGE_RESULT" ||
        message.type === "DATE_RANGE_ERROR"
      ) {
        const pendingRange = ondolpassDateRangeRequestRef.current;
        if (!pendingRange || message.requestId !== pendingRange.requestId) return;
        if (
          message.startDate !== pendingRange.startDate ||
          message.endDate !== pendingRange.endDate
        ) {
          clearPendingDateRangeRequest();
          setOndolpassBridgeStatus({
            kind: "error",
            message: "요청한 신청일과 브리지 응답 기간이 달라 적용하지 않았습니다.",
          });
          return;
        }
        if (message.type === "DATE_RANGE_ERROR") {
          clearPendingDateRangeRequest();
          setOndolpassBridgeStatus({
            kind: "error",
            message: getOndolpassFreightBridgeErrorMessage(message.errorCode),
          });
          return;
        }

        try {
          const rangeImport = buildOndolpassFreightDateRangeImport(
            message.payload,
            pendingRange.startDate,
            pendingRange.endDate,
          );
          clearPendingDateRangeRequest();
          if (rangeImport.applicationNos.length === 0) {
            setOndolpassApplicationNo("");
            setOndolpassBridgeStatus({
              kind: "warning",
              message: `${rangeImport.startDate}~${rangeImport.endDate} 신청서가 없습니다.`,
            });
            return;
          }
          setOndolpassApplicationNo(rangeImport.applicationNos.join(", "));
          setOndolpassBridgeStatus({
            kind: "loading",
            message: `${rangeImport.startDate}~${rangeImport.endDate} 신청서 ${rangeImport.applicationNos.length}건을 찾았습니다. 상세 품목을 순차 조회합니다.`,
          });
          ondolpassBatchRef.current = {
            applicationNos: rangeImport.applicationNos,
            currentIndex: 0,
            results: [],
          };
          startRequest(
            rangeImport.applicationNos[0],
            0,
            rangeImport.applicationNos.length,
          );
        } catch (error) {
          clearPendingDateRangeRequest();
          setOndolpassBridgeStatus({
            kind: "error",
            message:
              error instanceof Error
                ? `${error.message} 자동 적용을 중단했습니다.`
                : "온돌패스 날짜 조회 결과 검증에 실패했습니다.",
          });
        }
        return;
      }

      const pending = ondolpassRequestRef.current;
      if (!pending || message.requestId !== pending.requestId) return;
      if (message.applicationNo !== pending.applicationNo) {
        clearPendingRequest();
        ondolpassBatchRef.current = null;
        setOndolpassBridgeStatus({
          kind: "error",
          message: "요청한 번호와 브리지 응답 번호가 달라 적용하지 않았습니다.",
        });
        return;
      }

      if (message.type === "ERROR") {
        clearPendingRequest();
        ondolpassBatchRef.current = null;
        setOndolpassBridgeStatus({
          kind: "error",
          message: `신청서 ${pending.applicationNo}: ${getOndolpassFreightBridgeErrorMessage(message.errorCode)}`,
        });
        return;
      }

      try {
        const imported = buildOndolpassFreightImport(
          message.payload,
          pending.applicationNo,
        );
        const parsedApplication = parseFreightApplicationText(imported.rawText);
        if (
          parsedApplication.applicationNo !== imported.applicationNo ||
          parsedApplication.items.length !== imported.itemCount
        ) {
          throw new Error("가져온 품목 수와 분석된 품목 수가 다릅니다.");
        }

        const applicationWithImages = {
          ...parsedApplication,
          items: applyFreightBundleUnitPreferences(
            assignPastedImagesToItems(
              parsedApplication.items,
              imported.pastedImages,
            ),
          ),
        };
        const batch = ondolpassBatchRef.current;
        if (!batch || batch.applicationNos[batch.currentIndex] !== imported.applicationNo) {
          throw new Error("현재 가져오기 순서와 응답 신청서가 일치하지 않습니다.");
        }
        batch.results.push({
          rawText: imported.rawText,
          pastedImages: imported.pastedImages,
          application: applicationWithImages,
        });
        clearPendingRequest();

        const nextIndex = batch.currentIndex + 1;
        if (nextIndex < batch.applicationNos.length) {
          batch.currentIndex = nextIndex;
          startRequest(batch.applicationNos[nextIndex], nextIndex, batch.applicationNos.length);
          return;
        }

        const combinedRawText = batch.results
          .map((result) => result.rawText)
          .join("\n\n");
        const combinedPastedImages = combinePastedImageExtractions(batch.results);
        const combinedApplication = combineFreightApplications(
          batch.results.map((result) => result.application),
        );
        const importedApplicationNos = [...batch.applicationNos];
        clipboardObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
        clipboardObjectUrlsRef.current = [];
        localImageObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
        localImageObjectUrlsRef.current.clear();
        setRawText(combinedRawText);
        setPastedImages(combinedPastedImages);
        if (richPasteRef.current) richPasteRef.current.textContent = combinedRawText;
        setApplication(combinedApplication);
        setLookupFailedIds(new Set());
        setLoadedHistoryId(undefined);
        setLoadedServerHistoryId(undefined);
        setHistoryTitle("");
        setHistoryMemo("");
        setHistoryStatus("");
        setAnalysisStatus({
          kind: "success",
          message: `자동 분석 완료: 신청서 ${importedApplicationNos.length}건에서 ${combinedApplication.items.length}개 품목을 찾았습니다. 발주초안과 상품마스터를 확인하는 중입니다.`,
        });
        setOndolpassBridgeStatus({
          kind: "loading",
          message: `신청서 품목을 가져왔습니다. 발주초안 우선으로 내부상품을 자동매칭하는 중입니다.`,
        });
        ondolpassBatchRef.current = null;
        setProductMasterMatchBusy(true);
        setProductMasterMatchStatus({
          kind: "warning",
          message: "발주초안 우선으로 커머스OS 내부상품과 자동매칭하는 중입니다.",
        });
        try {
          const matchResponse = await requestFreightProductMasterMatches(
            combinedApplication,
          );
          const matchedApplication = applyLiveProductMasterMatches(
            combinedApplication,
            matchResponse,
          );
          setApplication(matchedApplication);
          const message = productMasterMatchMessage(
            `신청서 ${importedApplicationNos.length}건 ·`,
            matchResponse,
          );
          setAnalysisStatus({
            kind:
              matchResponse.summary.unmatched > 0 ||
              matchResponse.summary.ambiguous > 0
                ? "warning"
                : "success",
            message,
          });
          setProductMasterMatchStatus({
            kind:
              matchResponse.summary.unmatched > 0 ||
              matchResponse.summary.ambiguous > 0
                ? "warning"
                : "success",
            message,
          });
          setOndolpassBridgeStatus({
            kind:
              matchResponse.summary.unmatched > 0 ||
              matchResponse.summary.ambiguous > 0
                ? "warning"
                : "success",
            message: `신청서 ${importedApplicationNos.join(", ")}의 제품정보 ${combinedApplication.items.length}개와 상품 이미지 ${combinedPastedImages.candidates.length}개를 가져왔습니다. ${productMasterMatchMessage("", matchResponse)}`,
          });
        } catch (matchError) {
          const message =
            matchError instanceof Error
              ? matchError.message
              : "내부상품 자동매칭에 실패했습니다.";
          setAnalysisStatus({
            kind: "warning",
            message: `신청서 분석은 완료했지만 ${message} 품목 원문은 그대로 유지했습니다.`,
          });
          setProductMasterMatchStatus({ kind: "warning", message });
          setOndolpassBridgeStatus({
            kind: "warning",
            message: `신청서 ${importedApplicationNos.join(", ")}의 품목과 이미지는 가져왔지만 ${message}`,
          });
        } finally {
          setProductMasterMatchBusy(false);
        }
      } catch (error) {
        clearPendingRequest();
        ondolpassBatchRef.current = null;
        setOndolpassBridgeStatus({
          kind: "error",
          message:
            error instanceof Error
              ? `${error.message} 자동 적용을 중단했습니다.`
              : "신청서 검증에 실패해 자동 적용을 중단했습니다.",
        });
      }
    }

    window.addEventListener("message", handleBridgeMessage);
    const pingDelays = [0, 500, 1_500].map((delay) =>
      window.setTimeout(() => {
        window.postMessage(
          {
            channel: ONDOLPASS_FREIGHT_BRIDGE_CHANNEL,
            source: ONDOLPASS_FREIGHT_PAGE_SOURCE,
            type: "PING",
          },
          window.location.origin,
        );
      }, delay),
    );

    return () => {
      window.removeEventListener("message", handleBridgeMessage);
      pingDelays.forEach((timeoutId) => window.clearTimeout(timeoutId));
      if (ondolpassTimeoutRef.current !== undefined) {
        window.clearTimeout(ondolpassTimeoutRef.current);
      }
      if (ondolpassDateRangeTimeoutRef.current !== undefined) {
        window.clearTimeout(ondolpassDateRangeTimeoutRef.current);
      }
      startOndolpassRequestRef.current = () => undefined;
    };
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      try {
        const storedValue = window.localStorage.getItem(
          EDIT_TABLE_PINNED_COLUMNS_STORAGE_KEY,
        );
        setPinnedColumnIds(
          storedValue
            ? normalizePinnedColumnIds(JSON.parse(storedValue))
            : DEFAULT_PINNED_EDIT_TABLE_COLUMN_IDS,
        );
      } catch {
        setPinnedColumnIds(DEFAULT_PINNED_EDIT_TABLE_COLUMN_IDS);
      } finally {
        setPinnedColumnsStorageReady(true);
      }
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    if (!pinnedColumnsStorageReady) return;

    window.localStorage.setItem(
      EDIT_TABLE_PINNED_COLUMNS_STORAGE_KEY,
      JSON.stringify(normalizePinnedColumnIds(pinnedColumnIds)),
    );
  }, [pinnedColumnIds, pinnedColumnsStorageReady]);

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

  function importOndolpassApplication() {
    let applicationNos: string[];
    try {
      applicationNos = parseFreightApplicationNumberList(ondolpassApplicationNo);
    } catch (error) {
      setOndolpassBridgeStatus({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "신청서 번호를 확인해주세요.",
      });
      return;
    }

    setOndolpassApplicationNo(applicationNos.join(", "));
    if (!ondolpassBridgeReady) {
      setOndolpassBridgeStatus({
        kind: "error",
        message:
          "온돌패스 브리지 확장이 연결되지 않았습니다. 확장을 설치하거나 켠 뒤 이 화면을 새로고침해주세요.",
      });
      return;
    }

    ondolpassBatchRef.current = { applicationNos, currentIndex: 0, results: [] };
    startOndolpassRequestRef.current(applicationNos[0], 0, applicationNos.length);
  }

  function importOndolpassDateRange() {
    let dateRange: { startDate: string; endDate: string };
    try {
      dateRange = normalizeOndolpassDateRange(
        ondolpassStartDate,
        ondolpassEndDate,
      );
    } catch (error) {
      setOndolpassBridgeStatus({
        kind: "error",
        message:
          error instanceof Error ? error.message : "신청일 범위를 확인해주세요.",
      });
      return;
    }
    if (!ondolpassBridgeReady) {
      setOndolpassBridgeStatus({
        kind: "error",
        message:
          "온돌패스 브리지 확장이 연결되지 않았습니다. 확장을 설치하거나 켠 뒤 이 화면을 새로고침해주세요.",
      });
      return;
    }

    const requestId = crypto.randomUUID();
    ondolpassDateRangeRequestRef.current = { requestId, ...dateRange };
    setOndolpassBridgeStatus({
      kind: "loading",
      message: `${dateRange.startDate}~${dateRange.endDate} 온돌패스 신청서를 조회하는 중입니다.`,
    });
    if (ondolpassDateRangeTimeoutRef.current !== undefined) {
      window.clearTimeout(ondolpassDateRangeTimeoutRef.current);
    }
    ondolpassDateRangeTimeoutRef.current = window.setTimeout(() => {
      if (ondolpassDateRangeRequestRef.current?.requestId !== requestId) return;
      ondolpassDateRangeRequestRef.current = null;
      ondolpassDateRangeTimeoutRef.current = undefined;
      setOndolpassBridgeStatus({
        kind: "error",
        message:
          "온돌패스 날짜 조회가 제한시간 안에 끝나지 않았습니다. 로그인과 인터넷 연결을 확인해주세요.",
      });
    }, 35_000);
    window.postMessage(
      {
        channel: ONDOLPASS_FREIGHT_BRIDGE_CHANNEL,
        source: ONDOLPASS_FREIGHT_PAGE_SOURCE,
        type: "FETCH_DATE_RANGE",
        requestId,
        ...dateRange,
      },
      window.location.origin,
    );
  }

  async function analyzeText() {
    clearLocalImageObjectUrls();
    try {
      const parsedApplication = parseFreightApplicationBatchText(rawText);
      const applicationWithPastedImages = {
        ...parsedApplication,
        items: applyFreightBundleUnitPreferences(
          assignPastedImagesToItems(parsedApplication.items, pastedImages),
        ),
      };
      setApplication(applicationWithPastedImages);
      setProductMasterMatchStatus(null);
      const hasParseWarnings = Boolean(
        parsedApplication.diagnostics?.warnings.length,
      );
      setAnalysisStatus(
        parsedApplication.items.length > 0
          ? {
              kind: hasParseWarnings ? "warning" : "success",
              message: `분석 완료: 신청서 ${parsedApplication.applicationNos?.length || 1}건에서 ${parsedApplication.items.length}개 품목을 찾았습니다.${
                hasParseWarnings ? " 일부 품목은 값이 없어 제외되었습니다." : ""
              } 발주초안과 상품마스터를 확인하는 중입니다.`,
            }
          : { kind: "warning", message: NO_ITEMS_WARNING },
      );
      if (applicationWithPastedImages.items.length > 0) {
        setProductMasterMatchBusy(true);
        setProductMasterMatchStatus({
          kind: "warning",
          message: "발주초안 우선으로 커머스OS 내부상품과 자동매칭하는 중입니다.",
        });
        try {
          const matchResponse = await requestFreightProductMasterMatches(
            applicationWithPastedImages,
          );
          const matchedApplication = applyLiveProductMasterMatches(
            applicationWithPastedImages,
            matchResponse,
          );
          setApplication(matchedApplication);
          const message = productMasterMatchMessage("분석 완료 ·", matchResponse);
          const kind =
            matchResponse.summary.unmatched > 0 ||
            matchResponse.summary.ambiguous > 0
              ? "warning"
              : "success";
          setAnalysisStatus({ kind, message });
          setProductMasterMatchStatus({ kind, message });
        } catch (matchError) {
          const message =
            matchError instanceof Error
              ? matchError.message
              : "내부상품 자동매칭에 실패했습니다.";
          setAnalysisStatus({
            kind: "warning",
            message: `신청서 분석은 완료했지만 ${message} 품목 원문은 그대로 유지했습니다.`,
          });
          setProductMasterMatchStatus({ kind: "warning", message });
        } finally {
          setProductMasterMatchBusy(false);
        }
      }
    } catch {
      setApplication(EMPTY_APPLICATION);
      setAnalysisStatus({ kind: "error", message: ANALYSIS_ERROR });
      setProductMasterMatchStatus(null);
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
    const parsedApplication = parseFreightApplicationBatchText(SAMPLE_TEXT);
    setRawText(SAMPLE_TEXT);
    clearClipboardObjectUrls();
    setPastedImages(EMPTY_PASTED_IMAGES);
    if (richPasteRef.current) richPasteRef.current.textContent = SAMPLE_TEXT;
    setApplication({
      ...parsedApplication,
      items: applyFreightBundleUnitPreferences(parsedApplication.items),
    });
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
    setFreightForwarderZipStatus("");
    setWorkRequestZipStatus("");
  }

  function reset() {
    setRawText("");
    clearLocalImageObjectUrls();
    clearClipboardObjectUrls();
    setPastedImages(EMPTY_PASTED_IMAGES);
    if (richPasteRef.current) richPasteRef.current.textContent = "";
    setApplication(EMPTY_APPLICATION);
    setAnalysisStatus(null);
    setProductMasterMatchStatus(null);
    setProductMasterMatchBusy(false);
    setOndolpassApplicationNo("");
    setOndolpassStartDate("");
    setOndolpassEndDate("");
    setOndolpassBridgeStatus(null);
    if (ondolpassTimeoutRef.current !== undefined) {
      window.clearTimeout(ondolpassTimeoutRef.current);
      ondolpassTimeoutRef.current = undefined;
    }
    ondolpassRequestRef.current = null;
    if (ondolpassDateRangeTimeoutRef.current !== undefined) {
      window.clearTimeout(ondolpassDateRangeTimeoutRef.current);
      ondolpassDateRangeTimeoutRef.current = undefined;
    }
    ondolpassDateRangeRequestRef.current = null;
    ondolpassBatchRef.current = null;
    setLookupFailedIds(new Set());
    setLoadedHistoryId(undefined);
    setLoadedServerHistoryId(undefined);
    setHistoryTitle("");
    setHistoryMemo("");
    setHistoryStatus("");
    setFreightForwarderZipStatus("");
    setWorkRequestZipStatus("");
  }

  function updateApplicationNo(value: string) {
    setApplication((current) => {
      let applicationNos: string[] | undefined;
      try {
        applicationNos = parseFreightApplicationNumberList(value);
      } catch {
        applicationNos = undefined;
      }
      const shouldUpdateEveryItem =
        applicationNos?.length === 1 && (current.applicationNos?.length ?? 1) <= 1;
      return {
        ...current,
        applicationNo: value,
        ...(applicationNos ? { applicationNos } : {}),
        items: shouldUpdateEveryItem
          ? current.items.map((item) => ({ ...item, applicationNo: applicationNos?.[0] }))
          : current.items,
      };
    });
  }

  function updateItem(id: string, changes: Partial<FreightApplicationItem>) {
    setApplication((current) => {
      const items = current.items.map((item) => {
        if (item.id !== id) return item;
        const next = { ...item, ...changes };
        if (changes.barcode !== undefined) {
          const preference = findFreightBundleUnitPreference(changes.barcode);
          if (preference) {
            next.bundleUnit = preference.bundleUnit;
            next.bundleUnitUpdatedAt = preference.updatedAt;
          }
        }
        if (
          changes.bundleUnit !== undefined &&
          changes.bundleUnitUpdatedAt === undefined
        ) {
          const saved = saveFreightBundleUnitPreference(
            next.barcode,
            changes.bundleUnit,
          );
          if (saved) next.bundleUnitUpdatedAt = saved.updatedAt;
        }
        return next;
      });
      if (changes.applicationNo === undefined) return { ...current, items };
      const applicationNos = [
        ...new Set(items.map((item) => item.applicationNo?.trim()).filter(Boolean)),
      ] as string[];
      return {
        ...current,
        applicationNo: applicationNos.join(", "),
        applicationNos,
        items,
      };
    });
  }

  function rememberItemBundleUnit(id: string) {
    const item = application.items.find((candidate) => candidate.id === id);
    if (!item) return;
    const saved = saveFreightBundleUnitPreference(item.barcode, item.bundleUnit);
    if (saved) {
      updateItem(id, {
        bundleUnit: saved.bundleUnit,
        bundleUnitUpdatedAt: saved.updatedAt,
      });
    }
  }

  function rerunAutoImageMatching() {
    setApplication((current) => {
      const assignedItems = assignPastedImagesToItems(
        current.items,
        pastedImages,
      );

      return {
        ...current,
        items: current.items.map((item, index) => {
          const hasManualOrLocalImage = Boolean(
            item.localImageUrl ||
            item.selectedImageCandidateUrl ||
            item.imageUrl?.trim(),
          );
          if (hasManualOrLocalImage) return item;

          return {
            ...item,
            pastedImageUrl: assignedItems[index]?.pastedImageUrl,
          };
        }),
      };
    });
  }

  async function rerunProductMasterMatching() {
    if (productMasterMatchBusy || application.items.length === 0) return;
    setProductMasterMatchBusy(true);
    setProductMasterMatchStatus({
      kind: "warning",
      message: "발주초안 우선으로 커머스OS 내부상품과 다시 매칭하는 중입니다.",
    });
    try {
      const matchResponse = await requestFreightProductMasterMatches(application);
      setApplication(
        applyLiveProductMasterMatches(application, matchResponse),
      );
      const message = productMasterMatchMessage(
        "내부상품 재매칭 완료 ·",
        matchResponse,
      );
      setProductMasterMatchStatus({
        kind:
          matchResponse.summary.unmatched > 0 ||
          matchResponse.summary.ambiguous > 0
            ? "warning"
            : "success",
        message,
      });
    } catch (error) {
      setProductMasterMatchStatus({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "내부상품 자동매칭에 실패했습니다.",
      });
    } finally {
      setProductMasterMatchBusy(false);
    }
  }

  function applyBulkBundleUnit() {
    const bundleUnit = Number(bulkBundleUnit);
    if (!Number.isInteger(bundleUnit) || bundleUnit <= 0) {
      setBulkBundleNote("소분단위는 1 이상의 숫자로 입력해주세요.");
      return;
    }

    let manualPrintCountPreserved = 0;
    let changedCount = 0;
    const rememberedBarcodes = new Set<string>();
    const items = application.items.map((item) => {
      if (!isFreightBundleUnitEmpty(item.bundleUnit)) return item;

      changedCount += 1;
      if (item.labelPrintCount) manualPrintCountPreserved += 1;
      const saved = saveFreightBundleUnitPreference(item.barcode, bundleUnit);
      if (saved) rememberedBarcodes.add(saved.barcode);
      return {
        ...item,
        bundleUnit,
        ...(saved ? { bundleUnitUpdatedAt: saved.updatedAt } : {}),
      };
    });
    setApplication((current) => ({ ...current, items }));
    setBulkBundleNote(
      changedCount > 0
        ? `소분단위가 비어 있던 ${changedCount}개 품목에 적용했습니다.${
            manualPrintCountPreserved > 0
              ? " 수동 출력수량은 유지됩니다."
              : ""
          }${
            rememberedBarcodes.size > 0
              ? ` B코드 ${rememberedBarcodes.size}개의 최신값으로 저장했습니다.`
              : ""
          }`
        : "소분단위가 비어 있는 품목이 없습니다. 기존 값은 변경하지 않았습니다.",
    );
  }

  function updateLocalImage(itemId: string, file?: File) {
    const previousUrl = localImageObjectUrlsRef.current.get(itemId);
    if (previousUrl) {
      URL.revokeObjectURL(previousUrl);
      localImageObjectUrlsRef.current.delete(itemId);
    }

    const localImageUrl = file ? URL.createObjectURL(file) : undefined;
    if (localImageUrl)
      localImageObjectUrlsRef.current.set(itemId, localImageUrl);
    updateItem(itemId, { localImageUrl });
  }

  function updateCandidateLoadStatus(
    url: string,
    loadStatus: "loaded" | "failed",
  ) {
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

  async function applyProductMaster(item: FreightApplicationItem) {
    if (productMasterMatchBusy) return;
    setProductMasterMatchBusy(true);
    try {
      const response = await requestFreightProductMasterMatches({
        ...application,
        items: [item],
      });
      const match = response.matches[0];
      if (!match || match.status !== "MATCHED") {
        setLookupFailedIds((current) => new Set(current).add(item.id));
        setProductMasterMatchStatus({
          kind: "warning",
          message:
            match?.status === "AMBIGUOUS"
              ? "후보가 여러 개라 자동 적용하지 않았습니다. B코드 또는 정확한 모델번호로 다시 검색해주세요."
              : "일치하는 실제 상품마스터 항목을 찾지 못했습니다.",
        });
        return;
      }

      setApplication((current) =>
        applyLiveProductMasterMatches(current, response),
      );
      setLookupFailedIds((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
      setProductMasterMatchStatus({
        kind: "success",
        message: `${match.modelNo} · ${match.modelName} · ${match.barcode}를 실제 상품마스터에서 적용했습니다.`,
      });
    } catch (error) {
      setLookupFailedIds((current) => new Set(current).add(item.id));
      setProductMasterMatchStatus({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "상품마스터 적용에 실패했습니다.",
      });
    } finally {
      setProductMasterMatchBusy(false);
    }
  }

  function refreshHistoryRecords() {
    setHistoryRecords(listFreightBarcodeHistory());
  }

  async function refreshServerHistoryRecords() {
    try {
      const response = await fetch("/api/freight-barcode-requests", {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("History list request failed");
      const data = (await response.json()) as {
        records: FreightBarcodeHistoryRecord[];
      };
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
    let restoredApplicationNos: string[] = [];
    try {
      restoredApplicationNos = parseFreightApplicationNumberList(record.applicationNo);
    } catch {
      restoredApplicationNos = [];
    }
    setApplication({
      applicationNo: record.applicationNo,
      applicationNos: restoredApplicationNos,
      items: record.parsedItems.map((item) => ({
        ...item,
        applicationNo:
          item.applicationNo ||
          (restoredApplicationNos.length === 1 ? restoredApplicationNos[0] : undefined),
      })),
    });
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
        existingRecord
          ? "현재 작업 이력을 업데이트했습니다."
          : "새 작업 이력을 저장했습니다.",
      );
    } catch {
      setHistoryStatus(
        "이력을 저장하지 못했습니다. 브라우저 저장 공간을 확인해주세요.",
      );
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
    setHistoryStatus(
      "로컬에 저장된 작업을 불러왔습니다. 미리보기에서 내용을 확인한 뒤 PDF로 저장하거나 인쇄할 수 있습니다.",
    );
  }

  function removeHistory(id: string) {
    if (!window.confirm("이 작업요청 이력을 삭제하시겠습니까?")) return;

    deleteFreightBarcodeHistory(id);
    if (loadedHistoryId === id) {
      setLoadedHistoryId(undefined);
      setHistoryStatus(
        "현재 열려 있던 이력을 삭제했습니다. 편집 중인 내용은 유지됩니다.",
      );
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
          source:
            loadedHistoryId || loadedServerHistoryId
              ? "restored-history"
              : "manual-paste",
        }),
      });
      if (!response.ok) throw new Error("History save request failed");
      const data = (await response.json()) as {
        record: FreightBarcodeHistoryRecord;
      };
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
      const response = await fetch(
        `/api/freight-barcode-requests/${encodeURIComponent(id)}`,
        {
          cache: "no-store",
        },
      );
      if (!response.ok) throw new Error("History load request failed");
      const data = (await response.json()) as {
        record: FreightBarcodeHistoryRecord;
      };
      restoreHistoryRecord(data.record);
      setLoadedServerHistoryId(data.record.id);
      setLoadedHistoryId(undefined);
      setHistoryStatus(
        "서버에 저장된 작업을 불러왔습니다. PDF를 다시 저장하거나 인쇄할 수 있습니다.",
      );
    } catch {
      setHistoryStatus(
        "서버 이력을 불러오지 못했습니다. 현재 편집 내용과 로컬 이력은 변경되지 않았습니다.",
      );
    }
  }

  async function removeServerHistory(id: string) {
    if (!window.confirm("이 서버 작업요청 이력을 삭제하시겠습니까?")) return;

    try {
      const response = await fetch(
        `/api/freight-barcode-requests/${encodeURIComponent(id)}`,
        {
          method: "DELETE",
        },
      );
      if (!response.ok) throw new Error("History delete request failed");
      if (loadedServerHistoryId === id) setLoadedServerHistoryId(undefined);
      await refreshServerHistoryRecords();
      setHistoryStatus("서버 작업요청 이력을 삭제했습니다.");
    } catch {
      setHistoryStatus(
        "서버 이력을 삭제하지 못했습니다. 로컬 이력은 변경되지 않았습니다.",
      );
    }
  }

  function downloadFreightForwarderMvpZip() {
    const result = buildFreightForwarderMvpZip(application);
    downloadZipFile(result.zipBytes, result.zipFilename);
    setFreightForwarderZipStatus(result.statusMessage);
  }

  async function downloadWorkRequestZip() {
    if (workRequestZipBusy) return;
    setWorkRequestZipBusy(true);
    setWorkRequestZipStatus("신청서별 작업요청서 PDF를 생성하는 중입니다…");
    try {
      const result = await buildFreightWorkRequestZip(application, createdDate);
      downloadZipFile(result.zipBytes, result.zipFilename);
      setWorkRequestZipStatus(result.statusMessage);
    } catch {
      setWorkRequestZipStatus(
        "작업요청서 PDF ZIP을 생성하지 못했습니다. 잠시 후 다시 시도해주세요.",
      );
    } finally {
      setWorkRequestZipBusy(false);
    }
  }

  function syncEditTableHorizontalScroll(
    source: HTMLDivElement,
    target: HTMLDivElement | null,
  ) {
    if (!target || target.scrollLeft === source.scrollLeft) return;
    target.scrollLeft = source.scrollLeft;
  }

  async function copyKoreanMessage() {
    await navigator.clipboard.writeText(KOREAN_MESSAGE);
    setCopyLabel("복사 완료");
    window.setTimeout(() => setCopyLabel("한국어 메시지 복사"), 1500);
  }

  return (
    <div>
      <div className="freight-editing-ui">
        <PageHeader
          title="배대지 바코드 PDF 생성기"
          description="온돌패스 신청서 번호로 제품정보를 자동으로 가져오거나, 세부 페이지 내용을 직접 붙여넣어 바코드 작업요청서를 만듭니다."
        />

        <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-semibold text-slate-950">
                배송대행지 신청서 텍스트
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                제품정보 블록을 그대로 붙여넣으면 신청번호와 품목별 필드를
                분석합니다.
              </p>
            </div>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
              번호 자동 가져오기 + 수동 붙여넣기
            </span>
          </div>
          <div className="mb-5 rounded-lg border border-emerald-200 bg-emerald-50/70 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-slate-950">
                  신청서 번호로 자동 가져오기
                </h3>
                <p className="mt-1 text-xs leading-5 text-slate-600">
                  신청번호를 쉼표로 구분하면 로그인된 Chrome에서 여러 신청서를
                  순서대로 읽고, 하나의 작업으로 합쳐 자동 분석합니다.
                </p>
              </div>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                  ondolpassBridgeReady
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-amber-100 text-amber-800"
                }`}
              >
                {ondolpassBridgeReady ? "브리지 연결됨" : "확장 연결 필요"}
              </span>
            </div>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <label className="sr-only" htmlFor="ondolpass-application-no">
                온돌패스 신청서 번호
              </label>
              <input
                id="ondolpass-application-no"
                inputMode="text"
                autoComplete="off"
                value={ondolpassApplicationNo}
                onChange={(event) => {
                  setOndolpassApplicationNo(
                    event.target.value.replace(/[^\d,，\s]/g, "").slice(0, 500),
                  );
                  setOndolpassBridgeStatus(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") importOndolpassApplication();
                }}
                placeholder="예: 673626, 673627, 673628"
                className="min-w-0 flex-1 rounded-lg border border-emerald-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
              />
              <Button
                onClick={importOndolpassApplication}
                primary
                disabled={ondolpassBridgeStatus?.kind === "loading"}
              >
                {ondolpassBridgeStatus?.kind === "loading"
                  ? "가져오는 중…"
                  : "가져와서 자동 분석"}
              </Button>
            </div>
            <div className="mt-3 rounded-lg border border-emerald-200 bg-white/70 p-3">
              <p className="text-xs font-semibold text-slate-800">
                신청일 기간으로 자동 가져오기
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                온돌패스 LCL 신청현황의 실제 신청일 검색 결과를 읽고, 조회된
                신청서를 번호 순서대로 자동 분석합니다.
              </p>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
                <label className="flex-1">
                  <span className="mb-1 block text-xs font-semibold text-slate-600">
                    신청일 시작
                  </span>
                  <input
                    type="date"
                    value={ondolpassStartDate}
                    onChange={(event) => {
                      setOndolpassStartDate(event.target.value);
                      setOndolpassBridgeStatus(null);
                    }}
                    className="w-full rounded-lg border border-emerald-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                  />
                </label>
                <label className="flex-1">
                  <span className="mb-1 block text-xs font-semibold text-slate-600">
                    신청일 종료
                  </span>
                  <input
                    type="date"
                    value={ondolpassEndDate}
                    onChange={(event) => {
                      setOndolpassEndDate(event.target.value);
                      setOndolpassBridgeStatus(null);
                    }}
                    className="w-full rounded-lg border border-emerald-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                  />
                </label>
                <Button
                  onClick={importOndolpassDateRange}
                  primary
                  disabled={ondolpassBridgeStatus?.kind === "loading"}
                >
                  {ondolpassBridgeStatus?.kind === "loading"
                    ? "가져오는 중…"
                    : "기간 신청서 가져와서 자동 분석"}
                </Button>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-5">
              <a
                href="/api/ondolpass-freight-bridge/download"
                download
                className="font-semibold text-blue-700 underline underline-offset-2 hover:text-blue-900"
              >
                온돌패스 브리지 확장 다운로드
              </a>
              <span className="text-slate-500">
                조회 전용이며 온돌패스 체크박스·버튼·신청서 내용은 변경하지
                않습니다. 신청서는 한 건씩 안전하게 순차 조회합니다.
              </span>
            </div>
            {ondolpassBridgeStatus && (
              <p
                role="status"
                className={`mt-3 rounded-lg border px-3 py-2 text-xs font-medium leading-5 ${
                  ondolpassBridgeStatus.kind === "success"
                    ? "border-emerald-300 bg-white text-emerald-900"
                    : ondolpassBridgeStatus.kind === "error"
                      ? "border-red-300 bg-red-50 text-red-900"
                      : ondolpassBridgeStatus.kind === "warning"
                        ? "border-amber-300 bg-amber-50 text-amber-900"
                      : "border-blue-300 bg-blue-50 text-blue-900"
                }`}
              >
                {ondolpassBridgeStatus.message}
              </p>
            )}
          </div>
          <details className="mb-5 rounded-lg border border-blue-200 bg-blue-50/60">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
              <span className="font-semibold text-slate-950">
                이미지 포함 붙여넣기
              </span>
              <span className="text-xs font-semibold text-blue-700">
                필요할 때 펼치기
              </span>
            </summary>
            <div className="border-t border-blue-200 p-4">
              <p className="text-xs leading-5 text-slate-600">
                1688 장바구니나 배송대행지 신청서처럼 이미지가 포함된 영역을
                복사한 뒤 여기에 붙여넣으면 이미지 URL을 함께 추출합니다. 여러
                신청서 내용을 이어 붙이면 신청번호별로 구분해 함께 분석합니다.
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
              {(pastedImages.candidates.length > 0 ||
                pastedImages.excludedCandidates.length > 0) && (
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {pastedImages.candidates.map((candidate, index) => (
                    <ImageCandidateDiagnostic
                      key={`${candidate.url}-${index}`}
                      candidate={candidate}
                      label={`상품 이미지 후보 ${index + 1}`}
                      onLoadStatusChange={(status) =>
                        updateCandidateLoadStatus(candidate.url, status)
                      }
                    />
                  ))}
                  {pastedImages.excludedCandidates.map((candidate, index) => (
                    <ImageCandidateDiagnostic
                      key={`${candidate.url ?? candidate.reason}-${index}`}
                      candidate={{
                        ...candidate,
                        url: candidate.url ?? "",
                        score: 0,
                        loadStatus: "failed",
                      }}
                      label={`제외 이미지 ${index + 1}`}
                      excluded
                    />
                  ))}
                </div>
              )}
              <p className="mt-2 text-xs leading-5 text-slate-500">
                온돌패스에서 복사된 일부 1688 이미지는 외부 페이지에서 직접
                열리지 않을 수 있습니다. 이미지가 필요한 품목만 상품마스터
                이미지 또는 직접 이미지 URL로 보완해주세요.
              </p>
            </div>
          </details>

          <label
            className="mb-2 block text-sm font-semibold text-slate-800"
            htmlFor="freight-plain-text"
          >
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
              세부 페이지에서는 제품정보 영역의 *품목, 옵션, 상품상세url,
              hs_code, 단가, 수량이 함께 포함되도록 복사하면 분석률이 높습니다.
            </p>
            <p>
              일반 텍스트 입력도 그대로 사용할 수 있습니다. 상품 이미지 후보는
              제품정보 블록별로 우선 연결됩니다.
            </p>
            <p>
              분석 결과가 비어 있으면 아래 진단 정보를 보고 복사 범위를 넓혀
              다시 시도하세요.
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
                <div>
                  <dt className="inline font-medium">파서 모드: </dt>
                  <dd className="inline">
                    {application.diagnostics.parserMode}
                  </dd>
                </div>
                <div>
                  <dt className="inline font-medium">감지된 줄 수: </dt>
                  <dd className="inline">
                    {application.diagnostics.detectedCounts.lines}
                  </dd>
                </div>
                <div>
                  <dt className="inline font-medium">감지된 품목 라벨 수: </dt>
                  <dd className="inline">
                    {application.diagnostics.detectedCounts.itemLabels}
                  </dd>
                </div>
                <div>
                  <dt className="inline font-medium">감지된 URL 수: </dt>
                  <dd className="inline">
                    {application.diagnostics.detectedCounts.urls}
                  </dd>
                </div>
                <div>
                  <dt className="inline font-medium">감지된 수량 라벨 수: </dt>
                  <dd className="inline">
                    {application.diagnostics.detectedCounts.quantityLabels}
                  </dd>
                </div>
                <div>
                  <dt className="inline font-medium">감지된 오더번호 수: </dt>
                  <dd className="inline">
                    {application.diagnostics.detectedCounts.orderNumbers}
                  </dd>
                </div>
              </dl>
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={analyzeText} primary disabled={productMasterMatchBusy}>
              {productMasterMatchBusy ? "내부상품 매칭 중…" : "신청서 분석하기"}
            </Button>
            <Button onClick={loadSample}>샘플 불러오기</Button>
            <Button onClick={reset}>초기화</Button>
          </div>
        </section>

        <section
          className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
          aria-label="분석 결과 요약"
        >
          <SummaryCard
            label="신청번호"
            value={application.applicationNo || "-"}
          />
          <SummaryCard
            label="품목 수"
            value={`${application.items.length}개`}
          />
          <SummaryCard
            label="매칭 완료"
            value={`${matchedCount}개`}
            emphasized
          />
          <SummaryCard
            label="확인 필요"
            value={`${application.items.length - matchedCount}개`}
            warning
          />
        </section>

        <section
          className="mb-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
          aria-labelledby="freight-history-title"
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2
                id="freight-history-title"
                className="font-semibold text-slate-950"
              >
                작업요청 이력
              </h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                기존 브라우저 로컬 이력은 그대로 유지됩니다. 필요하면 현재
                작업을 임시 서버 이력에도 저장해 다시 열 수 있습니다.
              </p>
            </div>
            {(loadedHistoryId || loadedServerHistoryId) && (
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
                {loadedServerHistoryId
                  ? "서버 이력 편집 중"
                  : "로컬 이력 편집 중"}
              </span>
            )}
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label>
              <span className="mb-1 block text-xs font-semibold text-slate-600">
                제목 (선택)
              </span>
              <input
                value={historyTitle}
                onChange={(event) => setHistoryTitle(event.target.value)}
                placeholder="예: 6월 2차 바코드 작업"
                className={inputClassName}
              />
            </label>
            <label>
              <span className="mb-1 block text-xs font-semibold text-slate-600">
                이력 메모 (선택)
              </span>
              <input
                value={historyMemo}
                onChange={(event) => setHistoryMemo(event.target.value)}
                placeholder="이력 목록에서 확인할 메모"
                className={inputClassName}
              />
            </label>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => saveCurrentHistory(false)} primary>
              현재 로컬 작업 저장
            </Button>
            <Button onClick={() => saveCurrentHistory(true)}>
              새 로컬 이력으로 저장
            </Button>
            <Button onClick={saveCurrentServerHistory}>서버 이력에 저장</Button>
            <Button onClick={refreshServerHistoryRecords}>
              서버 목록 새로고침
            </Button>
          </div>
          {historyStatus && (
            <p
              role="status"
              className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-xs font-medium text-slate-700"
            >
              {historyStatus}
            </p>
          )}
          <p className="mt-3 text-xs leading-5 text-amber-700">
            로컬 이미지 파일은 브라우저 임시 이미지이므로, 이력을 다시 열었을 때
            이미지가 표시되지 않으면 다시 선택해주세요.
          </p>

          <div className="mt-5">
            <h3 className="text-sm font-semibold text-slate-900">
              임시 서버 이력
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              서버가 재시작되면 사라지는 임시 저장소이며, 영구 데이터베이스는
              아직 연결되지 않았습니다.
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
                      <th className="px-3 py-3 font-semibold">
                        <span className="sr-only">작업</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {serverHistoryRecords.map((record) => (
                      <tr
                        key={record.id}
                        className={`border-b border-slate-200 ${record.id === loadedServerHistoryId ? "bg-emerald-50/60" : ""}`}
                      >
                        <td className="px-3 py-3 font-semibold text-slate-900">
                          {record.applicationNo || "-"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-xs text-slate-600">
                          {formatHistoryDate(record.updatedAt)}
                        </td>
                        <td className="px-3 py-3 text-slate-700">
                          {record.itemCount}개 / {record.matchedItemCount}개
                        </td>
                        <td className="max-w-sm px-3 py-3 text-slate-700">
                          <p className="font-medium text-slate-900">
                            {record.title || "제목 없음"}
                          </p>
                          {record.memo && (
                            <p className="mt-1 line-clamp-2 text-xs text-slate-500">
                              {record.memo}
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => reopenServerHistory(record.id)}
                              className="rounded-md bg-slate-800 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-950"
                            >
                              다시 열기
                            </button>
                            <button
                              type="button"
                              onClick={() => removeServerHistory(record.id)}
                              className="rounded-md border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50"
                            >
                              삭제
                            </button>
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
            <h3 className="mb-3 text-sm font-semibold text-slate-900">
              이 브라우저의 로컬 이력
            </h3>
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
                    <th className="px-3 py-3 font-semibold">
                      <span className="sr-only">작업</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {historyRecords.map((record) => (
                    <tr
                      key={record.id}
                      className={`border-b border-slate-200 ${record.id === loadedHistoryId ? "bg-emerald-50/60" : ""}`}
                    >
                      <td className="px-3 py-3 font-semibold text-slate-900">
                        {record.applicationNo || "-"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-xs text-slate-600">
                        {formatHistoryDate(record.updatedAt)}
                      </td>
                      <td className="px-3 py-3 text-slate-700">
                        {record.items.length}개
                      </td>
                      <td className="max-w-sm px-3 py-3 text-slate-700">
                        <p className="font-medium text-slate-900">
                          {record.title || "제목 없음"}
                        </p>
                        {record.memo && (
                          <p className="mt-1 line-clamp-2 text-xs text-slate-500">
                            {record.memo}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => reopenHistory(record.id)}
                            className="rounded-md bg-slate-800 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-950"
                          >
                            다시 열기
                          </button>
                          <button
                            type="button"
                            onClick={() => removeHistory(record.id)}
                            className="rounded-md border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50"
                          >
                            삭제
                          </button>
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
              <h2 className="font-semibold text-slate-950">
                분석 품목 편집 및 내부상품 매칭
              </h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                발주차시에서 들어온 경우 발주초안의 오픈마켓 주문번호를 먼저
                대조하고, 없을 때 1688 URL·중국 옵션으로 상품마스터를 확인해
                B코드·모델번호·모델명을 자동 적용합니다. 후보가 중복되면 자동
                입력하지 않습니다.
              </p>
            </div>
            <label className="w-full sm:w-64">
              <span className="mb-1 block text-xs font-semibold text-slate-600">
                신청번호 수정
              </span>
              <input
                value={application.applicationNo}
                onChange={(event) => updateApplicationNo(event.target.value)}
                className={inputClassName}
              />
            </label>
          </div>
          <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  소분단위 일괄 입력
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  소분단위가 비어 있는 품목에만 적용하며 기존 입력값은 변경하지
                  않습니다. 입력한 값은 B코드별 최신 소분단위로 자동 저장되어
                  다음 수동·자동 가져오기에 다시 적용됩니다.
                </p>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <label className="w-36">
                  <span className="mb-1 block text-xs font-semibold text-slate-600">
                    소분단위
                  </span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={bulkBundleUnit}
                    onChange={(event) => setBulkBundleUnit(event.target.value)}
                    className={inputClassName}
                  />
                </label>
                <Button onClick={applyBulkBundleUnit} primary>
                  소분단위 비어있는 품목에만 적용
                </Button>
                <Button onClick={rerunAutoImageMatching}>
                  이미지 자동 매칭 다시 실행
                </Button>
                <Button
                  onClick={rerunProductMasterMatching}
                  disabled={productMasterMatchBusy || application.items.length === 0}
                >
                  {productMasterMatchBusy
                    ? "내부상품 매칭 중…"
                    : "내부상품 자동매칭 다시 실행"}
                </Button>
              </div>
            </div>
            {bulkBundleNote && (
              <p className="mt-2 text-xs font-semibold text-slate-600">
                {bulkBundleNote}
              </p>
            )}
            {bundleUnitLedgerStatus && (
              <p className="mt-2 text-xs font-semibold text-emerald-700" role="status">
                {bundleUnitLedgerStatus}
              </p>
            )}
            {productMasterMatchStatus && (
              <p
                role="status"
                className={`mt-2 rounded-lg border px-3 py-2 text-xs font-semibold ${
                  productMasterMatchStatus.kind === "success"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : productMasterMatchStatus.kind === "error"
                      ? "border-red-200 bg-red-50 text-red-800"
                      : "border-amber-200 bg-amber-50 text-amber-800"
                }`}
              >
                {productMasterMatchStatus.message}
              </p>
            )}
          </div>
          <PinnedColumnSelector
            pinnedColumnIds={pinnedColumnIds}
            onChange={setPinnedColumnIds}
          />
          <div
            ref={editTableTopScrollRef}
            aria-label="분석 품목 편집 테이블 상단 가로 스크롤"
            className="max-w-full overflow-x-auto"
            onScroll={(event) => {
              syncEditTableHorizontalScroll(
                event.currentTarget,
                editTableScrollRef.current,
              );
            }}
          >
            <div
              aria-hidden="true"
              className="h-4"
              style={{ minWidth: EDIT_TABLE_TOTAL_WIDTH }}
            />
          </div>
          <div
            ref={editTableScrollRef}
            className="max-w-full overflow-x-auto"
            onScroll={(event) => {
              syncEditTableHorizontalScroll(
                event.currentTarget,
                editTableTopScrollRef.current,
              );
            }}
          >
            <table
              className="w-full border-collapse text-left text-xs [table-layout:fixed]"
              style={{ minWidth: EDIT_TABLE_TOTAL_WIDTH }}
            >
              <colgroup>
                {EDIT_TABLE_COLUMNS.map((column) => (
                  <col key={column.id} style={{ width: column.width }} />
                ))}
              </colgroup>
              <thead className="bg-slate-100 text-slate-600">
                <tr>
                  {EDIT_TABLE_COLUMNS.map((column) => (
                    <th
                      key={column.id}
                      className={getEditTableHeaderClassName(
                        column.id,
                        pinnedColumnIds,
                      )}
                      style={getEditTableHeaderStyle(
                        column.id,
                        pinnedColumnIds,
                      )}
                    >
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {application.items.map((item, rowIndex) => (
                  <EditableRow
                    key={item.id}
                    item={item}
                    rowIndex={rowIndex}
                    pinnedColumnIds={pinnedColumnIds}
                    imageCandidates={pastedImages.candidates}
                    lookupFailed={lookupFailedIds.has(item.id)}
                    onChange={(changes) => updateItem(item.id, changes)}
                    onRememberBundleUnit={() => rememberItemBundleUnit(item.id)}
                    onLocalImageChange={(file) =>
                      updateLocalImage(item.id, file)
                    }
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

        <details className="mb-5 rounded-xl border border-amber-200 bg-amber-50 text-sm text-amber-950">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
            <span className="font-semibold">바코드 스캐너 확인</span>
            <span className="text-xs font-semibold text-amber-800">
              필요할 때 펼치기
            </span>
          </summary>
          <div className="border-t border-amber-200 px-4 py-3">
            <p className="text-xs leading-5">
              스캐너 테스트 시 입력한 바코드값과 스캔 결과가 정확히 일치해야
              합니다.
            </p>
            <div className="mt-2 space-y-1 text-xs">
              {application.items.map((item) => {
                const encodedValue = getEncodedBarcodeValue(item.barcode);
                return (
                  <p key={item.id}>
                    {item.applicationNo ? `${item.applicationNo} / ` : ""}
                    {item.rowNo}번 · 입력값: {item.barcode || "-"} · 인코딩값:{" "}
                    {encodedValue || "생성 안 함"}
                  </p>
                );
              })}
            </div>
          </div>
        </details>

        <section className="mb-5 rounded-xl border border-blue-200 bg-blue-50 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-semibold text-blue-950">작업요청서 전달</h2>
              <p className="mt-1 text-xs text-blue-700">
                신청번호별 A4 작업요청서 PDF를 각각 생성해 ZIP 안의 신청번호
                폴더에 저장합니다. 압축을 풀어 PDF를 바로 인쇄할 수 있습니다.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={downloadWorkRequestZip}
                primary
                disabled={workRequestZipBusy || application.items.length === 0}
              >
                {workRequestZipBusy
                  ? "작업요청서 ZIP 생성 중…"
                  : "작업요청서 PDF ZIP 다운로드"}
              </Button>
            </div>
          </div>
          {workRequestZipStatus && (
            <p
              role="status"
              className="mt-3 rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-semibold leading-5 text-blue-900"
            >
              {workRequestZipStatus}
            </p>
          )}
          <div className="mt-4 rounded-lg border border-blue-200 bg-white p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-xs font-semibold text-slate-600">
                배송대행지 전달용 한국어 메시지
              </span>
              <button
                type="button"
                onClick={copyKoreanMessage}
                className="text-xs font-semibold text-blue-700 hover:text-blue-900"
              >
                {copyLabel}
              </button>
            </div>
            <pre className="whitespace-pre-wrap font-sans text-sm leading-6 text-slate-700">
              {KOREAN_MESSAGE}
            </pre>
          </div>
        </section>
        <BarcodeLabelOutput
          application={application}
          freightForwarderZipStatus={freightForwarderZipStatus}
          onDownloadFreightForwarderZip={downloadFreightForwarderMvpZip}
        />
      </div>
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

function PinnedColumnSelector({
  pinnedColumnIds,
  onChange,
}: {
  pinnedColumnIds: EditTableColumnId[];
  onChange: (columnIds: EditTableColumnId[]) => void;
}) {
  const orderedPinnedColumns = getOrderedPinnedColumns(pinnedColumnIds);
  const selectedCount = pinnedColumnIds.length;

  return (
    <div className="border-b border-slate-200 bg-white px-5 py-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            가로 스크롤 고정 열
          </h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            선택한 열은 가로로 이동해도 왼쪽에 계속 표시됩니다. 최대{" "}
            {MAX_PINNED_EDIT_TABLE_COLUMNS}개까지 고정할 수 있습니다. 좁은
            화면에서 고정 열이 많으면 입력 공간이 줄어들 수 있습니다.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {orderedPinnedColumns.length > 0 ? (
              orderedPinnedColumns.map((column) => (
                <span
                  key={column.id}
                  className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700"
                >
                  {column.label}
                </span>
              ))
            ) : (
              <span className="text-xs font-semibold text-slate-400">
                고정된 열 없음
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => onChange(["image", "itemName"])}>
            이미지·품목 보기
          </Button>
          <Button
            onClick={() =>
              onChange(["image", "itemName", "barcode", "labelPrintCount"])
            }
          >
            바코드 작업
          </Button>
          <Button onClick={() => onChange([])}>고정 해제</Button>
        </div>
      </div>
      <details className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <summary className="cursor-pointer text-xs font-semibold text-slate-700">
          고정 열 직접 선택 ({selectedCount}/{MAX_PINNED_EDIT_TABLE_COLUMNS})
        </summary>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
          {EDIT_TABLE_COLUMNS.map((column) => {
            const checked = pinnedColumnIds.includes(column.id);
            const disabled =
              !checked && selectedCount >= MAX_PINNED_EDIT_TABLE_COLUMNS;
            return (
              <label
                key={column.id}
                className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-semibold ${disabled ? "border-slate-200 bg-slate-100 text-slate-400" : "border-slate-200 bg-white text-slate-700"}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={() =>
                    onChange(togglePinnedColumnId(pinnedColumnIds, column.id))
                  }
                  className="size-4 rounded border-slate-300"
                />
                <span>{column.label}</span>
              </label>
            );
          })}
        </div>
      </details>
    </div>
  );
}

function getEditTableHeaderClassName(
  columnId: EditTableColumnId,
  pinnedColumnIds: EditTableColumnId[],
): string {
  return `${cellClassName} bg-slate-100 px-3 py-3 font-semibold ${getPinnedColumnOffset(columnId, pinnedColumnIds) === undefined ? "" : "sticky z-30"} ${isLastPinnedColumn(columnId, pinnedColumnIds) ? "shadow-[4px_0_8px_-6px_rgba(15,23,42,0.45)]" : ""}`;
}

function getEditTableHeaderStyle(
  columnId: EditTableColumnId,
  pinnedColumnIds: EditTableColumnId[],
): CSSProperties | undefined {
  const offset = getPinnedColumnOffset(columnId, pinnedColumnIds);
  if (offset === undefined) return undefined;
  return { left: offset };
}

function getEditTableCellClassName(
  columnId: EditTableColumnId,
  pinnedColumnIds: EditTableColumnId[],
): string {
  return `${cellClassName} ${getPinnedColumnOffset(columnId, pinnedColumnIds) === undefined ? "" : "sticky z-20"} ${isLastPinnedColumn(columnId, pinnedColumnIds) ? "shadow-[4px_0_8px_-6px_rgba(15,23,42,0.45)]" : ""}`;
}

function getEditTableCellStyle(
  columnId: EditTableColumnId,
  pinnedColumnIds: EditTableColumnId[],
  rowIndex: number,
): CSSProperties | undefined {
  const offset = getPinnedColumnOffset(columnId, pinnedColumnIds);
  if (offset === undefined) return undefined;
  return {
    left: offset,
    backgroundColor: rowIndex % 2 === 0 ? "#ffffff" : "rgb(248 250 252)",
  };
}

function EditableRow({
  item,
  rowIndex,
  pinnedColumnIds,
  imageCandidates,
  lookupFailed,
  onChange,
  onRememberBundleUnit,
  onLocalImageChange,
  onApply,
}: {
  item: FreightApplicationItem;
  rowIndex: number;
  pinnedColumnIds: EditTableColumnId[];
  imageCandidates: RichPasteImageCandidate[];
  lookupFailed: boolean;
  onChange: (changes: Partial<FreightApplicationItem>) => void;
  onRememberBundleUnit: () => void;
  onLocalImageChange: (file?: File) => void;
  onApply: () => void;
}) {
  const status = item.matchedModelNo
    ? "상품마스터 매칭 완료"
    : "상품마스터 미매칭";
  const statusStyle = item.matchedModelNo
    ? "bg-emerald-50 text-emerald-700"
    : lookupFailed
      ? "bg-red-50 text-red-700"
      : "bg-amber-50 text-amber-700";
  const barcodeValue = item.barcode ?? "";
  const barcodeInvalid =
    Boolean(barcodeValue) && !isValidBarcodeValue(barcodeValue);
  const labelCalculation = calculateBarcodeLabelPrint({
    quantity: item.quantity,
    memo: item.memo,
    bundleUnit: item.bundleUnit,
    printCount: item.labelPrintCount,
  });
  const detectedBundleUnit = calculateBarcodeLabelPrint({
    quantity: item.quantity,
    memo: item.memo,
  }).bundleUnit;
  const imageSources = getFreightItemImageSources(item);

  return (
    <tr className="align-top odd:bg-white even:bg-slate-50/50">
      <td
        className={getEditTableCellClassName("rowNo", pinnedColumnIds)}
        style={getEditTableCellStyle("rowNo", pinnedColumnIds, rowIndex)}
      >
        <input
          type="number"
          value={item.rowNo}
          onChange={(event) => onChange({ rowNo: Number(event.target.value) })}
          className={`${inputClassName} w-16`}
        />
      </td>
      <td
        className={getEditTableCellClassName("applicationNo", pinnedColumnIds)}
        style={getEditTableCellStyle("applicationNo", pinnedColumnIds, rowIndex)}
      >
        <input
          value={item.applicationNo ?? ""}
          onChange={(event) => onChange({ applicationNo: event.target.value })}
          className={`${inputClassName} w-28`}
          aria-label={`${item.rowNo}행 신청번호`}
        />
      </td>
      <td
        className={getEditTableCellClassName("image", pinnedColumnIds)}
        style={getEditTableCellStyle("image", pinnedColumnIds, rowIndex)}
      >
        <div className="flex size-16 items-center justify-center overflow-hidden rounded border border-slate-200 bg-white text-center text-[10px] text-slate-500">
          <FreightItemImage
            key={imageSources.join("|")}
            sources={imageSources}
            alt={`${item.itemName} 이미지`}
            className="size-16 object-contain"
          />
        </div>
      </td>
      <td
        className={getEditTableCellClassName("itemName", pinnedColumnIds)}
        style={getEditTableCellStyle("itemName", pinnedColumnIds, rowIndex)}
      >
        <input
          value={item.itemName}
          onChange={(event) => onChange({ itemName: event.target.value })}
          className={`${inputClassName} w-44`}
        />
      </td>
      <td
        className={getEditTableCellClassName("optionText", pinnedColumnIds)}
        style={getEditTableCellStyle("optionText", pinnedColumnIds, rowIndex)}
      >
        <textarea
          value={item.optionText}
          onChange={(event) => onChange({ optionText: event.target.value })}
          className={`${inputClassName} min-h-16 w-56 resize-y`}
        />
      </td>
      <td
        className={getEditTableCellClassName("quantity", pinnedColumnIds)}
        style={getEditTableCellStyle("quantity", pinnedColumnIds, rowIndex)}
      >
        <input
          type="number"
          min="0"
          value={item.quantity}
          onChange={(event) =>
            onChange({ quantity: Number(event.target.value) })
          }
          className={`${inputClassName} w-24`}
        />
      </td>
      <td
        className={getEditTableCellClassName("unitPrice", pinnedColumnIds)}
        style={getEditTableCellStyle("unitPrice", pinnedColumnIds, rowIndex)}
      >
        <input
          type="number"
          step="0.01"
          value={item.unitPrice ?? ""}
          onChange={(event) =>
            onChange({
              unitPrice:
                event.target.value === ""
                  ? undefined
                  : Number(event.target.value),
            })
          }
          className={`${inputClassName} w-24`}
        />
      </td>
      <td
        className={getEditTableCellClassName("hsCode", pinnedColumnIds)}
        style={getEditTableCellStyle("hsCode", pinnedColumnIds, rowIndex)}
      >
        <input
          value={item.hsCode ?? ""}
          onChange={(event) => onChange({ hsCode: event.target.value })}
          className={`${inputClassName} w-32`}
        />
      </td>
      <td
        className={getEditTableCellClassName("detailUrl", pinnedColumnIds)}
        style={getEditTableCellStyle("detailUrl", pinnedColumnIds, rowIndex)}
      >
        <textarea
          value={item.detailUrl ?? ""}
          onChange={(event) => onChange({ detailUrl: event.target.value })}
          className={`${inputClassName} min-h-16 w-64 resize-y break-all`}
        />
      </td>
      <td
        className={getEditTableCellClassName("imageSettings", pinnedColumnIds)}
        style={getEditTableCellStyle(
          "imageSettings",
          pinnedColumnIds,
          rowIndex,
        )}
      >
        <div className="w-72 space-y-2">
          <label className="block space-y-1">
            <span className="block font-semibold text-slate-700">
              이미지 파일
            </span>
            <input
              key={item.localImageUrl ?? "no-local-image"}
              type="file"
              accept="image/*"
              onChange={(event) => onLocalImageChange(event.target.files?.[0])}
              className={`${inputClassName} file:mr-2 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1 file:text-xs file:font-semibold`}
            />
          </label>
          <p className="text-[11px] leading-4 text-slate-500">
            로컬 이미지 파일은 현재 화면/PDF 생성에만 사용되며 서버에 저장되지
            않습니다.
          </p>
          {item.localImageUrl && (
            <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
              <FreightItemImage
                key={item.localImageUrl}
                sources={[item.localImageUrl]}
                alt={`${item.itemName} 로컬 이미지 미리보기`}
                className="size-14 rounded bg-white object-contain"
              />
              <button
                type="button"
                onClick={() => onLocalImageChange(undefined)}
                className="font-semibold text-slate-600 hover:text-slate-900"
              >
                선택 해제
              </button>
            </div>
          )}
          <textarea
            value={item.imageUrl ?? ""}
            onChange={(event) => onChange({ imageUrl: event.target.value })}
            placeholder="직접 이미지 URL 입력"
            className={`${inputClassName} min-h-16 resize-y break-all`}
          />
          <p className="text-[11px] leading-4 text-slate-500">
            일부 외부 이미지 주소는 원본 사이트의 차단 정책 때문에 표시되지 않을
            수 있습니다.
            <br />
            이미지가 꼭 필요한 경우 로컬 이미지 파일을 직접 선택하는 방식이 가장
            안정적입니다.
          </p>
          <select
            aria-label={`${item.rowNo}행 이미지 후보 선택`}
            value={item.selectedImageCandidateUrl ?? ""}
            onChange={(event) =>
              onChange({
                selectedImageCandidateUrl: event.target.value || undefined,
              })
            }
            className={inputClassName}
          >
            <option value="">이미지 후보 선택</option>
            {imageCandidates.map((candidate, index) => (
              <option
                key={`${candidate.url}-${index}`}
                value={candidate.url}
                disabled={candidate.loadStatus === "failed"}
              >
                후보 {index + 1} ·{" "}
                {candidate.sourceType === "clipboard-file"
                  ? "클립보드 파일"
                  : candidate.loadStatus === "failed"
                    ? "이미지 로딩 실패"
                    : candidate.loadStatus === "pending"
                      ? "로딩 확인 중"
                      : "붙여넣기 이미지"}
              </option>
            ))}
          </select>
          {item.selectedImageCandidateUrl &&
            imageCandidates.find(
              (candidate) => candidate.url === item.selectedImageCandidateUrl,
            )?.loadStatus === "failed" && (
              <p className="text-[11px] font-semibold leading-4 text-red-700">
                선택한 이미지가 로딩되지 않습니다. 다른 이미지 URL을
                입력해주세요.
              </p>
            )}
        </div>
      </td>
      <td
        className={getEditTableCellClassName("orderNo", pinnedColumnIds)}
        style={getEditTableCellStyle("orderNo", pinnedColumnIds, rowIndex)}
      >
        <input
          value={item.orderNo ?? ""}
          onChange={(event) => onChange({ orderNo: event.target.value })}
          className={`${inputClassName} w-48`}
        />
      </td>
      <td
        className={getEditTableCellClassName("trackingNo", pinnedColumnIds)}
        style={getEditTableCellStyle("trackingNo", pinnedColumnIds, rowIndex)}
      >
        <input
          value={item.trackingNo ?? ""}
          onChange={(event) => onChange({ trackingNo: event.target.value })}
          className={`${inputClassName} w-40`}
        />
      </td>
      <td
        className={getEditTableCellClassName("lookupText", pinnedColumnIds)}
        style={getEditTableCellStyle("lookupText", pinnedColumnIds, rowIndex)}
      >
        <div className="w-52 space-y-2">
          <input
            value={item.lookupText ?? ""}
            onChange={(event) => onChange({ lookupText: event.target.value })}
            placeholder="B코드·정확한 모델번호·상품명"
            className={inputClassName}
          />
          <button
            type="button"
            onClick={onApply}
            className="w-full rounded-md bg-slate-800 px-3 py-2 font-semibold text-white hover:bg-slate-950"
          >
            실제 상품마스터 적용
          </button>
        </div>
      </td>
      <td
        className={getEditTableCellClassName("barcode", pinnedColumnIds)}
        style={getEditTableCellStyle("barcode", pinnedColumnIds, rowIndex)}
      >
        <label className="block w-44">
          <span className="sr-only">바코드</span>
          <input
            value={barcodeValue}
            onChange={(event) =>
              onChange({ barcode: sanitizeBarcodeValue(event.target.value) })
            }
            onBlur={onRememberBundleUnit}
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
      <td
        className={getEditTableCellClassName("matchStatus", pinnedColumnIds)}
        style={getEditTableCellStyle("matchStatus", pinnedColumnIds, rowIndex)}
      >
        <span
          className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 font-semibold ${statusStyle}`}
        >
          {status}
        </span>
      </td>
      <td
        className={getEditTableCellClassName("matchedModelNo", pinnedColumnIds)}
        style={getEditTableCellStyle(
          "matchedModelNo",
          pinnedColumnIds,
          rowIndex,
        )}
      >
        <input
          value={item.matchedModelNo ?? ""}
          onChange={(event) => onChange({ matchedModelNo: event.target.value })}
          className={`${inputClassName} w-32`}
        />
      </td>
      <td
        className={getEditTableCellClassName(
          "matchedModelName",
          pinnedColumnIds,
        )}
        style={getEditTableCellStyle(
          "matchedModelName",
          pinnedColumnIds,
          rowIndex,
        )}
      >
        <input
          value={item.matchedModelName ?? ""}
          onChange={(event) =>
            onChange({ matchedModelName: event.target.value })
          }
          className={`${inputClassName} w-40`}
        />
      </td>
      <td
        className={getEditTableCellClassName("memo", pinnedColumnIds)}
        style={getEditTableCellStyle("memo", pinnedColumnIds, rowIndex)}
      >
        <textarea
          value={item.memo ?? ""}
          onChange={(event) => onChange({ memo: event.target.value })}
          placeholder={
            "예: 개별 부착\n10개씩 소분 후 바코드 부착\n50개씩 소분 후 바코드 부착\n100개씩 소분 후 바코드 부착\n박스 외부 바코드 부착"
          }
          aria-label={`${item.rowNo}행 작업메모`}
          className={`${inputClassName} min-h-28 w-60 resize-y`}
        />
      </td>
      <td
        className={getEditTableCellClassName("bundleUnit", pinnedColumnIds)}
        style={getEditTableCellStyle("bundleUnit", pinnedColumnIds, rowIndex)}
      >
        <input
          type="number"
          min="1"
          step="1"
          value={item.bundleUnit ?? detectedBundleUnit ?? ""}
          onChange={(event) =>
            onChange({
              bundleUnit: event.target.value
                ? Number(event.target.value)
                : undefined,
            })
          }
          onBlur={onRememberBundleUnit}
          aria-label={`${item.rowNo}행 소분단위`}
          className={`${inputClassName} w-28`}
        />
      </td>
      <td
        className={getEditTableCellClassName(
          "labelPrintCount",
          pinnedColumnIds,
        )}
        style={getEditTableCellStyle(
          "labelPrintCount",
          pinnedColumnIds,
          rowIndex,
        )}
      >
        <input
          type="number"
          min="1"
          step="1"
          value={item.labelPrintCount ?? labelCalculation.printCount}
          onChange={(event) =>
            onChange({
              labelPrintCount: event.target.value
                ? Number(event.target.value)
                : undefined,
            })
          }
          aria-label={`${item.rowNo}행 바코드 출력수량`}
          className={`${inputClassName} w-32`}
        />
        {labelCalculation.hasRemainderWarning && (
          <p className="mt-1 w-44 text-[11px] font-semibold leading-4 text-amber-700">
            주의: {labelCalculation.bundleUnit}개씩 소분 시{" "}
            {labelCalculation.remainder}개가 남습니다.
            <br />
            {labelCalculation.fullBundleCount}묶음 + 잔여{" "}
            {labelCalculation.remainder}개
          </p>
        )}
      </td>
    </tr>
  );
}

function LocationBarcode({
  value,
  compact = false,
}: {
  value?: string;
  compact?: boolean;
}) {
  const encodedValue = getEncodedBarcodeValue(value);

  if (!value) {
    return (
      <span className="font-sans text-[10px] font-semibold">바코드 미입력</span>
    );
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
  const barcodeHeight = compact ? 38 : 52;
  const svgWidth = layout.width * moduleWidth;

  return (
    <div
      className={`location-barcode mx-auto flex flex-col items-center bg-white text-black ${compact ? "label-location-barcode" : "min-w-36 p-1"}`}
    >
      <span className="mb-1 font-sans text-[11px] font-black tracking-wide">
        {BARCODE_ORIGIN_LABEL}
      </span>
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
      <span className="mt-1 font-sans text-[10px] font-bold tracking-wide">
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

function BarcodeLabelCard({
  item,
  preview = false,
}: {
  item: FreightApplicationItem;
  preview?: boolean;
}) {
  const modelName =
    item.modelName?.trim() ||
    item.matchedModelName?.trim() ||
    item.matchedProductNameKo?.trim() ||
    "-";
  const modelNo = item.modelNo?.trim() || item.matchedModelNo?.trim() || "-";

  return (
    <article
      className={`barcode-label-card${preview ? " barcode-label-card-preview" : ""}`}
    >
      <LocationBarcode value={item.barcode} compact />
      <div className="barcode-label-meta">
        <span>소분단위: {formatBarcodeBundleUnit(item)}</span>
        <span title={modelName}>{modelName}</span>
        <span title={modelNo}>{modelNo}</span>
      </div>
    </article>
  );
}

function BarcodeLabelOutput({
  application,
  freightForwarderZipStatus,
  onDownloadFreightForwarderZip,
}: {
  application: FreightApplication;
  freightForwarderZipStatus: string;
  onDownloadFreightForwarderZip: () => void;
}) {
  const barcodeItems = application.items.filter((item) => item.barcode?.trim());
  const printableItems = application.items.map((item) => ({
    ...item,
    printCount: item.labelPrintCount,
  }));
  const totalPrintCount = getTotalBarcodeLabelCount(printableItems);
  const samplePrintCount = getSampleBarcodeLabelCount(printableItems);
  const missingBarcodeItems = application.items.filter(
    (item) => !item.barcode?.trim(),
  );
  const remainderItems = application.items
    .map((item) => ({ item, calculation: getItemLabelCalculation(item) }))
    .filter(({ calculation }) => calculation.hasRemainderWarning);
  const sampleLabels = buildBarcodeLabelPages(printableItems).slice(0, 3);

  return (
    <section
      className="mb-8 rounded-xl border border-violet-200 bg-violet-50 p-5 shadow-sm"
      aria-labelledby="barcode-label-output-title"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2
            id="barcode-label-output-title"
            className="font-semibold text-violet-950"
          >
            개별 바코드 라벨 미리보기
          </h2>
          <p className="mt-1 text-xs leading-5 text-violet-800">
            화면에는 처음 3장만 표시하며, PDF에는 계산된 전체 수량이 한 페이지에
            한 라벨씩 출력됩니다. 여러 신청서는 ZIP 안에서 신청번호별 폴더로
            자동 분리됩니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={onDownloadFreightForwarderZip} primary>
            배대지 전달용 개별 PDF ZIP 다운로드
          </Button>
        </div>
      </div>
      {freightForwarderZipStatus && (
        <p
          role="status"
          className="mt-3 whitespace-pre-wrap rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold leading-5 text-emerald-900"
        >
          {freightForwarderZipStatus}
        </p>
      )}
      <dl className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="총 품목 수"
          value={`${application.items.length}개`}
        />
        <SummaryCard
          label="바코드 입력 품목 수"
          value={`${barcodeItems.length}개`}
          emphasized
        />
        <SummaryCard
          label="총 라벨 출력 수량"
          value={`${totalPrintCount}장`}
          emphasized
        />
        <SummaryCard
          label="전달용 샘플 수량"
          value={`${samplePrintCount}장`}
          emphasized
        />
      </dl>
      {missingBarcodeItems.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-900">
          {missingBarcodeItems.map((item) => (
            <p key={item.id}>
              {item.applicationNo ? `${item.applicationNo} / ` : ""}
              {item.rowNo}번 품목 바코드 미입력 · 라벨 PDF에서 제외됩니다.
            </p>
          ))}
        </div>
      )}
      {remainderItems.length > 0 && (
        <div className="mt-4 rounded-lg border border-orange-300 bg-orange-50 px-4 py-3 text-xs font-semibold text-orange-900">
          <p>소분 잔여 발생 품목 {remainderItems.length}건</p>
          <div className="mt-1 space-y-1 font-medium">
            {remainderItems.map(({ item, calculation }) => (
              <p key={item.id}>
                {item.applicationNo ? `${item.applicationNo} / ` : ""}
                {item.rowNo}번: {item.quantity}개 / {calculation.bundleUnit}개씩
                → 잔여 {calculation.remainder}개
              </p>
            ))}
          </div>
        </div>
      )}
      {sampleLabels.length > 0 && (
        <div className="mt-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-violet-950">
              개별 라벨 샘플
            </h3>
            <p className="text-xs font-semibold text-violet-800">
              총 {totalPrintCount}장 출력 예정
            </p>
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
          <span className="px-1">
            {excluded ? "제외된 이미지" : "이미지 로딩 실패"}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-semibold text-slate-800">{label}</span>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${statusStyle}`}
          >
            {statusLabel}
          </span>
        </div>
        <p
          className="mt-1 truncate text-[10px] text-slate-500"
          title={candidate.url}
        >
          {candidate.url || "직접 로드할 수 없는 이미지"}
        </p>
        <p className="mt-0.5 text-[10px] text-slate-500">
          {candidate.sourceType === "clipboard-file"
            ? "브라우저 임시 이미지"
            : excluded
              ? "상품 이미지 필터에서 제외"
              : "붙여넣기 URL"}
        </p>
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
  if (!source)
    return (
      <span className="px-1 font-semibold text-slate-500">이미지 없음</span>
    );

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

function Button({
  children,
  onClick,
  primary = false,
  disabled = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${primary ? "bg-blue-600 text-white hover:bg-blue-700 disabled:hover:bg-blue-600" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:hover:bg-white"}`}
    >
      {children}
    </button>
  );
}

function SummaryCard({
  label,
  value,
  emphasized = false,
  warning = false,
}: {
  label: string;
  value: string;
  emphasized?: boolean;
  warning?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border bg-white px-4 py-3 shadow-sm ${emphasized ? "border-emerald-200" : warning ? "border-amber-200" : "border-slate-200"}`}
    >
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p
        className={`mt-1 text-lg font-bold ${emphasized ? "text-emerald-700" : warning ? "text-amber-700" : "text-slate-900"}`}
      >
        {value}
      </p>
    </div>
  );
}

const inputClassName =
  "w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
const cellClassName = "border-b border-r border-slate-200 p-2 last:border-r-0";
