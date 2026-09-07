import { randomUUID } from "node:crypto";
import { normalizeTossCompatibleOptionRows } from "@/lib/tossCompatibleOption";

export const PRODUCT_LAUNCH_CHANNELS = [
  { key: "wholesale1", label: "도매1", suffix: "a" },
  { key: "wholesale2", label: "도매2", suffix: "b" },
  { key: "wholesale3", label: "도매3", suffix: "c" },
  { key: "wholesale4", label: "도매4", suffix: "d" },
  { key: "retail1", label: "소매1", suffix: "e" },
  { key: "retail2", label: "소매2", suffix: "f" },
] as const;

export const PRODUCT_NOTICE_ATTRIBUTE_CODES = [
  "a023", "a140", "a144", "a005", "a145", "a002",
  "a009", "a126", "a147", "a148", "a149",
] as const;

export const SHOPLING_PRICE_ROUND_UP_UNIT_KRW = 10;
// Production registry values are numeric-only. The optional OB prefix is accepted only
// as a short transition guard for stale browser/test payloads; the Shopling worker strips it.
const OPTION_BARCODE_NO_PATTERN = /^(?:OB)?\d{12}$/;

const DEFAULT_MULTIPLIERS = {
  wholesale1: 1,
  wholesale2: 1.15,
  wholesale3: 1.1,
  wholesale4: 1.3,
  retail1: 1.3,
  retail2: 1.4,
} as const;

const DEFAULT_SHIPPING_NOTICE_HTML =
  "<img src='https://gi.esmplus.com/andy80101/%EB%8F%84%EB%A7%A4%EC%9E%AC%EA%B3%A0%20%ED%95%98%EB%8B%A8%EA%B3%B5%EC%A7%80/%ED%95%98%EB%8B%A8%20%EA%B3%B5%EC%A7%801%EB%B2%88111.jpg' />";

type UnknownRecord = Record<string, unknown>;

export type ProductLaunchSeoFinal = {
  productName: string;
  groupProductNames: Record<string, string>;
  searchKeywords: string[];
  searchLine: string;
  source: string;
  sourceUrl: string;
  offerId: string;
  generatedAt: string;
};

export type ProductLaunchShoplingPayload = {
  schemaVersion: 1;
  jobRequestId: string;
  launchItemId: string;
  modelNumber: string;
  modelName: string;
  category: string;
  siteSearch: string;
  seoFinal: ProductLaunchSeoFinal | null;
  detailHtml: string;
  images: { main: string; additional: string[] };
  imageRotation: {
    strategy: "round_robin_v1";
    round: number;
    source: "seo_inventory_append_history";
  };
  fixedFields: {
    prodTp: string;
    taxTp: string;
    saleStatus: string;
    originName: string;
    originDetailName: string;
    makerName: string;
    productWeight: number;
    deliveryType: string;
    deliveryCost: number;
  };
  goodsNotice: { code: string; attributes: Record<string, string> };
  channels: Array<{
    key: string;
    label: string;
    ptnGoodsCd: string;
    productName: string;
    productAbbreviation: string;
    brandName: string;
    orgPrice: number;
    salePrice: number;
    listPrice: number;
    options: Array<{
      optionName: string;
      saleOption: string;
      barcode: string;
      optionBarcodeNo: string;
      additionalAmountKrw: number;
      finalSalePriceKrw: number;
    }>;
  }>;
};

export function roundUpShoplingPriceKrw(
  value: unknown,
  unit = SHOPLING_PRICE_ROUND_UP_UNIT_KRW,
) {
  const number = Number(value);
  const normalizedUnit = Math.max(
    1,
    Math.floor(Number(unit) || SHOPLING_PRICE_ROUND_UP_UNIT_KRW),
  );
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.ceil(number / normalizedUnit) * normalizedUnit;
}

export function resolveProductLaunchBasePurchasePriceKrw(baseSalePriceKrw: unknown) {
  const salePrice = Number(baseSalePriceKrw);
  if (!Number.isFinite(salePrice) || salePrice <= 0) return 0;
  return roundUpShoplingPriceKrw(salePrice / 2);
}

