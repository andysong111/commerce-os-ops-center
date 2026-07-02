export type SourcingMode = "FOLLOW_PROVEN" | "DISCOVER_NEW";
export type SourcingDecision = "ORDER_READY" | "HOLD" | "REJECT";
export type RiskLevel = "LOW" | "CAUTION" | "HOLD" | "BLOCKED";
export type HumanOrderDecision = "ORDERED" | "HOLD" | "REJECTED";
export type SalesResult = "SUCCESS" | "NEUTRAL" | "FAIL" | "UNKNOWN";

export type SourcingInput = {
  mode: SourcingMode;
  koreanQuery: string;
  competitorUrl: string;
  targetPriceKrw: number;
  testBudgetKrw: number;
  forbiddenCategories: string[];
};

export type SourcingCostSettings = {
  exchangeRateKrwPerCny: number;
  testQuantity: number;
  internationalShippingFeeKrw: number;
  agentFeeRate: number;
};

export type SourcingCandidate = {
  id: string;
  url: string;
  imageUrl: string;
  titleCn: string;
  titleKr: string;
  unitPriceCny: number;
  moq: number;
  chinaShippingFeeCny: number;
  optionsText: string;
  shopName: string;
  notes: string;
};

export type CostEstimate = {
  productTotalKrw: number;
  chinaShippingKrw: number;
  agentFeeKrw: number;
  totalTestCostKrw: number;
  estimatedUnitCostKrw: number;
  estimatedMarginRate: number;
  costRatio: number;
  maxLossKrw: number;
  notice: string;
};

export type RiskCheck = {
  level: RiskLevel;
  tags: string[];
  reasons: string[];
};

export type CandidateScore = {
  candidateId: string;
  score: number;
  similarityScore: number;
  costScore: number;
  moqScore: number;
  optionScore: number;
  riskScore: number;
  supplyScore: number;
  reasons: string[];
};

export type RankedCandidate = {
  candidate: SourcingCandidate;
  risk: RiskCheck;
  cost: CostEstimate;
  score: CandidateScore;
};

export type RecommendationCard = {
  id: string;
  decision: SourcingDecision;
  decisionLabel: string;
  mode: SourcingMode;
  modeLabel: string;
  koreanProductName: string;
  shortDescription: string;
  searchTermsCn: string[];
  primary: RankedCandidate | null;
  backups: RankedCandidate[];
  recommendedOptions: string[];
  testQuantity: number;
  targetPriceKrw: number;
  estimatedTotalTestCostKrw: number;
  estimatedUnitCostKrw: number;
  estimatedMarginRate: number;
  maxLossKrw: number;
  riskLevel: RiskLevel;
  riskNotes: string[];
  recommendationReasons: string[];
  supplierQuestionsCn: string[];
  costNotice: string;
  createdAt: string;
};

export type SourcingFeedback = {
  cardId: string;
  mode: SourcingMode;
  categoryHint: string;
  humanOrderDecision: HumanOrderDecision;
  salesResult: SalesResult;
  reordered: boolean;
  failureReasons: string[];
  memo: string;
  createdAt: string;
};

export type SourcingMemorySegment = {
  segmentKey: string;
  total: number;
  success: number;
  neutral: number;
  fail: number;
  successRate: number;
};

const COST_NOTICE =
  "이 계산은 정밀 원가가 아니라 테스트 주문 판단용 추정치입니다. 관부가세, 플랫폼 수수료, 광고비, 반품비, 불량충당, 포장비는 반영되지 않았습니다.";

