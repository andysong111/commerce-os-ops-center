export type TossCompatibleOptionRow = {
  optionName?: unknown;
  saleOption?: unknown;
};

export type TossOptionNormalizationSource =
  | "single"
  | "explicit"
  | "inferred";

export type TossOptionNormalizationResult<T extends TossCompatibleOptionRow> = {
  optionName: string;
  source: TossOptionNormalizationSource;
  rows: Array<T & { optionName: string; saleOption: string }>;
};

const GENERIC_OPTION_NAMES = new Set([
  "",
  "옵션",
  "구성",
  "선택",
  "선택옵션",
  "상품옵션",
]);

const EXPLICIT_OPTION_ALIASES = new Map<string, string>([
  ["색상", "색상"],
  ["컬러", "색상"],
  ["color", "색상"],
  ["사이즈", "사이즈"],
  ["크기", "사이즈"],
  ["size", "사이즈"],
  ["수량", "수량"],
  ["개수", "수량"],
  ["quantity", "수량"],
  ["길이", "길이"],
  ["length", "길이"],
  ["용량", "용량"],
  ["volume", "용량"],
  ["재질", "재질"],
  ["소재", "재질"],
  ["material", "재질"],
  ["규격", "규격"],
  ["기종", "기종"],
  ["모델", "기종"],
]);

const COLOR_WORDS = [
  "블랙",
  "화이트",
  "그레이",
  "회색",
  "베이지",
  "브라운",
  "핑크",
  "레드",
  "오렌지",
  "옐로우",
  "그린",
  "민트",
  "블루",
  "네이비",
  "퍼플",
  "카키",
  "골드",
  "실버",
  "라임",
  "스카이",
  "아이보리",
  "빨간색",
  "파란색",
  "검은색",
  "노란색",
  "색상랜덤",
  "랜덤색상",
];

const QUANTITY_RE = /(?:^|\s)(?:\d+\s*(?:개입|개|p|pcs?|쌍|매|장|세트|팩|롤|병|자루)|\d+\s*\+\s*\d+)(?:\s|$)/i;
const PURE_QUANTITY_RE = /^(?:\d+\s*(?:개입|개|p|pcs?|쌍|매|장|세트|팩|롤|병|자루)|\d+\s*\+\s*\d+)$/i;
const SIZE_WORD_RE = /(?:^|\s)(?:xxxs|xxs|xs|s|m|l|xl|xxl|xxxl|free|프리|소형|중형|대형|특대|소|중|대)(?:사이즈)?(?:\s|$)/i;
const DIMENSION_RE = /^\d+(?:\.\d+)?\s*(?:x|×)\s*\d+(?:\.\d+)?(?:\s*(?:x|×)\s*\d+(?:\.\d+)?)?\s*(?:mm|cm|m)?$/i;
const SHOE_SIZE_RE = /(?:^|\s)\d{2,3}\s*[-~]\s*\d{2,3}(?:\s|$)/;
const LENGTH_RE = /\d+(?:\.\d+)?\s*(?:mm|cm|미터|m)(?:\s|$)/i;
const VOLUME_RE = /\d+(?:\.\d+)?\s*(?:ml|l|리터)(?:\s|$)/i;
const DEVICE_RE = /^(?:ps\s*[345]|xbox(?:\s*one|\s*series\s*[sx])?|switch|닌텐도\s*스위치|아이폰\s*\d+.*|galaxy\s*[a-z0-9+-]+)$/i;

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function normalizedKey(value: unknown) {
  return text(value).toLowerCase().replace(/\s+/g, "");
}

function canonicalExplicitOptionName(value: unknown) {
  const raw = text(value);
  const key = normalizedKey(raw);
  if (GENERIC_OPTION_NAMES.has(key)) return "";
  return EXPLICIT_OPTION_ALIASES.get(key) ?? raw;
}

function splitPrefixedSaleOption(value: unknown) {
  const raw = text(value);
  const match = raw.match(/^([^:：]{1,16})\s*[:：]\s*(.+)$/);
  if (!match) return { explicitOptionName: "", saleOption: raw };
  const label = canonicalExplicitOptionName(match[1]);
  return {
    explicitOptionName: label,
    saleOption: text(match[2]),
  };
}

function includesColor(value: string) {
  const compact = value.toLowerCase().replace(/\s+/g, "");
  return COLOR_WORDS.some((word) => compact.includes(word.toLowerCase()));
}

function looksLikeSize(value: string) {
  const compact = value.trim();
  return (
    SIZE_WORD_RE.test(` ${compact} `) ||
    /^(?:xxxs|xxs|xs|s|m|l|xl|xxl|xxxl)(?:사이즈)?$/i.test(compact) ||
    /^(?:소형|중형|대형|특대)$/i.test(compact) ||
    DIMENSION_RE.test(compact) ||
    SHOE_SIZE_RE.test(` ${compact} `)
  );
}

