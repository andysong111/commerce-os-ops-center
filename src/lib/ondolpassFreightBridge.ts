import type { RichPasteImageExtraction } from "./richPasteExtractor.ts";
import { normalizePastedImageUrl } from "./richPasteExtractor.ts";

export const ONDOLPASS_FREIGHT_BRIDGE_CHANNEL =
  "COMMERCE_OS_ONDOLPASS_FREIGHT_BRIDGE_V1";

export const ONDOLPASS_FREIGHT_PAGE_SOURCE =
  "commerce-os-freight-barcode-request";

export const ONDOLPASS_FREIGHT_EXTENSION_SOURCE =
  "commerce-os-ondolpass-freight-bridge";

const APPLICATION_NO_PATTERN = /^\d{4,20}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ITEMS = 500;
const MAX_APPLICATIONS = 500;
const MAX_DATE_RANGE_DAYS = 366;
const MAX_ITEM_TEXT_LENGTH = 20_000;

export interface OndolpassFreightBridgeItem {
  rowNo: number;
  text: string;
  imageUrl?: string;
}

export interface OndolpassFreightBridgePayload {
  applicationNo: string;
  sourceUrl: string;
  items: OndolpassFreightBridgeItem[];
}

export interface OndolpassFreightImport {
  applicationNo: string;
  rawText: string;
  pastedImages: RichPasteImageExtraction;
  itemCount: number;
}

export interface OndolpassFreightDateRangeApplication {
  applicationNo: string;
  applicationDate: string;
}

export interface OndolpassFreightDateRangeImport {
  startDate: string;
  endDate: string;
  applicationNos: string[];
  applications: OndolpassFreightDateRangeApplication[];
}

export type OndolpassFreightExtensionMessage =
  | {
      channel: typeof ONDOLPASS_FREIGHT_BRIDGE_CHANNEL;
      source: typeof ONDOLPASS_FREIGHT_EXTENSION_SOURCE;
      type: "READY";
    }
  | {
      channel: typeof ONDOLPASS_FREIGHT_BRIDGE_CHANNEL;
      source: typeof ONDOLPASS_FREIGHT_EXTENSION_SOURCE;
      type: "RESULT";
      requestId: string;
      applicationNo: string;
      payload: unknown;
    }
  | {
      channel: typeof ONDOLPASS_FREIGHT_BRIDGE_CHANNEL;
      source: typeof ONDOLPASS_FREIGHT_EXTENSION_SOURCE;
      type: "ERROR";
      requestId: string;
      applicationNo: string;
      errorCode: string;
    }
  | {
      channel: typeof ONDOLPASS_FREIGHT_BRIDGE_CHANNEL;
      source: typeof ONDOLPASS_FREIGHT_EXTENSION_SOURCE;
      type: "DATE_RANGE_RESULT";
      requestId: string;
      startDate: string;
      endDate: string;
      payload: unknown;
    }
  | {
      channel: typeof ONDOLPASS_FREIGHT_BRIDGE_CHANNEL;
      source: typeof ONDOLPASS_FREIGHT_EXTENSION_SOURCE;
      type: "DATE_RANGE_ERROR";
      requestId: string;
      startDate: string;
      endDate: string;
      errorCode: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeOndolpassApplicationNo(value: string): string {
  const normalized = value.trim();
  if (!APPLICATION_NO_PATTERN.test(normalized)) {
    throw new Error("신청서 번호는 숫자 4~20자리로 입력해주세요.");
  }

  return normalized;
}

function dateValue(value: string) {
  if (!DATE_PATTERN.test(value)) return Number.NaN;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp)) return Number.NaN;
  return new Date(timestamp).toISOString().slice(0, 10) === value
    ? timestamp
    : Number.NaN;
}

export function normalizeOndolpassDateRange(startDate: string, endDate: string) {
  const start = startDate.trim();
  const end = endDate.trim();
  const startValue = dateValue(start);
  const endValue = dateValue(end);
  if (!Number.isFinite(startValue) || !Number.isFinite(endValue)) {
    throw new Error("신청일 시작일과 종료일을 모두 선택해주세요.");
  }
  if (startValue > endValue) {
    throw new Error("신청일 시작일은 종료일보다 늦을 수 없습니다.");
  }
  if ((endValue - startValue) / 86_400_000 > MAX_DATE_RANGE_DAYS) {
    throw new Error("한 번에 조회할 수 있는 신청일 범위는 최대 366일입니다.");
  }
  return { startDate: start, endDate: end };
}