const HARD_BLOCK_RISK_RULES = [
  {
    tag: "어린이/유아",
    keywords: ["어린이", "유아", "아동", "키즈", "베이비", "아기", "儿童", "婴儿", "宝宝", "幼儿", "孩子"],
  },
  {
    tag: "의료/건강효능",
    keywords: [
      "의료",
      "의료기기",
      "치료",
      "교정",
      "통증",
      "혈압",
      "혈당",
      "재활",
      "건강효능",
      "마사지",
      "医疗",
      "治疗",
      "矫正",
      "康复",
      "血压",
      "血糖",
      "按摩",
    ],
  },
  {
    tag: "산업용 안전제품",
    keywords: [
      "안전모",
      "안전벨트",
      "보호안경",
      "방진",
      "방독",
      "추락방지",
      "보호구",
      "산업안전",
      "安全帽",
      "安全带",
      "护目镜",
      "防尘",
      "防毒",
      "劳保",
      "防护",
    ],
  },
  {
    tag: "전기/배터리/발열",
    keywords: [
      "전기",
      "충전",
      "배터리",
      "건전지",
      "발열",
      "히터",
      "온열",
      "전원",
      "usb",
      "led",
      "电",
      "充电",
      "电池",
      "发热",
      "加热",
      "取暖",
      "电源",
    ],
  },
  {
    tag: "식품/화장품/생활화학",
    keywords: [
      "식품",
      "먹는",
      "음료",
      "화장품",
      "크림",
      "로션",
      "세제",
      "스프레이",
      "탈취",
      "접착",
      "코팅",
      "소독",
      "살균",
      "食品",
      "饮料",
      "化妆品",
      "乳液",
      "喷雾",
      "清洁剂",
      "除臭",
      "胶水",
      "涂层",
      "消毒",
    ],
  },
  {
    tag: "상표/IP",
    keywords: [
      "디즈니",
      "마블",
      "포켓몬",
      "산리오",
      "카카오",
      "캐릭터",
      "브랜드",
      "로고",
      "정품",
      "同款",
      "迪士尼",
      "漫威",
      "宝可梦",
      "三丽鸥",
      "卡通",
      "品牌",
      "logo",
    ],
  },
  {
    tag: "파손 고위험",
    keywords: ["유리", "도자기", "거울", "글라스", "세라믹", "玻璃", "陶瓷", "镜子", "水晶"],
  },
];

const CAUTION_RISK_RULES = [
  {
    tag: "사이즈 민감",
    keywords: ["사이즈", "치수", "규격", "호환", "尺寸", "规格", "适用", "通用"],
  },
  {
    tag: "냄새/소재 민감",
    keywords: ["냄새", "실리콘", "고무", "가죽", "소재", "气味", "硅胶", "橡胶", "皮革", "材质"],
  },
  {
    tag: "옵션 복잡",
    keywords: ["세트", "조합", "랜덤", "옵션", "套装", "组合", "随机", "多规格"],
  },
];

const EXACT_QUERY_MAP: Record<string, string[]> = {
  "차량용 틈새 수납함": [
    "汽车缝隙收纳盒",
    "车载缝隙储物盒",
    "汽车座椅缝隙收纳",
    "车用置物盒",
  ],
  "차량용 수납": ["车载收纳盒", "汽车收纳盒", "车内置物盒", "汽车内饰收纳"],
  "캠핑 수납": ["露营收纳袋", "户外露营收纳箱", "野营收纳包", "折叠收纳箱"],
  "욕실 정리": ["浴室收纳架", "卫生间置物架", "浴室整理架", "免打孔收纳"],
  "사무실 소품": ["办公室桌面收纳", "办公用品收纳", "桌面置物架", "办公小物件"],
};

const TOKEN_QUERY_MAP: Record<string, string[]> = {
  차량: ["汽车", "车载"],
  자동차: ["汽车", "车载"],
  틈새: ["缝隙", "座椅缝隙"],
  수납: ["收纳", "储物", "置物"],
  정리: ["整理", "收纳"],
  캠핑: ["露营", "户外"],
  욕실: ["浴室", "卫生间"],
  주방: ["厨房"],
  사무실: ["办公室", "办公"],
  책상: ["桌面"],
  접이식: ["折叠"],
  파우치: ["收纳袋", "小包"],
  바구니: ["篮子", "收纳篮"],
  거치대: ["支架", "置物架"],
  후크: ["挂钩"],
  클립: ["夹子"],
  보관: ["收纳", "保存"],
  다용도: ["多功能"],
  휴대용: ["便携"],
  미끄럼방지: ["防滑"],
};

