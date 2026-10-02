import { assessShoplingQnaReply } from "./shopling-qna-reply-plan.mjs";

const CASES = {
  SYSTEM_NOTICE_NO_REPLY: {
    label: "답변 불필요 시스템 안내",
    requiredEvidence: [],
    preview: "",
  },
  EXTERNAL_ACTION_REQUIRED: {
    label: "외부 쇼핑몰 화면 처리 필요",
    requiredEvidence: ["EXTERNAL_MARKETPLACE_ACTION"],
    preview: "",
  },
  COMPLIANCE_OR_CERTIFICATION: {
    label: "인증·소명",
    requiredEvidence: ["VERIFIED_COMPLIANCE_DOCUMENT"],
    preview: "",
  },
  DELIVERY_EXCEPTION_OR_INVOICE_ERROR: {
    label: "품절·가송장·출고 예외",
    requiredEvidence: ["CURRENT_ORDER_INVENTORY_AND_INVOICE_STATUS"],
    preview: "안녕하세요. 주문 건은 [실제 재고, 송장 및 출고 가능 여부]로 확인되었습니다. [후속 처리 방법]을 안내드립니다. 감사합니다.",
  },
  BULK_STOCK_AVAILABILITY: {
    label: "대량 재고·입고 일정",
    requiredEvidence: ["CURRENT_VERIFIED_STOCK_AND_REPLENISHMENT_ETA"],
    preview: "안녕하세요. 문의하신 상품의 [현재 확인 재고]와 [요청 수량 주문 가능 여부]를 확인했습니다. 부족한 경우 [추가 입고 가능 일정]을 안내드립니다. 감사합니다.",
  },
  CANCELLATION_REQUEST: {
    label: "주문 취소",
    requiredEvidence: ["CURRENT_ORDER_CANCELLATION_STATUS"],
    preview: "안녕하세요. 주문 건의 현재 취소 상태는 [취소 처리 상태]입니다. [추가 안내] 감사합니다.",
  },
  SHIPPING_FEE_ADJUSTMENT: {
    label: "배송비 확인·조정",
    requiredEvidence: ["ORDER_AND_SHIPPING_FEE_BREAKDOWN"],
    preview: "안녕하세요. 주문 수량과 배송 조건을 확인한 결과 [배송비 산정 및 조정 가능 여부]입니다. [처리 방법] 감사합니다.",
  },
  DEFECT_OR_ITEM_ISSUE: {
    label: "상품 불량·설명 불일치",
    requiredEvidence: ["ORDER_AND_CUSTOMER_EVIDENCE"],
    preview: "안녕하세요. 전달해 주신 상품 상태를 확인한 결과 [확인 결과]입니다. [반품·교환 처리 방법]을 안내드립니다. 감사합니다.",
  },
  RETURN_REFUND_DECISION: {
    label: "반품·환불 결정",
    requiredEvidence: ["CURRENT_CLAIM_AND_PICKUP_STATUS"],
    preview: "안녕하세요. 해당 주문의 현재 반품·환불 상태는 [확인된 상태]입니다. [다음 처리 일정 또는 방법]을 안내드립니다. 감사합니다.",
  },
  RETURN_PICKUP_OR_TRACKING: {
    label: "반품 수거·반송장",
    requiredEvidence: ["CURRENT_CLAIM_AND_PICKUP_STATUS"],
    preview: "안녕하세요. 반품 수거 상태를 확인한 결과 [수거 접수 상태 및 반송장]입니다. [다음 처리]를 안내드립니다. 감사합니다.",
  },
  DELIVERY_DELAY_OR_TRACKING: {
    label: "배송 지연·배송 추적",
    requiredEvidence: ["CURRENT_ORDER_AND_TRACKING_STATUS"],
    preview: "안녕하세요. 택배사 배송 조회 결과 [현재 배송 상태]입니다. [예상 일정 또는 후속 조치]를 안내드립니다. 감사합니다.",
  },
  DELIVERY_SCHEDULE: {
    label: "출고 일정",
    requiredEvidence: ["CURRENT_ORDER_AND_TRACKING_STATUS"],
    preview: "안녕하세요. 주문 건의 현재 출고 상태는 [확인된 출고 상태]이며, [출고 예정일 또는 운송장 정보]입니다. 감사합니다.",
  },
  PRODUCT_INFORMATION: {
    label: "상품 정보·사용 방법",
    requiredEvidence: ["VERIFIED_PRODUCT_FACTS"],
    preview: "안녕하세요. 문의하신 상품은 [검증된 상품 구성·사용·조립 정보]입니다. 감사합니다.",
  },
  OTHER_MANUAL: {
    label: "기타 수동 검토",
    requiredEvidence: ["MANUAL_CONTEXT"],
    preview: "안녕하세요. 문의 내용을 확인한 결과 [검증된 안내 내용]입니다. 감사합니다.",
  },
};

function clean(value) {
  return String(value || "").replace(/<br\s*\/?>|\/br/giu, " ").replace(/\s+/g, " ").trim();
}

function has(source, pattern) {
  return pattern.test(source);
}

