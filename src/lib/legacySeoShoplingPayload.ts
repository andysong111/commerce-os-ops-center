import { normalizeProductLaunchOptionNames } from "./productLaunchOptionNames.ts";
import { randomUUID } from "node:crypto";
import {
  buildProductLaunchShoplingPayload,
  resolveProductLaunchBasePurchasePriceKrw,
  roundUpShoplingPriceKrw,
  type ProductLaunchShoplingPayload,
} from "./productLaunchTrackerShopling.ts";

type UnknownRecord = Record<string, unknown>;

const LEGACY_SEO_WHOLESALE1_SURCHARGE_KEY =
  "legacySeoWholesale1AdditionalAmountKrw";

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function positiveNumber(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function legacySeoWholesale1Surcharge(option: UnknownRecord, index: number) {
  if (!(LEGACY_SEO_WHOLESALE1_SURCHARGE_KEY in option)) return null;
  const raw = option[LEGACY_SEO_WHOLESALE1_SURCHARGE_KEY];
  if (raw === null || raw === undefined || text(raw) === "") return null;
  const number = Number(raw);
  if (!Number.isFinite(number) || number < 0 || !Number.isInteger(number)) {
    throw new Error(
      `${index + 1}번째 옵션의 도매1 추가금이 올바르지 않습니다.`,
    );
  }
  return number;
}

/**
 * Legacy Shopling listings can legitimately contain multiple option labels that
 * point at the same physical inventory B-code / Shopling option-barcode number.
 * The generic product-launch builder intentionally rejects duplicate identities
 * for new canonical launches, so legacy re-registration validates each option
 * independently with that builder and then recombines the verified rows.
 *
 * This preserves the real historical inventory identity instead of fabricating
 * a new B-code merely to satisfy a uniqueness check.
 */
export function buildLegacySeoShoplingPayload(
  itemInput: unknown,
  policyInput: unknown,
  requestId = `legacy-product-launch-${randomUUID()}`,
): ProductLaunchShoplingPayload {
  const item = normalizeProductLaunchOptionNames(record(itemInput));
  const rawOptions = Array.isArray(item.orderOptions)
    ? item.orderOptions.map(record)
    : [];

  if (rawOptions.length <= 1) {
    return buildProductLaunchShoplingPayload(item, policyInput, requestId);
  }

  const optionNames = new Set(
    rawOptions.map((option) => text(option.optionName) || "옵션"),
  );
  if (optionNames.size > 1) {
    throw new Error("현재 샵플링 자동등록은 한 종류의 옵션명만 지원합니다.");
  }

  const explicitWholesale1Surcharges = rawOptions.map((option, index) =>
    legacySeoWholesale1Surcharge(option, index),
  );
  const hasExplicitWholesale1Surcharge = explicitWholesale1Surcharges.some(
    (value) => value !== null,
  );

  const validated = rawOptions.map((option, index) => {
    const barcode = text(option.barcode);
    const singleItem = {
      ...item,
      barcode,
      orderOptions: [option],
    };
    return buildProductLaunchShoplingPayload(
      singleItem,
      policyInput,
      `${requestId}:option:${index + 1}`,
    );
  });

  const base = validated[0];
  if (!base) {
    return buildProductLaunchShoplingPayload(item, policyInput, requestId);
  }
  const policy = record(policyInput);
  const listPriceMultiplier = positiveNumber(policy.listPriceMultiplier, 1.5);

  const baselineSalePrices = base.channels.map((baseChannel, channelIndex) => {
    const price = Math.min(
      ...validated.map((payload) => {
        const row = payload.channels[channelIndex]?.options[0];
        if (!row) {
          throw new Error(
            `${baseChannel.label}: 검증된 이전상품 옵션을 조합하지 못했습니다.`,
          );
        }
        return row.finalSalePriceKrw;
      }),
    );
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error(`${baseChannel.label}: 이전상품 판매가를 계산하지 못했습니다.`);
    }
    return price;
  });
  const wholesale1Index = base.channels.findIndex(
    (channel) => channel.key === "wholesale1",
  );
  const wholesale1Baseline = baselineSalePrices[wholesale1Index] ?? 0;
  if (hasExplicitWholesale1Surcharge && wholesale1Baseline <= 0) {
    throw new Error("도매1 기준 판매가를 확인하지 못했습니다.");
  }

  const channels = base.channels.map((baseChannel, channelIndex) => {
    const optionRows = validated.map((payload) => {
      const row = payload.channels[channelIndex]?.options[0];
      if (!row) {
        throw new Error(`${baseChannel.label}: 검증된 이전상품 옵션을 조합하지 못했습니다.`);
      }
      return row;
    });
    const salePrice = baselineSalePrices[channelIndex];
    if (!Number.isFinite(salePrice) || salePrice <= 0) {
      throw new Error(`${baseChannel.label}: 이전상품 판매가를 계산하지 못했습니다.`);
    }
    return {
      ...baseChannel,
      salePrice,
      orgPrice: resolveProductLaunchBasePurchasePriceKrw(salePrice),
      listPrice: roundUpShoplingPriceKrw(salePrice * listPriceMultiplier),
      options: optionRows.map((option, optionIndex) => {
        const explicitWholesale1Surcharge =
          explicitWholesale1Surcharges[optionIndex];
        if (explicitWholesale1Surcharge === null) {
          return {
            ...option,
            additionalAmountKrw: Math.max(
              0,
              option.finalSalePriceKrw - salePrice,
            ),
          };
        }
        const additionalAmountKrw =
          baseChannel.key === "wholesale1"
            ? explicitWholesale1Surcharge
            : roundUpShoplingPriceKrw(
                explicitWholesale1Surcharge *
                  (salePrice / wholesale1Baseline),
              );
        return {
          ...option,
          additionalAmountKrw,
          finalSalePriceKrw: salePrice + additionalAmountKrw,
        };
      }),
    };
  });

  return {
    ...base,
    jobRequestId: requestId,
    channels,
  };
}