const MODE_LABELS: Record<SourcingMode, string> = {
  FOLLOW_PROVEN: "검증제품 저렴하게 따라팔기",
  DISCOVER_NEW: "유망 신규제품 먼저팔기",
};

const DECISION_LABELS: Record<SourcingDecision, string> = {
  ORDER_READY: "주문 가능",
  HOLD: "보류",
  REJECT: "폐기",
};

export function getSourcingModeLabel(mode: SourcingMode) {
  return MODE_LABELS[mode];
}

export function generateChineseSearchTerms(koreanQuery: string): string[] {
  const normalized = normalizeText(koreanQuery);
  const exactTerms = Object.entries(EXACT_QUERY_MAP)
    .filter(([key]) => normalized.includes(normalizeText(key)))
    .flatMap(([, terms]) => terms);

  const tokenTerms = Object.entries(TOKEN_QUERY_MAP)
    .filter(([key]) => normalized.includes(normalizeText(key)))
    .flatMap(([, terms]) => terms);

  const generated: string[] = [];
  for (const first of tokenTerms.slice(0, 4)) {
    for (const second of tokenTerms.slice(1, 6)) {
      if (first !== second) generated.push(`${first}${second}`);
    }
  }

  return uniqueList([...exactTerms, ...generated, ...tokenTerms]).slice(0, 10);
}

export function createEmptyCandidate(index: number): SourcingCandidate {
  return {
    id: `candidate-${index}`,
    url: "",
    imageUrl: "",
    titleCn: "",
    titleKr: "",
    unitPriceCny: 0,
    moq: 1,
    chinaShippingFeeCny: 0,
    optionsText: "",
    shopName: "",
    notes: "",
  };
}

export function isValid1688Url(url: string) {
  return /^https?:\/\/([^/]+\.)?1688\.com\/.+/i.test(url.trim());
}

export function checkCandidateRisk(
  input: SourcingInput,
  candidate: SourcingCandidate,
): RiskCheck {
  const text = normalizeText(
    [
      input.koreanQuery,
      candidate.titleCn,
      candidate.titleKr,
      candidate.optionsText,
      candidate.shopName,
      candidate.notes,
    ].join(" "),
  );

  const tags: string[] = [];
  const reasons: string[] = [];

  for (const rule of HARD_BLOCK_RISK_RULES) {
    if (rule.keywords.some((keyword) => text.includes(normalizeText(keyword)))) {
      tags.push(rule.tag);
      reasons.push(`${rule.tag} 위험 키워드 감지`);
    }
  }

  for (const forbidden of input.forbiddenCategories) {
    if (forbidden.trim() !== "" && text.includes(normalizeText(forbidden))) {
      tags.push(`금지:${forbidden}`);
      reasons.push(`사용자 금지 카테고리와 일치: ${forbidden}`);
    }
  }

  const cautionTags: string[] = [];
  for (const rule of CAUTION_RISK_RULES) {
    if (rule.keywords.some((keyword) => text.includes(normalizeText(keyword)))) {
      cautionTags.push(rule.tag);
    }
  }

  const blockedTags = uniqueList(tags);
  const cautionOnlyTags = uniqueList(cautionTags);

  if (blockedTags.length > 0) {
    return {
      level: "BLOCKED",
      tags: blockedTags,
      reasons,
    };
  }

  if (cautionOnlyTags.length >= 2) {
    return {
      level: "HOLD",
      tags: cautionOnlyTags,
      reasons: cautionOnlyTags.map((tag) => `${tag} 요소가 있어 주문 전 확인 필요`),
    };
  }

  if (cautionOnlyTags.length === 1) {
    return {
      level: "CAUTION",
      tags: cautionOnlyTags,
      reasons: [`${cautionOnlyTags[0]} 요소 확인 필요`],
    };
  }

  return {
    level: "LOW",
    tags: ["일반 공산품 후보"],
    reasons: ["MVP 위험 필터 기준상 즉시 차단 요소 없음"],
  };
}

