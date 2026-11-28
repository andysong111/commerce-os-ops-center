import { normalizeShoplingBcode } from "./shopling/shoplingBcodeIndexCore.ts";

export const restockTemplate =
  "요청하신 상품이 입고되었습니다.\n{상품}\n도소매사우루스에서 주문하실 수 있습니다.";
export const operatorTestMessage =
  "[도소매사우루스] 입고알림 시험 문자입니다. 정상 수신을 확인해 주세요.";
export const statusLabels: Record<string, string> = {
  WAITING: "입고·판매중 전환 대기",
  READY: "구매 가능 확인 대기",
  SENDING: "발송 결과 조회 중",
  REVIEW: "발송내역 확인 필요",
  SENT: "발송 성공",
  CANCELED: "신청 취소",
};
export type RestockDetails = {
  includeLowestOffer?: true;
  body: string;
  storeUrl: string;
  marketName: string;
  marketUrl: string;
  marketItem: string;
  promotion: boolean;
  ownPrice: number;
  marketPrice: number;
  comparedAt: string;
};
export const blankRestock: RestockDetails = {
  body: restockTemplate,
  storeUrl: "",
  marketName: "",
  marketUrl: "",
  marketItem: "",
  promotion: false,
  ownPrice: 0,
  marketPrice: 0,
  comparedAt: "",
};
export class RestockInputError extends Error {}
function invalid(message: string): never {
  throw new RestockInputError(message);
}
export function restockPhone(value: unknown) {
  const number = String(value ?? "")
    .trim()
    .replace(/[-()\s]/g, "");
  return /^010\d{8}$/.test(number)
    ? number
    : invalid("고객 휴대폰 번호 11자리를 확인해 주세요.");
}
function limited(value: unknown, limit: number, multiline = false) {
  const result = String(value ?? "")
    .trim()
    .replace(/\r\n?/g, "\n");
  if (
    result.length > limit ||
    /[\u0000-\u0008\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(
      result,
    ) ||
    (!multiline && result.includes("\n"))
  )
    invalid("입력 길이와 줄바꿈을 확인해 주세요.");
  return result;
}
export function storeProductNumber(value: string) {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return "";
  }
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.port ||
    ![
      "dosomesaurus.com",
      "www.dosomesaurus.com",
      "m.dosomesaurus.com",
      "andy801.cafe24.com",
    ].includes(u.hostname)
  )
    return "";
  const product = /^\/(?:shop\d+\/)?product\/detail\.html\/?$/.test(u.pathname)
    ? u.searchParams.get("product_no")
    : u.pathname.match(
        /^\/(?:shop\d+\/)?product\/[^/]+\/([1-9]\d*)(?:\/|$)/,
      )?.[1];
  return product && /^[1-9]\d{0,12}$/.test(product) ? product : "";
}
export function ownStoreLink(id: string) {
  return "https://dosomesaurus.com/product/detail.html?product_no=" + id;
}
function marketLink(raw: string) {
  if (!raw) return "";
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return invalid("원구매처 상품 링크 전체를 입력해 주세요.");
  }
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.port ||
    !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(u.hostname) ||
    /\.(?:local|localhost|internal|test)$/i.test(u.hostname) ||
    /(?:token|password|signature|auth_key)/i.test(u.search)
  )
    invalid("공유 가능한 HTTPS 상품 링크를 입력해 주세요.");
  return u.href;
}
export function parseRestock(input: Record<string, unknown>, now = new Date()) {
  const barcode = normalizeShoplingBcode(input.barcode);
  if (!/^B[A-Z]{1,2}\d+-\d+$/.test(barcode))
    invalid("옵션을 포함한 B코드를 확인해 주세요.");
  const phone = restockPhone(input.phone);
  const url = limited(input.storeUrl, 500),
    product = storeProductNumber(url);
  if (url && !product)
    invalid("도소매사우루스의 상품 상세 링크를 확인해 주세요.");
  const marketName = limited(input.marketName, 32),
    marketItem = limited(input.marketItem, 70);
  const marketUrl = marketLink(limited(input.marketUrl, 500));
  if (marketItem && !marketName)
    invalid("상품번호로 안내하려면 마켓명도 입력해 주세요.");
  if (marketName && !marketItem && !marketUrl)
    invalid("원구매처 상품번호 또는 링크를 입력해 주세요.");
  const body = limited(input.body || restockTemplate, 450, true);
  if (/저렴|최저가|할인|쿠폰|특가|더\s*싸|더\s*낮은\s*가격|\(광고\)/.test(body))
    invalid("가격 비교 문구는 원구매처의 가격 추천 항목에서 설정해 주세요.");
  if (/https?:\/\/|\{(?!상품\})/.test(body))
    invalid(
      "상품 링크는 전용 입력칸에 넣어 주세요. 초안에서 {상품}을 사용할 수 있습니다.",
    );
  const promotion = input.promotion === true;
  const ownPrice = Number(input.ownPrice || 0),
    marketPrice = Number(input.marketPrice || 0);
  if (
    promotion &&
    (!marketName ||
      ![ownPrice, marketPrice].every(
        (v) => Number.isSafeInteger(v) && v > 0 && v <= 100000000,
      ) ||
      ownPrice >= marketPrice)
  )
    invalid(
      "가격 안내에는 같은 옵션·수량·배송조건의 원구매처 가격과 더 낮은 자사몰 가격이 필요합니다.",
    );
  const details: RestockDetails = {
    body,
    ...(input.includeLowestOffer === true
      ? { includeLowestOffer: true as const }
      : {}),
    storeUrl: product ? ownStoreLink(product) : "",
    marketName,
    marketItem,
    marketUrl,
    promotion,
    ownPrice: promotion ? ownPrice : 0,
    marketPrice: promotion ? marketPrice : 0,
    comparedAt: promotion ? now.toISOString() : "",
  };
  return { barcode, phone, details };
}
export function composeRestock(
  d: RestockDetails,
  product: string,
  url: string,
  now: Date,
  optOut = "",
  offer?: import("./restockMarketOffer.ts").MarketOffer | null,
) {
  const age = now.getTime() - Date.parse(d.comparedAt);
  const kst = (now.getUTCHours() + 9) % 24;
  const promo = Boolean(
    d.promotion &&
      age >= 0 &&
      age <= 86400000 &&
      kst >= 8 &&
      kst < 21 &&
      /^080\d{7}$/.test(optOut.replace(/-/g, "")) &&
      d.ownPrice > 0 &&
      d.marketPrice > d.ownPrice,
  );
  const lines = [
    promo ? "(광고) 도소매사우루스" : "[도소매사우루스]",
    d.body.replaceAll("{상품}", product || "상품"),
  ];
  if (d.marketUrl || d.marketItem) {
    lines.push(
      "문의하신 " +
        (d.marketName || "마켓") +
        (d.marketItem ? " 상품번호 " + d.marketItem : " 상품"),
    );
    if (d.marketUrl) lines.push(d.marketUrl);
  }
  if (promo)
    lines.push(
      "같은 구매 조건으로 확인한 가격은 " +
        d.marketName +
        " " +
        d.marketPrice.toLocaleString("ko-KR") +
        "원, 자사몰 " +
        d.ownPrice.toLocaleString("ko-KR") +
        "원입니다.",
    );
  else if (d.marketUrl || d.marketItem)
    lines.push("도소매사우루스 상품 가격도 함께 확인하실 수 있습니다.");
  const purchase = d.includeLowestOffer && offer;
  if (purchase) {
    lines.push(
      purchase.market +
        " 판매가 " +
        purchase.price.toLocaleString("ko-KR") +
        (["도매꾹", "오너클랜"].includes(purchase.market)
          ? "원 (배송비 별도 · 최소 주문수량은 상품 페이지 참고)"
          : "원 (배송비 별도)"),
    );
    if (purchase.url !== d.marketUrl && purchase.url !== url)
      lines.push(purchase.url);
  }
  lines.push("자사몰 상품 " + url);
  if (promo) lines.push("무료수신거부 " + optOut);
  return lines.join("\n");
}
export function estimatedSmsBytes(text: string) {
  return Array.from(text).reduce(
    (n, c) => n + (c.charCodeAt(0) < 128 ? 1 : c.length * 2),
    0,
  );
}