export function buildProductLaunchShoplingPayload(
  itemInput: unknown,
  policyInput: unknown,
  requestId = `product-launch-${randomUUID()}`,
): ProductLaunchShoplingPayload {
  const item = asRecord(itemInput);
  const policy = asRecord(policyInput);
  const modelNumber = text(item.modelNumber);
  const modelName = text(item.productName);
  const category = text(item.shoplingCategory);
  const selfCodeBase = normalizeCode(item.selfCodeBase);
  const mainBarcode = normalizeCode(item.barcode);
  const detailPage = asRecord(item.detailPageAsset);
  const detailHtml = text(detailPage.html);
  const mainImage = text(detailPage.mainImageUrl);
  const additionalImages = stringList(detailPage.additionalImageUrls).slice(0, 10);
  const registrationHistory = Array.isArray(item.shoplingRegistrationHistory)
    ? item.shoplingRegistrationHistory
    : [];
  const imageRotationRound = registrationHistory.filter(
    (entry) => text(asRecord(entry).registrationType) === "seo_inventory_append",
  ).length;
  const seoFinal = normalizeSeoFinal(item.seoFinal);
  const rawOptions = Array.isArray(item.orderOptions) ? item.orderOptions : [];
  const singleOptionBarcode =
    rawOptions.length === 1
      ? mainBarcode || normalizeCode(asRecord(rawOptions[0]).barcode)
      : "";
  const optionDrafts = rawOptions.map((value, index) => {
    const option = asRecord(value);
    return {
      optionName: text(option.optionName),
      saleOption: text(option.saleOption),
      barcode:
        rawOptions.length === 1
          ? singleOptionBarcode
          : normalizeCode(option.barcode),
      optionBarcodeNo: text(option.optionBarcodeNo).toUpperCase(),
      baseSalePriceKrw: nonNegativeInteger(option.baseSalePriceKrw),
      unitCostKrw: nonNegativeInteger(option.unitCostKrw),
      index,
    };
  });
  let options = optionDrafts;
  if (optionDrafts.length) {
    try {
      options = normalizeTossCompatibleOptionRows(
        optionDrafts,
        [modelName, category].filter(Boolean).join(" "),
      ).rows;
    } catch (error) {
      throw new Error(
        `토스 호환 옵션 사전검증 실패: ${
          error instanceof Error ? error.message : "옵션 구조를 확인하세요."
        }`,
      );
    }
  }

  const errors: string[] = [];
  if (!text(item.id)) errors.push("출시 상품 ID가 없습니다.");
  if (!modelNumber) errors.push("모델번호가 없습니다.");
  if (!modelName) errors.push("모델명이 없습니다.");
  if (!category) errors.push("샵플링 표준 카테고리를 정확하게 입력하세요.");
  if (!selfCodeBase) errors.push("자사상품 기본코드가 없습니다.");
  if (!detailHtml) errors.push("상세페이지 HTML이 없습니다.");
  if (!mainImage) errors.push("대표이미지가 없습니다.");
  if (!options.length) errors.push("발주·입고 옵션가격이 없습니다.");

  if (seoFinal) {
    if (!seoFinal.productName) errors.push("SEO FINAL 공통 상품명이 없습니다.");
    if (seoFinal.searchKeywords.length !== 10) {
      errors.push("SEO FINAL 검색어는 중복 없이 정확히 10개여야 합니다.");
    }
    for (const channel of PRODUCT_LAUNCH_CHANNELS) {
      if (!seoGroupProductName(seoFinal, channel.key, channel.label)) {
        errors.push(`SEO FINAL ${channel.label} 상품명이 없습니다.`);
      }
    }
  }

  const seenBarcodes = new Set<string>();
  const seenOptionBarcodeNos = new Set<string>();
  for (const option of options) {
    const name = option.saleOption || `${option.index + 1}번째 옵션`;
    if (!option.saleOption) errors.push(`${option.index + 1}번째 옵션값이 없습니다.`);
    if (!option.barcode) errors.push(`${name} B코드가 없습니다.`);
    if (!OPTION_BARCODE_NO_PATTERN.test(option.optionBarcodeNo)) {
      errors.push(`${name} 옵션바코드NO는 숫자 12자리여야 합니다. 상품 상세에서 자동발급 상태를 확인하세요.`);
    }
    if (option.baseSalePriceKrw <= 0) errors.push(`${name} 기준 판매가가 없습니다.`);
    // unitCostKrw is intentionally not a Shopling upload gate. The generated
    // Shopling payload never consumes purchase cost; pricing is based only on
    // baseSalePriceKrw + channel multipliers. Missing purchase cost remains a
    // separate purchasing/price-engine data-quality concern and must not be
    // fabricated from a selling price just to pass registration.
    if (option.barcode) {
      if (seenBarcodes.has(option.barcode)) errors.push(`옵션 B코드 ${option.barcode}가 중복되었습니다.`);
      seenBarcodes.add(option.barcode);
    }
    if (option.optionBarcodeNo) {
      const comparableNo = option.optionBarcodeNo.replace(/^OB/, "");
      if (seenOptionBarcodeNos.has(comparableNo)) {
        errors.push(`옵션바코드NO ${comparableNo}가 중복되었습니다.`);
      }
      seenOptionBarcodeNos.add(comparableNo);
    }
  }
  const optionNames = new Set(options.map((option) => option.optionName));
  if (optionNames.size > 1) {
    errors.push("현재 샵플링 자동등록은 한 종류의 옵션명만 지원합니다.");
  }
  if (errors.length) throw new Error([...new Set(errors)].join("\n"));

  const multipliers = asRecord(policy.channelMultipliers);
  const listPriceMultiplier = positiveNumber(policy.listPriceMultiplier, 1.5);
  const shippingNoticeHtml = text(policy.shippingNoticeHtml) || DEFAULT_SHIPPING_NOTICE_HTML;
  const goodsNoticeValue = text(policy.goodsNoticeValue) || "상세설명 참고";
  const goodsNoticeAttributes = Object.fromEntries(
    PRODUCT_NOTICE_ATTRIBUTE_CODES.map((code) => [code, goodsNoticeValue]),
  );
  const seoProductName = seoFinal?.productName || modelName;

  const channels = PRODUCT_LAUNCH_CHANNELS.map((channel) => {
    const multiplier = positiveNumber(
      multipliers[channel.key],
      DEFAULT_MULTIPLIERS[channel.key],
    );
    const pricedOptions = options.map((option) => ({
      ...option,
      finalSalePriceKrw: roundUpShoplingPriceKrw(
        option.baseSalePriceKrw * multiplier,
      ),
    }));
    const salePrice = Math.min(...pricedOptions.map((option) => option.finalSalePriceKrw));
    const orgPrice = resolveProductLaunchBasePurchasePriceKrw(salePrice);
    const seoChannelName = seoFinal
      ? seoGroupProductName(seoFinal, channel.key, channel.label)
      : "";
    return {
      key: channel.key,
      label: channel.label,
      ptnGoodsCd: `${selfCodeBase}${channel.suffix}`,
      productName: seoChannelName || `${modelName} ${channel.label}`,
      productAbbreviation: seoProductName,
      brandName:
        channel.key === "retail1"
          ? text(policy.retail1BrandName) || "동네일등"
          : "",
      orgPrice,
      salePrice,
      listPrice: roundUpShoplingPriceKrw(salePrice * listPriceMultiplier),
      options: pricedOptions.map((option) => ({
        optionName: option.optionName,
        saleOption: option.saleOption,
        barcode: option.barcode,
        optionBarcodeNo: option.optionBarcodeNo,
        finalSalePriceKrw: option.finalSalePriceKrw,
        additionalAmountKrw: Math.max(0, option.finalSalePriceKrw - salePrice),
      })),
    };
  });

  return {
    schemaVersion: 1,
    jobRequestId: requestId,
    launchItemId: text(item.id),
    modelNumber,
    modelName,
    category,
    siteSearch: seoFinal?.searchLine || "",
    seoFinal,
    detailHtml: appendShippingNotice(detailHtml, shippingNoticeHtml),
    images: { main: mainImage, additional: additionalImages },
    imageRotation: {
      strategy: "round_robin_v1",
      round: imageRotationRound,
      source: "seo_inventory_append_history",
    },
    fixedFields: {
      prodTp: text(policy.productType) || "A",
      taxTp: text(policy.taxType) || "A",
      saleStatus: text(policy.saleStatus) || "B",
      originName: text(policy.originName) || "수입",
      originDetailName: text(policy.originDetailName) || "중국",
      makerName: text(policy.makerName) || "중국OEM",
      productWeight: positiveNumber(policy.productWeight, 1),
      deliveryType: text(policy.deliveryType) || "C",
      deliveryCost: nonNegativeInteger(policy.deliveryCost, 3000),
    },
    goodsNotice: {
      code: text(policy.goodsNoticeCode) || "38",
      attributes: goodsNoticeAttributes,
    },
    channels,
  };
}