export function estimateCandidateCost(
  input: SourcingInput,
  settings: SourcingCostSettings,
  candidate: SourcingCandidate,
): CostEstimate {
  const quantity = Math.max(1, settings.testQuantity);
  const exchangeRate = Math.max(0, settings.exchangeRateKrwPerCny);
  const unitPriceCny = Math.max(0, candidate.unitPriceCny);
  const chinaShippingFeeCny = Math.max(0, candidate.chinaShippingFeeCny);
  const internationalShippingFeeKrw = Math.max(0, settings.internationalShippingFeeKrw);
  const agentFeeRate = Math.max(0, settings.agentFeeRate) / 100;
  const targetPriceKrw = Math.max(0, input.targetPriceKrw);

  const productTotalKrw = Math.round(unitPriceCny * quantity * exchangeRate);
  const chinaShippingKrw = Math.round(chinaShippingFeeCny * exchangeRate);
  const agentFeeKrw = Math.round((productTotalKrw + chinaShippingKrw) * agentFeeRate);
  const totalTestCostKrw =
    productTotalKrw + chinaShippingKrw + internationalShippingFeeKrw + agentFeeKrw;
  const estimatedUnitCostKrw = Math.ceil(totalTestCostKrw / quantity);
  const estimatedMarginRate =
    targetPriceKrw > 0 ? (targetPriceKrw - estimatedUnitCostKrw) / targetPriceKrw : 0;
  const costRatio =
    targetPriceKrw > 0 ? estimatedUnitCostKrw / targetPriceKrw : Number.POSITIVE_INFINITY;

  return {
    productTotalKrw,
    chinaShippingKrw,
    agentFeeKrw,
    totalTestCostKrw,
    estimatedUnitCostKrw,
    estimatedMarginRate,
    costRatio,
    maxLossKrw: totalTestCostKrw,
    notice: COST_NOTICE,
  };
}

export function scoreCandidate(
  input: SourcingInput,
  candidate: SourcingCandidate,
  allCandidates: SourcingCandidate[],
  risk: RiskCheck,
  cost: CostEstimate,
  searchTermsCn: string[],
): CandidateScore {
  const similarityScore = calculateSimilarityScore(input, candidate, searchTermsCn);
  const costScore = calculateCostScore(cost.costRatio);
  const moqScore = calculateMoqScore(candidate.moq, input.testBudgetKrw, cost.totalTestCostKrw);
  const optionScore = calculateOptionScore(candidate.optionsText);
  const riskScore = calculateRiskScore(risk.level);
  const supplyScore = calculateSupplyScore(candidate, allCandidates);

  const baseScore =
    input.mode === "FOLLOW_PROVEN"
      ? similarityScore * 0.3 +
        costScore * 0.25 +
        moqScore * 0.15 +
        optionScore * 0.1 +
        riskScore * 0.1 +
        supplyScore * 0.1
      : similarityScore * 0.18 +
        costScore * 0.25 +
        moqScore * 0.15 +
        optionScore * 0.1 +
        riskScore * 0.17 +
        supplyScore * 0.15;

  const penalties =
    risk.level === "BLOCKED"
      ? 100
      : candidate.unitPriceCny <= 0
        ? 35
        : !isValid1688Url(candidate.url)
          ? 25
          : 0;

  const score = Math.max(0, Math.round(baseScore - penalties));

  return {
    candidateId: candidate.id,
    score,
    similarityScore: Math.round(similarityScore),
    costScore: Math.round(costScore),
    moqScore: Math.round(moqScore),
    optionScore: Math.round(optionScore),
    riskScore: Math.round(riskScore),
    supplyScore: Math.round(supplyScore),
    reasons: buildScoreReasons(candidate, risk, cost, score),
  };
}