export function buildOndolpassFreightDateRangeImport(
  value: unknown,
  expectedStartDate: string,
  expectedEndDate: string,
): OndolpassFreightDateRangeImport {
  const expected = normalizeOndolpassDateRange(
    expectedStartDate,
    expectedEndDate,
  );
  if (!isRecord(value)) {
    throw new Error("온돌패스 날짜 조회 응답 형식을 확인할 수 없습니다.");
  }
  const actual = normalizeOndolpassDateRange(
    typeof value.startDate === "string" ? value.startDate : "",
    typeof value.endDate === "string" ? value.endDate : "",
  );
  if (
    actual.startDate !== expected.startDate ||
    actual.endDate !== expected.endDate
  ) {
    throw new Error("요청한 신청일과 조회된 신청일 범위가 다릅니다.");
  }

  if (typeof value.sourceUrl !== "string") {
    throw new Error("온돌패스 신청현황 주소를 확인할 수 없습니다.");
  }
  let sourceUrl: URL;
  try {
    sourceUrl = new URL(value.sourceUrl);
  } catch {
    throw new Error("온돌패스 신청현황 주소 형식이 올바르지 않습니다.");
  }
  const isAllowedHost =
    sourceUrl.hostname === "ondolpass.co.kr" ||
    sourceUrl.hostname === "www.ondolpass.co.kr";
  if (
    sourceUrl.protocol !== "https:" ||
    !isAllowedHost ||
    sourceUrl.pathname !== "/mypage/ship_lcl_list.php" ||
    sourceUrl.searchParams.get("date_type") !== "order_date" ||
    sourceUrl.searchParams.get("s_date") !== expected.startDate ||
    sourceUrl.searchParams.get("e_date") !== expected.endDate ||
    sourceUrl.searchParams.get("page_line") !== "500"
  ) {
    throw new Error("요청한 조건과 다른 온돌패스 신청현황이 열렸습니다.");
  }

  if (
    !Array.isArray(value.applications) ||
    value.applications.length > MAX_APPLICATIONS
  ) {
    throw new Error("날짜 조회 신청서가 500건을 초과해 가져오기를 중단했습니다.");
  }
  const applications = value.applications.map((row) => {
    if (!isRecord(row)) {
      throw new Error("온돌패스 날짜 조회 신청서 형식을 확인할 수 없습니다.");
    }
    const applicationNo = normalizeOndolpassApplicationNo(
      typeof row.applicationNo === "string" ? row.applicationNo : "",
    );
    const applicationDate =
      typeof row.applicationDate === "string" ? row.applicationDate.trim() : "";
    const rowDateValue = dateValue(applicationDate);
    const startValue = dateValue(expected.startDate);
    const endValue = dateValue(expected.endDate);
    if (
      !Number.isFinite(rowDateValue) ||
      rowDateValue < startValue ||
      rowDateValue > endValue
    ) {
      throw new Error(`신청서 ${applicationNo}의 신청일이 조회 범위를 벗어났습니다.`);
    }
    return { applicationNo, applicationDate };
  });
  const uniqueApplicationNos = new Set(
    applications.map((row) => row.applicationNo),
  );
  if (uniqueApplicationNos.size !== applications.length) {
    throw new Error("온돌패스 날짜 조회 결과에 중복 신청서가 있습니다.");
  }
  return {
    ...expected,
    applicationNos: applications.map((row) => row.applicationNo),
    applications,
  };
}

function validateSourceUrl(value: unknown, applicationNo: string): string {
  if (typeof value !== "string") {
    throw new Error("온돌패스 신청서 주소를 확인할 수 없습니다.");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("온돌패스 신청서 주소 형식이 올바르지 않습니다.");
  }

  const isAllowedHost =
    url.hostname === "ondolpass.co.kr" ||
    url.hostname === "www.ondolpass.co.kr";
  if (
    url.protocol !== "https:" ||
    !isAllowedHost ||
    url.pathname !== "/order/order_view.php" ||
    url.searchParams.get("order_no") !== applicationNo
  ) {
    throw new Error("요청한 번호와 다른 온돌패스 페이지가 열렸습니다.");
  }

  return url.toString();
}