export function appendShippingNotice(detailHtml: string, noticeHtml: string) {
  const detail = detailHtml.trim();
  const notice = noticeHtml.trim();
  if (!notice) return detail;
  const url = notice.match(/https?:\/\/[^'"\s>]+/)?.[0];
  if (detail.includes(notice) || (url && detail.includes(url))) return detail;
  return [detail, notice].filter(Boolean).join("\n");
}

function normalizeSeoFinal(value: unknown): ProductLaunchSeoFinal | null {
  const source = asRecord(value);
  if (!Object.keys(source).length) return null;
  const groupSource = asRecord(source.groupProductNames);
  const groupProductNames = Object.fromEntries(
    Object.entries(groupSource)
      .map(([key, productName]) => [key, text(productName)] as const)
      .filter(([, productName]) => Boolean(productName)),
  );
  const searchKeywords = [...new Set(stringList(source.searchKeywords))];
  return {
    productName: text(source.productName),
    groupProductNames,
    searchKeywords,
    searchLine: searchKeywords.join(","),
    source: text(source.source),
    sourceUrl: text(source.sourceUrl),
    offerId: text(source.offerId),
    generatedAt: text(source.generatedAt),
  };
}

function seoGroupProductName(
  seoFinal: ProductLaunchSeoFinal,
  channelKey: string,
  channelLabel: string,
) {
  return text(
    seoFinal.groupProductNames[channelKey]
      ?? seoFinal.groupProductNames[channelLabel],
  );
}

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

function normalizeCode(value: unknown) {
  return text(value)
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 120);
}

function stringList(value: unknown) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  return text(value)
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function positiveNumber(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function nonNegativeInteger(value: unknown, fallback = 0) {
  const number = Math.ceil(Number(value));
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}