export function buildRecommendationCard({
  input,
  settings,
  candidates,
}: {
  input: SourcingInput;
  settings: SourcingCostSettings;
  candidates: SourcingCandidate[];
}): RecommendationCard {
  const now = new Date().toISOString();
  const searchTermsCn = generateChineseSearchTerms(input.koreanQuery);
  const normalizedCandidates = candidates.filter((candidate) => candidate.url.trim() !== "");

  const ranked = normalizedCandidates
    .map((candidate) => {
      const risk = checkCandidateRisk(input, candidate);
      const cost = estimateCandidateCost(input, settings, candidate);
      const score = scoreCandidate(input, candidate, normalizedCandidates, risk, cost, searchTermsCn);
      return { candidate, risk, cost, score };
    })
    .sort((a, b) => b.score.score - a.score.score);

  const eligible = ranked.filter(
    (item) =>
      item.risk.level !== "BLOCKED" &&
      isValid1688Url(item.candidate.url) &&
      item.candidate.unitPriceCny > 0 &&
      item.candidate.moq <= settings.testQuantity,
  );

  const primary = eligible[0] ?? null;
  const backups = eligible
    .filter((item) => item.candidate.id !== primary?.candidate.id)
    .slice(0, 2);

  const decision = decideRecommendation({
    input,
    settings,
    candidateCount: normalizedCandidates.length,
    primary,
    backupCount: backups.length,
  });

  const recommendedOptions = getRecommendedOptions(primary?.candidate.optionsText ?? "").slice(0, 4);
  const riskNotes = primary
    ? uniqueList([...primary.risk.reasons, ...buildOperationalRiskNotes(primary.candidate)])
    : ["추천 가능한 1688 후보가 부족합니다."];
  const recommendationReasons = buildRecommendationReasons({
    input,
    primary,
    candidateCount: normalizedCandidates.length,
    backupCount: backups.length,
    decision,
  });

  return {
    id: `sourcing-card-${Date.now()}`,
    decision,
    decisionLabel: DECISION_LABELS[decision],
    mode: input.mode,
    modeLabel: MODE_LABELS[input.mode],
    koreanProductName: buildKoreanProductName(input, primary?.candidate),
    shortDescription: buildShortDescription(input, primary, decision),
    searchTermsCn,
    primary,
    backups,
    recommendedOptions,
    testQuantity: settings.testQuantity,
    targetPriceKrw: input.targetPriceKrw,
    estimatedTotalTestCostKrw: primary?.cost.totalTestCostKrw ?? 0,
    estimatedUnitCostKrw: primary?.cost.estimatedUnitCostKrw ?? 0,
    estimatedMarginRate: primary?.cost.estimatedMarginRate ?? 0,
    maxLossKrw: primary?.cost.maxLossKrw ?? 0,
    riskLevel: primary?.risk.level ?? "HOLD",
    riskNotes,
    recommendationReasons,
    supplierQuestionsCn: buildSupplierQuestionsCn(primary?.candidate),
    costNotice: COST_NOTICE,
    createdAt: now,
  };
}

export function summarizeSourcingMemory(feedbackList: SourcingFeedback[]): SourcingMemorySegment[] {
  const segments = new Map<string, SourcingMemorySegment>();

  function add(segmentKey: string, feedback: SourcingFeedback) {
    const current =
      segments.get(segmentKey) ??
      ({
        segmentKey,
        total: 0,
        success: 0,
        neutral: 0,
        fail: 0,
        successRate: 0,
      } satisfies SourcingMemorySegment);

    current.total += 1;
    if (feedback.salesResult === "SUCCESS") current.success += 1;
    if (feedback.salesResult === "NEUTRAL") current.neutral += 1;
    if (feedback.salesResult === "FAIL") current.fail += 1;
    current.successRate = current.total > 0 ? current.success / current.total : 0;

    segments.set(segmentKey, current);
  }

  for (const feedback of feedbackList) {
    add(`mode:${MODE_LABELS[feedback.mode]}`, feedback);
    if (feedback.categoryHint.trim() !== "") {
      add(`category:${feedback.categoryHint.trim()}`, feedback);
    }
    for (const reason of feedback.failureReasons) {
      add(`failure:${reason}`, feedback);
    }
  }

  return [...segments.values()].sort((a, b) => b.total - a.total || b.successRate - a.successRate);
}

