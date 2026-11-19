export type ShoplingBlockedTransitionDetail = {
  errorCode:
    | "SHOPLING_OPTION_STATUS_TRANSITION_BLOCKED"
    | "SHOPLING_PRODUCT_STATUS_TRANSITION_BLOCKED";
  subject: "OPTION" | "PRODUCT";
  subjectLabel: "옵션" | "상품";
  barcode: string;
  desiredStatus: string;
  desiredStatusLabel: string;
  currentStatusCode: string;
  currentStatusLabel: string;
  phaseLabel: string;
  transmissionStarted: false;
  transmissionImpact: string;
  reason: string;
  nextAction: string;
  message: string;
};

export type ShoplingStockFailureDisplay = {
  failurePhaseLabel: string;
  failureReason: string;
  failureImpact: string;
  failureNextAction: string;
  failureCurrentStatus: string;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function statusCode(value: unknown) {
  const normalized = text(value).toUpperCase();
  return /^[A-Z0-9_-]{1,24}$/.test(normalized) ? normalized : "UNKNOWN";
}

export function shoplingSaleStatusLabel(value: unknown) {
  const code = statusCode(value);
  if (code === "A") return "대기중";
  if (code === "B") return "판매중";
  if (code === "C") return "품절";
  if (code === "D") return "판매중지";
  if (code === "E") return "판매종료";
  if (code === "Z") return "삭제";
  if (code === "EMPTY") return "상태값 없음";
  return "B/C 외 상태";
}

function desiredStatusLabel(value: unknown) {
  return text(value).toUpperCase() === "ON_SALE" ? "판매중" : "품절";
}

function blockedNextAction(currentStatusCode: string) {
  if (currentStatusCode === "E") {
    return "판매종료 상품은 판매중·품절 전환 대상이 아닙니다. 현재 버전은 해당 GOODS KEY만 자동 제외하고 같은 B코드의 나머지 상품을 계속 처리합니다.";
  }
  if (currentStatusCode === "Z") {
    return "삭제 상품은 품절·판매중 전환 대상이 아닙니다. Shopling에서 상품을 다시 사용할지 또는 재등록할지 먼저 결정한 뒤 수동 처리하세요.";
  }
  if (currentStatusCode === "EMPTY") {
    return "Shopling API가 현재 상태값을 주지 않았습니다. 상품 존재 여부와 GOODS KEY 연결을 확인한 뒤 이 B코드만 다시 시도하세요.";
  }
  return `Shopling에서 현재 상태 ${currentStatusCode}를 판매중(B) 또는 품절(C)로 정리한 뒤 이 B코드만 다시 시도하세요. 상태를 고치지 않은 2·3차 재시도는 같은 사유로 다시 멈춥니다.`;
}

export function buildShoplingBlockedTransitionDetail(
  error: unknown,
  context: {
    barcode?: unknown;
    desiredStatus?: unknown;
  } = {},
): ShoplingBlockedTransitionDetail | null {
  const raw = error instanceof Error ? error.message : text(error);
  const match = raw.match(
    /^(SHOPLING_(OPTION|PRODUCT)_STATUS_TRANSITION_BLOCKED):([^:]*)/,
  );
  if (!match) return null;

  const subject = match[2] as "OPTION" | "PRODUCT";
  const subjectLabel = subject === "OPTION" ? "옵션" : "상품";
  const currentStatusCode = statusCode(match[3] || "EMPTY");
  const currentStatusLabel = shoplingSaleStatusLabel(currentStatusCode);
  const barcode = text(context.barcode).toUpperCase();
  const desired = text(context.desiredStatus).toUpperCase();
  const desiredLabel = desiredStatusLabel(desired);
  const observed = `${currentStatusCode}(${currentStatusLabel})`;
  const reason = `현재 Shopling ${subjectLabel} 상태가 ${observed}라 자동 전환 허용 범위인 B(판매중)·C(품절)에 포함되지 않습니다.`;
  const transmissionImpact =
    "상태 검증 단계에서 중단되어 A21 팝업을 열거나 파란 전송 버튼을 누르지 않았습니다. Shopling 전송 접수도 없습니다.";
  const nextAction = blockedNextAction(currentStatusCode);

  return {
    errorCode: match[1] as ShoplingBlockedTransitionDetail["errorCode"],
    subject,
    subjectLabel,
    barcode,
    desiredStatus: desired,
    desiredStatusLabel: desiredLabel,
    currentStatusCode,
    currentStatusLabel,
    phaseLabel: "전송 전 · Shopling API 상태 검증",
    transmissionStarted: false,
    transmissionImpact,
    reason,
    nextAction,
    message: `${barcode ? `${barcode} · ` : ""}${reason} 요청한 ${desiredLabel} 전환을 시작하지 않았습니다. ${transmissionImpact} ${nextAction}`,
  };
}

function currentStatusFromMessage(message: string) {
  const match = message.match(
    /현재 Shopling (?:상품|옵션) 상태가 ([A-Z0-9_-]{1,24})\(([^)]+)\)/i,
  );
  if (!match) return "";
  return `${statusCode(match[1])}(${text(match[2])})`;
}

export function describeShoplingStockFailure(input: {
  outcome?: unknown;
  code?: unknown;
  stage?: unknown;
  message?: unknown;
  browserMutationStarted?: unknown;
}): ShoplingStockFailureDisplay | null {
  if (text(input.outcome).toUpperCase() === "SUCCEEDED") return null;

  const code = text(input.code);
  const stage = text(input.stage);
  const message = text(input.message);
  const currentStatus = currentStatusFromMessage(message);
  if (code === "SHOPLING_STOCK_STATE_COALESCED_API_FAILED") {
    const currentCode = currentStatus.split("(", 1)[0] || "";
    return {
      failurePhaseLabel: "전송 전 · Shopling API 상태 검증",
      failureReason:
        message ||
        "Shopling API에서 상품·옵션의 현재 상태를 안전한 전환 대상으로 확인하지 못했습니다.",
      failureImpact:
        "A21 팝업과 파란 전송 버튼을 실행하기 전에 중단했습니다. Shopling 전송 접수는 없습니다.",
      failureNextAction: currentCode
        ? blockedNextAction(currentCode)
        : "현재 상태 원문이 과거 결과에 저장되지 않았습니다. Shopling 상품 상태와 GOODS KEY 연결을 확인한 뒤 이 B코드만 다시 시도하세요.",
      failureCurrentStatus: currentStatus || "당시 응답에 상태 원문 미저장",
    };
  }

  const preSubmit = input.browserMutationStarted === false;
  return {
    failurePhaseLabel: stage
      ? `Shopling 자동화 · ${stage}`
      : preSubmit
        ? "전송 전 준비 단계"
        : "Shopling 결과 확인 단계",
    failureReason: message || "자동화가 구체적인 실패 메시지를 남기지 않았습니다.",
    failureImpact: preSubmit
      ? "외부 전송을 시작하기 전에 중단했습니다."
      : "원본 전송 접수 영수증을 완전히 확인하지 못해 성공으로 처리하지 않았습니다.",
    failureNextAction:
      "표시된 단계와 오류 코드를 확인한 뒤 이 B코드만 다시 시도하세요. 이미 전송 팝업이나 접수 결과가 보였다면 중복 전송 전에 Shopling 결과를 먼저 확인하세요.",
    failureCurrentStatus: "-",
  };
}