export function classifyShoplingQnaCase(qna = {}) {
  const source = clean(`${qna.qnaType || ""} ${qna.title || ""} ${qna.question || ""}`).toLowerCase();
  let category = "OTHER_MANUAL";

  if (has(source, /댓글 답변은 확인하지 않|상단 링크에 답변|응답 제출을 위해|링크를 통해 .*확인/u)) {
    category = "EXTERNAL_ACTION_REQUIRED";
  } else if (has(source, /답변이 필요하지 않으며|자동으로 답변 완료|다시 응답하지 않으셔도/u)) {
    category = "SYSTEM_NOTICE_NO_REPLY";
  } else if (has(source, /kc\s*인증|인증 소명|소명자료|안전기준|세부 법령/u)) {
    category = "COMPLIANCE_OR_CERTIFICATION";
  } else if (has(source, /(?:\d+\s*개\s*)?(?:현재고|재고\s*(?:수량|있|보유|확인|가능))|없으면\s*언제|입고\s*(?:예정|일정|가능)/u)) {
    category = "BULK_STOCK_AVAILABILITY";
  } else if (has(source, /가송장|송장(?:번호)?가?\s*(?:잘못|오류)|품절|재고.*없/u)) {
    category = "DELIVERY_EXCEPTION_OR_INVOICE_ERROR";
  } else if (has(source, /취소\s*(?:요청|승인|처리)/u)) {
    category = "CANCELLATION_REQUEST";
  } else if (has(source, /파손|불량|하자|오배송|설명과 달라|허술|뭉툭/u)) {
    category = "DEFECT_OR_ITEM_ISSUE";
  } else if (has(source, /선환불|직권환불|환불.*(?:가능|진행하여도|되지 않았|먼저)/u)) {
    category = "RETURN_REFUND_DECISION";
  } else if (has(source, /반품수거|수거|회수|반송장|반품 택배사|입고 송장/u)) {
    category = "RETURN_PICKUP_OR_TRACKING";
  } else if (has(source, /반품|환불|교환/u)) {
    category = "RETURN_REFUND_DECISION";
  } else if (has(source, /배송비|추가 배송비/u)) {
    category = "SHIPPING_FEE_ADJUSTMENT";
  } else if (has(source, /배송.*지연|출고.*지연|배송 예정일.*경과|배송상태|운송장.*수정|움직임이 없/u)) {
    category = "DELIVERY_DELAY_OR_TRACKING";
  } else if (has(source, /출고|발송|배송준비|언제쯤 출발|당일 출고/u)) {
    category = "DELIVERY_SCHEDULE";
  } else if (has(source, /상품q&a|상품문의|완제품|조립|사용(?:법|방법)|사이즈|규격|재질/u)) {
    category = "PRODUCT_INFORMATION";
  }

  return {
    category,
    label: CASES[category].label,
    requiredEvidence: [...CASES[category].requiredEvidence],
  };
}

function verifiedEvidence(evidence, code) {
  return (evidence || []).find((item) => clean(item?.code) === code
    && clean(item?.status) === "VERIFIED"
    && clean(item?.replyText));
}

export function buildShoplingQnaDraftCandidate(qna = {}, evidence = []) {
  const classification = classifyShoplingQnaCase(qna);
  const base = {
    ...classification,
    historicalAnswerUsed: false,
  };

  if (classification.category === "SYSTEM_NOTICE_NO_REPLY") {
    return {
      ...base,
      draftStatus: "NO_REPLY_REQUIRED",
      draft: null,
      draftPreview: null,
      review: null,
    };
  }
  if (["EXTERNAL_ACTION_REQUIRED", "COMPLIANCE_OR_CERTIFICATION"].includes(classification.category)) {
    return {
      ...base,
      draftStatus: "MANUAL_ACTION_REQUIRED",
      draft: null,
      draftPreview: null,
      review: null,
    };
  }

  const matches = classification.requiredEvidence.map((code) => verifiedEvidence(evidence, code));
  const missingEvidence = classification.requiredEvidence.filter((_, index) => !matches[index]);
  if (missingEvidence.length) {
    return {
      ...base,
      draftStatus: "BLOCKED_NEEDS_EVIDENCE",
      missingEvidence,
      draft: null,
      draftPreview: CASES[classification.category].preview,
      review: null,
    };
  }

  const draft = clean(matches.map((item) => item.replyText).join(" "));
  return {
    ...base,
    draftStatus: "DRAFT_READY_FOR_APPROVAL",
    missingEvidence: [],
    draft,
    draftPreview: draft,
    review: assessShoplingQnaReply(qna, draft),
  };
}

export function analyzeShoplingQnaHistory(qnas = [], options = {}) {
  const evidenceByQnaKey = options.evidenceByQnaKey || {};
  const cases = qnas.map((qna) => {
    const candidate = buildShoplingQnaDraftCandidate(qna, evidenceByQnaKey[clean(qna.qnaKey)] || []);
    return {
      qnaKey: clean(qna.qnaKey),
      productId: clean(qna.productId),
      qnaType: clean(qna.qnaType),
      askedAt: clean(qna.askedAt),
      historicalAnswerPresent: Boolean(clean(qna.answer)),
      ...candidate,
    };
  });
  const counts = (field) => Object.fromEntries([...new Set(cases.map((item) => item[field]))]
    .sort()
    .map((value) => [value, cases.filter((item) => item[field] === value).length]));
  return {
    schemaVersion: 1,
    mode: "DRAFT_TEST_ONLY",
    total: cases.length,
    categoryCounts: counts("category"),
    draftStatusCounts: counts("draftStatus"),
    cases,
    externalWritesPerformed: false,
    privacy: {
      rawQuestionStored: false,
      rawTitleStored: false,
      questionerIdentityStored: false,
      historicalAnswerStored: false,
    },
  };
}