function decideRecommendation({
  input,
  settings,
  candidateCount,
  primary,
  backupCount,
}: {
  input: SourcingInput;
  settings: SourcingCostSettings;
  candidateCount: number;
  primary: RankedCandidate | null;
  backupCount: number;
}): SourcingDecision {
  if (!primary) return candidateCount > 0 ? "HOLD" : "REJECT";
  if (primary.risk.level === "BLOCKED") return "REJECT";
  if (primary.risk.level === "HOLD") return "HOLD";
  if (primary.cost.costRatio > 0.6) return "REJECT";
  if (primary.cost.totalTestCostKrw > input.testBudgetKrw * 1.3) return "REJECT";
  if (primary.cost.totalTestCostKrw > input.testBudgetKrw) return "HOLD";
  if (primary.cost.costRatio > 0.45) return "HOLD";
  if (candidateCount < 3 || backupCount < 2) return "HOLD";
  if (settings.testQuantity < primary.candidate.moq) return "HOLD";
  if (primary.score.score < 60) return "HOLD";
  return "ORDER_READY";
}

function calculateSimilarityScore(
  input: SourcingInput,
  candidate: SourcingCandidate,
  searchTermsCn: string[],
) {
  const candidateText = normalizeText(
    [candidate.titleCn, candidate.titleKr, candidate.optionsText, candidate.notes].join(" "),
  );
  const koreanTokens = tokenize(input.koreanQuery);
  const koreanMatches = koreanTokens.filter((token) => candidateText.includes(normalizeText(token))).length;
  const chineseMatches = searchTermsCn.filter((term) => candidateText.includes(normalizeText(term))).length;
  const koreanRatio = koreanTokens.length > 0 ? koreanMatches / koreanTokens.length : 0;
  const chineseRatio = searchTermsCn.length > 0 ? chineseMatches / Math.min(4, searchTermsCn.length) : 0;
  return clampScore((koreanRatio * 55 + chineseRatio * 45) * 1.2);
}

function calculateCostScore(costRatio: number) {
  if (!Number.isFinite(costRatio)) return 0;
  if (costRatio <= 0.3) return 100;
  if (costRatio <= 0.35) return 90;
  if (costRatio <= 0.45) return 75;
  if (costRatio <= 0.6) return 45;
  return 10;
}

function calculateMoqScore(moq: number, testBudgetKrw: number, totalTestCostKrw: number) {
  const budgetScore = totalTestCostKrw <= testBudgetKrw ? 50 : totalTestCostKrw <= testBudgetKrw * 1.2 ? 25 : 0;
  const moqScore = moq <= 2 ? 50 : moq <= 10 ? 40 : moq <= 50 ? 25 : 5;
  return budgetScore + moqScore;
}

function calculateOptionScore(optionsText: string) {
  const options = getRecommendedOptions(optionsText);
  if (options.length <= 2) return 100;
  if (options.length <= 4) return 80;
  if (options.length <= 8) return 45;
  return 20;
}

function calculateRiskScore(level: RiskLevel) {
  if (level === "LOW") return 100;
  if (level === "CAUTION") return 70;
  if (level === "HOLD") return 25;
  return 0;
}

function calculateSupplyScore(candidate: SourcingCandidate, allCandidates: SourcingCandidate[]) {
  const hasBackups = allCandidates.length >= 3 ? 35 : allCandidates.length === 2 ? 20 : 5;
  const shopScore = candidate.shopName.trim() !== "" ? 25 : 10;
  const imageScore = candidate.imageUrl.trim() !== "" ? 20 : 5;
  const urlScore = isValid1688Url(candidate.url) ? 20 : 0;
  return hasBackups + shopScore + imageScore + urlScore;
}

function buildScoreReasons(
  candidate: SourcingCandidate,
  risk: RiskCheck,
  cost: CostEstimate,
  score: number,
) {
  const reasons: string[] = [];
  if (score >= 70) reasons.push("주문추천 점수 70점 이상");
  if (cost.costRatio <= 0.45) reasons.push("목표 판매가 대비 테스트 원가율 45% 이하");
  if (candidate.moq <= 10) reasons.push("MOQ가 낮아 소량 테스트 적합");
  if (risk.level === "LOW") reasons.push("위험 필터 기준 LOW");
  if (candidate.imageUrl.trim() !== "") reasons.push("이미지 확인 가능");
  if (risk.level !== "LOW") reasons.push(...risk.reasons);
  return uniqueList(reasons);
}