function validateItem(value: unknown): OndolpassFreightBridgeItem {
  if (!isRecord(value)) {
    throw new Error("온돌패스 제품정보 형식을 확인할 수 없습니다.");
  }

  const rowNo = value.rowNo;
  const text = value.text;
  if (!Number.isInteger(rowNo) || Number(rowNo) < 1 || Number(rowNo) > MAX_ITEMS) {
    throw new Error("온돌패스 제품정보 번호가 올바르지 않습니다.");
  }
  if (
    typeof text !== "string" ||
    !text.trim() ||
    text.length > MAX_ITEM_TEXT_LENGTH ||
    !/제품\s*정보\s*[:：]?\s*\(?\d+\)?/i.test(text)
  ) {
    throw new Error(`제품정보 ${rowNo}번의 본문을 확인할 수 없습니다.`);
  }
  if (/수취인\s*정보|세부주소|휴대전화/i.test(text)) {
    throw new Error("제품정보가 아닌 개인정보 영역이 포함되어 가져오기를 중단했습니다.");
  }

  const imageUrl =
    typeof value.imageUrl === "string"
      ? normalizePastedImageUrl(value.imageUrl)
      : undefined;

  return {
    rowNo: Number(rowNo),
    text: text.trim(),
    imageUrl,
  };
}

export function buildOndolpassFreightImport(
  value: unknown,
  expectedApplicationNo: string,
): OndolpassFreightImport {
  const expected = normalizeOndolpassApplicationNo(expectedApplicationNo);
  if (!isRecord(value)) {
    throw new Error("온돌패스 브리지 응답 형식을 확인할 수 없습니다.");
  }

  const applicationNo =
    typeof value.applicationNo === "string"
      ? normalizeOndolpassApplicationNo(value.applicationNo)
      : "";
  if (applicationNo !== expected) {
    throw new Error("요청한 번호와 가져온 신청서 번호가 다릅니다.");
  }
  validateSourceUrl(value.sourceUrl, applicationNo);

  if (
    !Array.isArray(value.items) ||
    value.items.length === 0 ||
    value.items.length > MAX_ITEMS
  ) {
    throw new Error("온돌패스 신청서에서 제품정보를 찾지 못했습니다.");
  }

  const items = value.items.map(validateItem).sort((left, right) => left.rowNo - right.rowNo);
  const uniqueRows = new Set(items.map((item) => item.rowNo));
  if (uniqueRows.size !== items.length) {
    throw new Error("온돌패스 신청서에 중복된 제품정보 번호가 있습니다.");
  }

  const candidates = items.flatMap((item, blockIndex) =>
    item.imageUrl
      ? [
          {
            url: item.imageUrl,
            blockIndex,
            score: 150,
            alt: `온돌패스 제품정보 ${item.rowNo}`,
            sourceType: "html" as const,
            loadStatus: "pending" as const,
          },
        ]
      : [],
  );

  return {
    applicationNo,
    rawText: [`신청번호:${applicationNo}`, ...items.map((item) => item.text)].join(
      "\n\n",
    ),
    pastedImages: {
      totalImages: candidates.length,
      candidates,
      excludedCandidates: [],
      ignoredImages: 0,
      productBlockCount: items.length,
    },
    itemCount: items.length,
  };
}

