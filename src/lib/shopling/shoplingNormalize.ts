export type ShoplingRawRow = Record<string, unknown>;

export type ShoplingClaimCategory =
  | "상품 문제"
  | "옵션·교환"
  | "구매자 변심"
  | "출고 전 취소"
  | "미분류";

const CLAIM_RULES: Array<{
  category: ShoplingClaimCategory;
  severityWeight: number;
  keywords: string[];
}> = [
  {
    category: "상품 문제",
    severityWeight: 1,
    keywords: [
      "불량",
      "파손",
      "오배송",
      "누락",
      "훼손",
      "작동",
      "고장",
      "깨짐",
      "구성품",
      "품질",
      "변질",
      "다른 상품",
      "수량 부족",
    ],
  },
  {
    category: "옵션·교환",
    severityWeight: 0.7,
    keywords: ["옵션", "사이즈", "색상", "교환", "규격", "크기"],
  },
  {
    category: "구매자 변심",
    severityWeight: 0.3,
    keywords: [
      "단순 변심",
      "마음",
      "필요 없",
      "잘못 주문",
      "중복 주문",
      "구매 의사",
    ],
  },
  {
    category: "출고 전 취소",
    severityWeight: 0.15,
    keywords: ["출고 전", "배송 전", "결제 취소", "주문 취소"],
  },
];

function pick(row: ShoplingRawRow, keys: string[]) {
  for (const key of keys) {
    const direct = row[key];
    if (direct !== undefined && direct !== null && direct !== "") {
      return String(direct);
    }
    const match = Object.keys(row).find(
      (candidate) => candidate.toLowerCase() === key.toLowerCase(),
    );
    if (
      match &&
      row[match] !== undefined &&
      row[match] !== null &&
      row[match] !== ""
    ) {
      return String(row[match]);
    }
  }
  return "";
}

function cleanCode(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[‐‑‒–—―−]/g, "-")
    .trim();
}

export function normalizeShoplingBarcode(value: unknown) {
  return cleanCode(String(value ?? ""))
    .toUpperCase()
    .replace(/\s+/g, "");
}

function managedBarcode(value: string) {
  const normalized = normalizeShoplingBarcode(value);
  return /^[A-Z]{3}\d+-\d+$/.test(normalized) ? normalized : "";
}