function buildRecommendationReasons({
  input,
  primary,
  candidateCount,
  backupCount,
  decision,
}: {
  input: SourcingInput;
  primary: RankedCandidate | null;
  candidateCount: number;
  backupCount: number;
  decision: SourcingDecision;
}) {
  if (!primary) {
    return ["후보 링크가 없거나 주문 판단에 필요한 가격/MOQ 데이터가 부족합니다."];
  }

  const reasons = [
    `${candidateCount}개의 실제 1688 후보 링크 안에서만 판단했습니다.`,
    `1순위 후보 점수: ${primary.score.score}점`,
    `위험 등급: ${primary.risk.level}`,
  ];

  if (backupCount >= 2) reasons.push("백업 공급처 2개 확보");
  if (input.mode === "FOLLOW_PROVEN") {
    reasons.push("기존 판매상품 유사도와 원가 우위를 우선 평가했습니다.");
  } else {
    reasons.push("신규제품 테스트 적합성과 위험 리스크를 우선 평가했습니다.");
  }
  if (decision !== "ORDER_READY") {
    reasons.push("MVP 기준상 즉시 주문보다 추가 확인이 필요합니다.");
  }

  return reasons;
}

function buildOperationalRiskNotes(candidate: SourcingCandidate) {
  const notes = ["실제 재고, 발송일, 포장상태 확인 필요"];
  const optionCount = getRecommendedOptions(candidate.optionsText).length;
  if (optionCount > 4) notes.push("옵션 수가 많아 CS/오발주 리스크 확인 필요");
  if (candidate.imageUrl.trim() === "") notes.push("대표 이미지가 없어 실제 상품 외형 확인 필요");
  if (candidate.notes.trim() !== "") notes.push(candidate.notes.trim());
  return notes;
}

function buildKoreanProductName(input: SourcingInput, candidate?: SourcingCandidate) {
  if (candidate?.titleKr.trim()) return candidate.titleKr.trim();
  return input.koreanQuery.trim() || "1688 소싱 후보";
}

function buildShortDescription(
  input: SourcingInput,
  primary: RankedCandidate | null,
  decision: SourcingDecision,
) {
  if (!primary) {
    return "실제 수집된 1688 후보가 부족해 주문추천 카드가 보류/폐기 상태입니다.";
  }

  const modeText =
    input.mode === "FOLLOW_PROVEN"
      ? "기존 판매상품을 더 낮은 원가로 따라팔기 위한 후보입니다."
      : "신규 테스트 소싱을 위한 후보입니다.";
  const decisionText =
    decision === "ORDER_READY"
      ? "현재 입력값 기준으로 소량 테스트 주문 가능 후보입니다."
      : decision === "HOLD"
        ? "주문 전 추가 확인이 필요한 보류 후보입니다."
        : "현재 기준에서는 폐기하는 편이 안전한 후보입니다.";

  return `${modeText} ${decisionText}`;
}

function buildSupplierQuestionsCn(candidate?: SourcingCandidate) {
  const questions = [
    "请确认是否现货。",
    "请确认产品尺寸和包装尺寸。",
    "请确认是否支持小批量采购。",
    "请确认发货时间。",
  ];

  const options = getRecommendedOptions(candidate?.optionsText ?? "");
  if (options.length > 0) {
    questions.splice(1, 0, `请确认这些选项是否有库存：${options.slice(0, 4).join("，")}。`);
  }

  return questions;
}

function getRecommendedOptions(optionsText: string) {
  return uniqueList(
    optionsText
      .split(/[\n,，/]+/)
      .map((option) => option.trim())
      .filter(Boolean),
  );
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, "");
}

function tokenize(value: string) {
  return value
    .split(/[\s,，/·ㆍ|]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function uniqueList<T>(items: T[]) {
  return [...new Set(items)];
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, value));
}