export function parseOndolpassFreightExtensionMessage(
  value: unknown,
): OndolpassFreightExtensionMessage | undefined {
  if (
    !isRecord(value) ||
    value.channel !== ONDOLPASS_FREIGHT_BRIDGE_CHANNEL ||
    value.source !== ONDOLPASS_FREIGHT_EXTENSION_SOURCE
  ) {
    return undefined;
  }

  if (value.type === "READY") {
    return {
      channel: ONDOLPASS_FREIGHT_BRIDGE_CHANNEL,
      source: ONDOLPASS_FREIGHT_EXTENSION_SOURCE,
      type: "READY",
    };
  }

  if (
    (value.type === "DATE_RANGE_RESULT" || value.type === "DATE_RANGE_ERROR") &&
    typeof value.requestId === "string" &&
    typeof value.startDate === "string" &&
    typeof value.endDate === "string"
  ) {
    if (value.type === "DATE_RANGE_RESULT") {
      return {
        channel: ONDOLPASS_FREIGHT_BRIDGE_CHANNEL,
        source: ONDOLPASS_FREIGHT_EXTENSION_SOURCE,
        type: "DATE_RANGE_RESULT",
        requestId: value.requestId,
        startDate: value.startDate,
        endDate: value.endDate,
        payload: value.payload,
      };
    }
    return {
      channel: ONDOLPASS_FREIGHT_BRIDGE_CHANNEL,
      source: ONDOLPASS_FREIGHT_EXTENSION_SOURCE,
      type: "DATE_RANGE_ERROR",
      requestId: value.requestId,
      startDate: value.startDate,
      endDate: value.endDate,
      errorCode:
        typeof value.errorCode === "string"
          ? value.errorCode
          : "BRIDGE_UNKNOWN_ERROR",
    };
  }

  if (
    (value.type !== "RESULT" && value.type !== "ERROR") ||
    typeof value.requestId !== "string" ||
    typeof value.applicationNo !== "string"
  ) {
    return undefined;
  }

  if (value.type === "RESULT") {
    return {
      channel: ONDOLPASS_FREIGHT_BRIDGE_CHANNEL,
      source: ONDOLPASS_FREIGHT_EXTENSION_SOURCE,
      type: "RESULT",
      requestId: value.requestId,
      applicationNo: value.applicationNo,
      payload: value.payload,
    };
  }

  return {
    channel: ONDOLPASS_FREIGHT_BRIDGE_CHANNEL,
    source: ONDOLPASS_FREIGHT_EXTENSION_SOURCE,
    type: "ERROR",
    requestId: value.requestId,
    applicationNo: value.applicationNo,
    errorCode:
      typeof value.errorCode === "string" ? value.errorCode : "BRIDGE_UNKNOWN_ERROR",
  };
}

export function getOndolpassFreightBridgeErrorMessage(errorCode: string): string {
  switch (errorCode) {
    case "ONDOLPASS_LOGIN_REQUIRED":
      return "온돌패스 로그인이 필요합니다. 열린 온돌패스 탭에서 로그인한 뒤 다시 눌러주세요.";
    case "APPLICATION_NOT_FOUND_OR_EMPTY":
      return "해당 신청서에서 제품정보를 찾지 못했습니다. 신청서 번호와 접근 권한을 확인해주세요.";
    case "BRIDGE_BUSY":
      return "다른 신청서를 가져오는 중입니다. 잠시 후 다시 눌러주세요.";
    case "ONDOLPASS_PAGE_TIMEOUT":
      return "온돌패스 페이지가 제한시간 안에 열리지 않았습니다. 인터넷 연결을 확인한 뒤 다시 시도해주세요.";
    case "APPLICATION_NUMBER_MISMATCH":
      return "요청한 번호와 열린 온돌패스 신청서가 달라 가져오기를 중단했습니다.";
    case "DATE_RANGE_RESULT_TOO_LARGE":
      return "해당 기간의 신청서가 500건 이상입니다. 기간을 나눠서 다시 조회해주세요.";
    case "DATE_RANGE_RESULT_INVALID":
      return "온돌패스 날짜 조회 결과를 검증하지 못했습니다. 기간을 다시 선택해주세요.";
    case "BRIDGE_RELOAD_REQUIRED":
      return "확장프로그램이 갱신되었습니다. Commerce OS 화면을 새로고침한 뒤 다시 눌러주세요.";
    case "BRIDGE_RUNTIME_ERROR":
    case "ONDOLPASS_CAPTURE_UNAVAILABLE":
      return "온돌패스 읽기 연결에 실패했습니다. 확장프로그램을 새로고침하고 다시 실행해주세요.";
    default:
      return "온돌패스 신청서를 가져오지 못했습니다. 브리지 확장 연결과 온돌패스 로그인을 확인해주세요.";
  }
}
