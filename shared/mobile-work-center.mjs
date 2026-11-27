const catalog = {
  "full-operations": ["주문·출고", "1. 전체 업무 진행"],
  "post-packing-invoices": ["주문·출고", "4. 미발송 송장 처리", "invoices"],
  "preprint-operations": ["주문·출고", "6. 송장출력 직전까지 준비"],
  "print-operations": ["주문·출고", "7. 송장출력까지 진행"],
  "picking-list": ["주문·출고", "8. 피킹 목록 생성 · 내 카톡 전송", "standard", true],
  "return-pickup": ["문의·반품", "1-1. 반품건 수거접수"],
  "service-operations": ["문의·반품", "2. 문의·클레임 업무 진행"],
  "qna-operations": ["문의·반품", "3. 문의 수집·답변 처리"],
  "1688-cart-staging": ["발주·입고", "5-1. 1688 장바구니 일치", "draft"],
  "1688-cost-capture": ["발주·입고", "5-2. 가격·운임 기록", "draft"],
  "1688-unpaid-order": ["발주·입고", "5-3. 미결제 주문 생성", "order"],
  "1688-final-payment-verification": ["발주·입고", "5-4. 결제 직전 일치 검증", "draft"],
  "1688-payment-review": ["발주·입고", "5-5. 1688 결제 완료 대조", "draft"],
  "ondolpass-application": ["발주·입고", "11. 온돌패스 LCL 신청서 작성", "draft", false, "extension"],
  "ondolpass-tracking": ["발주·입고", "11-1. 온돌패스 트레킹번호 입력", "standard", false, "extension"],
  "ondolpass-receipt-status": ["발주·입고", "11-2. 온돌패스 입고현황 확인", "draft", true, "extension"],
  "popbill-tax-invoice": ["세금계산서", "9. 팝빌 발행대기 확인 · 시험발행"],
  "barobill-tax-invoice": ["세금계산서", "10. 바로빌 발급대기 확인 · 시험발행"],
  "domeggook-extension": ["도매꾹", "기간연장 전체 즉시실행", "standard", false, "domeggook"],
  "domeggook-withdrawal-check": ["도매꾹", "4계정 출금 가능액 조회", "standard", true, "domeggook"],
  "domeggook-withdrawal-execute": ["도매꾹", "4계정 출금 가능액 전액 신청", "standard", false, "domeggook"],
  "connection-check": ["연결", "PC 연결 시험", "standard", true, "diagnostic"],
};

export const MOBILE_ACTIONS = Object.freeze(Object.fromEntries(
  Object.entries(catalog).map(([id, [group, label, input = "standard", readOnly = false, kind = "local"]]) => [
    id, Object.freeze({ id, group, label, input, readOnly, kind }),
  ]),
));
export const MOBILE_DRAFT_ID = /^fast-purchase-draft:[a-f0-9]{20}$/;
export const REQUEST_MAX_AGE_MS = 120_000;
export const AGENT_ONLINE_MS = 85_000;
export const UNPAID_ORDER_PHRASE = "미결제 주문 생성";

export function isMobileRequestId(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function mobileAction(id) {
  return typeof id === "string" && Object.hasOwn(MOBILE_ACTIONS, id) ? MOBILE_ACTIONS[id] : null;
}

export function canChooseDryRun(action) {
  return action.kind === "local" && !action.readOnly && action.input !== "order";
}

export function invoiceGroups(invoiceNumbers, inventoryShortageInvoiceNumbers) {
  if (!Array.isArray(invoiceNumbers) || !Array.isArray(inventoryShortageInvoiceNumbers)) throw new Error("두 종류의 송장 목록을 확인해 주세요.");
  const all = [...invoiceNumbers, ...inventoryShortageInvoiceNumbers];
  if (all.length > 50) throw new Error("송장번호는 두 칸을 합쳐 최대 50개입니다.");
  if (all.some((number) => typeof number !== "string" || !/^\d{12}$/.test(number))) throw new Error("송장번호는 하이픈 없이 12자리 숫자로 입력해 주세요.");
  if (new Set(all).size !== all.length) throw new Error("중복된 송장번호가 있습니다. 각 송장은 한 분류에 한 번만 입력해 주세요.");
  return { invoiceNumbers, inventoryShortageInvoiceNumbers };
}

export function normalizeWorkRequest(body) {
  const action = mobileAction(body?.actionId);
  if (!action || !isMobileRequestId(body.id) || !Number.isSafeInteger(body.issuedAt) || typeof body.execute !== "boolean") return null;
  const execute = body.execute;
  if (action.readOnly && execute || !action.readOnly && !execute && !canChooseDryRun(action)) return null;
  if (execute && body.confirmed !== true) return null;
  const command = { id: body.id, issuedAt: body.issuedAt, actionId: action.id, execute, confirmed: execute };
  if (["draft", "order"].includes(action.input)) {
    if (typeof body.draftId !== "string" || !MOBILE_DRAFT_ID.test(body.draftId)) return null;
    command.draftId = body.draftId;
  }
  if (action.input === "order") {
    if (body.confirmation !== UNPAID_ORDER_PHRASE) return null;
    command.confirmation = UNPAID_ORDER_PHRASE;
  }
  if (action.input === "invoices") {
    try {
      const groups = invoiceGroups(body.invoiceNumbers, body.inventoryShortageInvoiceNumbers);
      if (!groups.invoiceNumbers.length && !groups.inventoryShortageInvoiceNumbers.length) return null;
      Object.assign(command, groups);
    } catch { return null; }
  }
  return command;
}

export function isAgentOnline(agent, now) {
  return Boolean(agent && Number.isSafeInteger(agent.seenAt) && now - agent.seenAt < AGENT_ONLINE_MS && agent.seenAt <= now);
}

export function normalizeAgentStatus(body, now) {
  const actions = Array.isArray(body?.actions) ? [...new Set(body.actions.filter(mobileAction))] : [];
  return { seenAt: now, ready: body?.ready === true, busy: body?.busy === true, actions };
}