function numeric(value: string) {
  const parsed = Number(value.replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateTime(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length >= 8) {
    const year = digits.slice(0, 4);
    const month = digits.slice(4, 6);
    const day = digits.slice(6, 8);
    const hour = digits.slice(8, 10) || "00";
    const minute = digits.slice(10, 12) || "00";
    const second = digits.slice(12, 14) || "00";
    return `${year}-${month}-${day}T${hour}:${minute}:${second}+09:00`;
  }
  return value;
}

function seasonal(value: string) {
  const normalized = value.trim();
  return ["봄", "여름", "가을", "겨울"].some((season) =>
    normalized.includes(season),
  );
}

function activeOption(optionStatus: string, saleStatus: string) {
  const option = optionStatus.trim().toUpperCase();
  const product = saleStatus.trim().toUpperCase();
  const optionActive = !option || option === "B";
  const productActive = !product || product === "B";
  return optionActive && productActive;
}

export function classifyShoplingClaim(reason?: string, content?: string) {
  const source = `${reason ?? ""} ${content ?? ""}`.toLowerCase();
  for (const rule of CLAIM_RULES) {
    if (
      rule.keywords.some((keyword) =>
        source.includes(keyword.toLowerCase()),
      )
    ) {
      return {
        category: rule.category,
        severityWeight: rule.severityWeight,
      };
    }
  }
  return { category: "미분류" as const, severityWeight: 0.5 };
}

export function normalizeShoplingProduct(row: ShoplingRawRow) {
  const goodsKey = cleanCode(pick(row, ["goods_key", "goodsKey"]));
  const partnerOptionCode = cleanCode(
    pick(row, [
      "optPtnOptCd",
      "opt_ptn_opt_cd",
      "ptn_opt_cd",
      "mall_ptn_opt_cd",
    ]),
  );
  const optionBarcode = managedBarcode(
    pick(row, ["optBarcode", "opt_barcode", "barcode"]),
  );
  const optionStatus = pick(row, ["optStatus", "opt_status"]);
  const saleStatus = pick(row, ["sale_status", "saleStatus"]);
  return {
    barcode: optionBarcode,
    optionId: cleanCode(pick(row, ["optId", "opt_id", "option_id"])),
    productId:
      cleanCode(pick(row, ["prod_id", "prodId", "product_id"])) ||
      goodsKey,
    goodsKey,
    partnerOptionCode,
    productName: pick(row, [
      "prod_nm",
      "goods_nm",
      "product_name",
      "goods_name",
    ]).trim(),
    optionName: pick(row, [
      "optionName",
      "opt_nm",
      "option_name",
      "optName",
    ]).trim(),
    unitCost: numeric(pick(row, ["org_price", "unit_cost"])),
    modelNo: cleanCode(pick(row, ["model_no", "modelNo"])),
    isSeasonal: seasonal(pick(row, ["season_tp", "season"])),
    isActive: activeOption(optionStatus, saleStatus),
    raw: row,
  };
}

export function normalizeShoplingOrder(row: ShoplingRawRow) {
  const orderNo = cleanCode(pick(row, ["ord_no", "order_no"]));
  const optionId = cleanCode(pick(row, ["opt_id", "optId", "option_id"]));
  const quantity = numeric(pick(row, ["mall_ord_cnt", "quantity"]));
  const unitPrice = numeric(
    pick(row, ["mall_unit_price", "unit_price"]),
  );
  const calculatedLineAmount = unitPrice * quantity;
  return {
    id: `${orderNo}:${
      optionId ||
      cleanCode(pick(row, ["prod_id", "mall_prod_key"])) ||
      "unknown"
    }:${cleanCode(pick(row, ["mall_ord_seq", "seq"])) || "0"}`,
    orderNo,
    optionId,
    productId:
      cleanCode(pick(row, ["prod_id", "prodId", "product_id"])) ||
      null,
    mallProductKey:
      cleanCode(pick(row, ["mall_prod_key", "mallProductKey"])) ||
      null,
    barcode: managedBarcode(
      pick(row, [
        "optPtnOptCd",
        "opt_ptn_opt_cd",
        "ptn_opt_cd",
        "mall_ptn_opt_cd",
        "mall_opt_cd",
        "optBarcode",
        "opt_barcode",
        "barcode",
      ]),
    ),
    orderedAt: dateTime(
      pick(row, ["mall_ord_dt", "ordered_at", "i_dt"]),
    ),
    paidAt: pick(row, ["mall_pay_dt", "paid_at"])
      ? dateTime(pick(row, ["mall_pay_dt", "paid_at"]))
      : null,
    status: pick(row, ["ord_status", "order_status"]),
    quantity,
    unitPrice,
    paidAmount:
      calculatedLineAmount > 0
        ? calculatedLineAmount
        : numeric(pick(row, ["mall_pay_amt", "paid_amount"])),
    adjustmentAmount: numeric(
      pick(row, ["djustment_amt", "adjustment_amount"]),
    ),
    originalPrice: numeric(
      pick(row, ["org_price", "original_price"]),
    ),
    raw: row,
  };
}

export function normalizeShoplingClaim(row: ShoplingRawRow) {
  const reason =
    pick(row, ["mall_claim_rsn", "claim_reason"]) || "사유 없음";
  const reasonDetail = pick(row, [
    "mall_claim_rsn2",
    "claim_reason_detail",
  ]);
  const content = pick(row, ["mall_claim_cnts", "claim_content"]);
  const classification = classifyShoplingClaim(
    `${reason} ${reasonDetail}`,
    content,
  );

  return {
    claimKey: cleanCode(pick(row, ["claim_key", "claimKey"])),
    barcode: managedBarcode(
      pick(row, [
        "optPtnOptCd",
        "opt_ptn_opt_cd",
        "ptn_opt_cd",
        "mall_ptn_opt_cd",
        "mall_opt_cd",
        "optBarcode",
        "opt_barcode",
        "barcode",
      ]),
    ),
    optionId:
      cleanCode(pick(row, ["opt_id", "optId", "option_id"])) || null,
    productId:
      cleanCode(pick(row, ["prod_id", "prodId", "product_id"])) ||
      null,
    mallProductKey:
      cleanCode(pick(row, ["mall_prod_key", "mallProductKey"])) ||
      null,
    orderNo: cleanCode(pick(row, ["ord_no", "order_no"])) || null,
    mallOrderId:
      cleanCode(pick(row, ["mall_ord_id", "mall_order_id"])) || null,
    claimType: pick(row, ["mall_claim_tp", "claim_type"]) || "기타",
    claimStatus: pick(row, ["claim_status"]) || null,
    orderStatus: pick(row, ["ord_status", "order_status"]) || null,
    reasonCategory: classification.category,
    reason: reasonDetail ? `${reason} · ${reasonDetail}` : reason,
    content: content || null,
    quantity: numeric(pick(row, ["claim_qty", "qty"])),
    severityWeight: classification.severityWeight,
    claimedAt: dateTime(pick(row, ["i_dt", "claimed_at"])),
    raw: row,
  };
}