function inferOptionName(values: string[], context: string) {
  const normalizedContext = text(context).toLowerCase();
  const colorCount = values.filter(includesColor).length;
  const sizeCount = values.filter(looksLikeSize).length;
  const quantityCount = values.filter((value) => QUANTITY_RE.test(` ${value} `)).length;
  const pureQuantityCount = values.filter((value) => PURE_QUANTITY_RE.test(value)).length;
  const lengthCount = values.filter((value) => LENGTH_RE.test(value)).length;
  const volumeCount = values.filter((value) => VOLUME_RE.test(value)).length;
  const deviceCount = values.filter((value) => DEVICE_RE.test(value)).length;

  if (values.every((value) => value === "단품")) return "단품";
  if (volumeCount === values.length && values.length > 0) return "용량";
  if (deviceCount === values.length && values.length > 0) return "기종";

  if (
    sizeCount === values.length &&
    values.length > 0 &&
    !normalizedContext.includes("길이")
  ) {
    return "사이즈";
  }
  if (
    lengthCount === values.length &&
    values.length > 0 &&
    (normalizedContext.includes("길이") ||
      normalizedContext.includes("줄자") ||
      normalizedContext.includes("미터"))
  ) {
    return "길이";
  }
  if (pureQuantityCount === values.length && values.length > 0) return "수량";

  // A color family may contain seller-specific shade names such as "밀크티".
  // Infer color only when there is strong evidence and no competing size/quantity signal.
  if (
    colorCount >= Math.min(2, values.length) &&
    sizeCount === 0 &&
    pureQuantityCount === 0
  ) {
    return "색상";
  }
  if (values.length === 1 && colorCount === 1 && sizeCount === 0) return "색상";

  // Combined values such as "핑크 38-39" cannot be split safely in the current
  // single-dimension Shopling uploader. Prefer the purchase-critical size title
  // instead of sending the rejected generic title "옵션".
  if (sizeCount === values.length && colorCount > 0) return "사이즈";

  if (
    quantityCount === values.length &&
    values.length > 0 &&
    (normalizedContext.includes("수량") ||
      normalizedContext.includes("개입") ||
      normalizedContext.includes("세트"))
  ) {
    return "수량";
  }

  if (normalizedContext.includes("색상") && colorCount > 0) return "색상";
  if (normalizedContext.includes("사이즈") && sizeCount > 0) return "사이즈";
  if (normalizedContext.includes("용량") && volumeCount > 0) return "용량";
  return "";
}

export function normalizeTossCompatibleOptionRows<T extends TossCompatibleOptionRow>(
  inputRows: readonly T[],
  context = "",
): TossOptionNormalizationResult<T> {
  if (!inputRows.length) {
    throw new Error("토스 호환 옵션으로 변환할 옵션이 없습니다.");
  }

  const parsedRows = inputRows.map((row) => {
    const parsedSaleOption = splitPrefixedSaleOption(row.saleOption);
    const rowOptionName = canonicalExplicitOptionName(row.optionName);
    const explicitOptionName = parsedSaleOption.explicitOptionName || rowOptionName;
    const saleOption = parsedSaleOption.saleOption;
    if (!saleOption) {
      throw new Error("토스 호환 옵션값이 비어 있습니다.");
    }
    return { row, explicitOptionName, saleOption };
  });

  const explicitOptionNames = new Set(
    parsedRows.map((row) => row.explicitOptionName).filter(Boolean),
  );
  if (explicitOptionNames.size > 1) {
    throw new Error(
      `한 상품에 서로 다른 옵션명이 섞여 있습니다: ${[...explicitOptionNames].join(", ")}`,
    );
  }

  const saleOptions = parsedRows.map((row) => row.saleOption);
  let optionName = explicitOptionNames.size === 1
    ? [...explicitOptionNames][0]
    : inferOptionName(saleOptions, context);
  let source: TossOptionNormalizationSource = explicitOptionNames.size === 1
    ? "explicit"
    : "inferred";

  if (saleOptions.length === 1 && saleOptions[0] === "단품") {
    optionName = "단품";
    source = "single";
  }

  if (!optionName) {
    throw new Error(
      `토스 호환 옵션명을 자동 확정할 수 없습니다. 현재 옵션값: ${saleOptions.join(" / ")}. ` +
        "색상·사이즈·수량 등 실제 구매 기준을 옵션명으로 지정해야 합니다.",
    );
  }

  const seenValues = new Set<string>();
  for (const value of saleOptions) {
    const comparable = normalizedKey(value);
    if (seenValues.has(comparable)) {
      throw new Error(`동일한 옵션값이 중복되었습니다: ${value}`);
    }
    seenValues.add(comparable);
  }

  if (optionName === "단품" && saleOptions.length !== 1) {
    throw new Error("단품 옵션은 하나의 SKU에서만 사용할 수 있습니다.");
  }

  return {
    optionName,
    source,
    rows: parsedRows.map(({ row, saleOption }) => ({
      ...row,
      optionName,
      saleOption,
    })),
  };
}
