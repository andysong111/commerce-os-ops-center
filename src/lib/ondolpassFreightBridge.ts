import type { RichPasteImageExtraction } from "./richPasteExtractor.ts";
import { normalizePastedImageUrl } from "./richPasteExtractor.ts";

export const ONDOLPASS_FREIGHT_BRIDGE_CHANNEL =
  "COMMERCE_OS_ONDOLPASS_FREIGHT_BRIDGE_V1";

export const ONDOLPASS_FREIGHT_PAGE_SOURCE =
  "commerce-os-freight-barcode-request";

export const ONDOLPASS_FREIGHT_EXTENSION_SOURCE =
  "commerce-os-ondolpass-freight-bridge";

const APPLICATION_NO_PATTERN = /^\d{4,20}$/;
const MAX_ITEMS = 500;
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
    case "BRIDGE_RELOAD_REQUIRED":
      return "확장프로그램이 갱신되었습니다. Commerce OS 화면을 새로고침한 뒤 다시 눌러주세요.";
    case "BRIDGE_RUNTIME_ERROR":
    case "ONDOLPASS_CAPTURE_UNAVAILABLE":
      return "온돌패스 읽기 연결에 실패했습니다. 확장프로그램을 새로고침하고 다시 실행해주세요.";
    default:
      return "온돌패스 신청서를 가져오지 못했습니다. 브리지 확장 연결과 온돌패스 로그인을 확인해주세요.";
  }
}
