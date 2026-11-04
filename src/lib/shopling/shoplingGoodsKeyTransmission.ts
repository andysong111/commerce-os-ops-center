export type ShoplingLogicalProductKind = "OPTION" | "SINGLE";

export type ShoplingGoodsKeyTransmissionKind =
  | "OPTION_SEND"
  | "PRODUCT_SALE_STATUS_SEND";

export type ShoplingGoodsKeyShape = {
  goodsKey: string;
  optionCount: number;
};

export type ShoplingGoodsKeyTransmissionPlan = ShoplingGoodsKeyShape & {
  transmissionKind: ShoplingGoodsKeyTransmissionKind;
  effectiveProductKind: ShoplingLogicalProductKind;
  applyExactOptionStatus: boolean;
  applyProductSaleStatus: boolean;
};

/**
 * Shopling creates multiple goods keys for ordinary channel listings, so the
 * number of goods keys never identifies a split-option product.  The safe
 * boundary is each goods key's own option shape.
 *
 * Historical split listings can be logical OPTION products with one actual
 * option.  Shopling marketplace stock-out does not complete through the option
 * transmission lane for those rows, so they must also receive product-level
 * status and use the ordinary product sale-status transmission lane.
 */
export function planShoplingGoodsKeyTransmission(
  logicalProductKind: ShoplingLogicalProductKind,
  shape: ShoplingGoodsKeyShape,
): ShoplingGoodsKeyTransmissionPlan {
  const goodsKey = String(shape.goodsKey ?? "").trim();
  const optionCount = Number(shape.optionCount);
  if (!/^\d+$/.test(goodsKey)) {
    throw new Error("SHOPLING_GOODS_KEY_SHAPE_KEY_INVALID");
  }
  if (!Number.isInteger(optionCount) || optionCount < 1) {
    throw new Error(`SHOPLING_GOODS_KEY_OPTION_COUNT_INVALID:${goodsKey}:${shape.optionCount}`);
  }

  if (logicalProductKind === "SINGLE") {
    return {
      goodsKey,
      optionCount,
      transmissionKind: "PRODUCT_SALE_STATUS_SEND",
      effectiveProductKind: "SINGLE",
      applyExactOptionStatus: false,
      applyProductSaleStatus: true,
    };
  }

  if (logicalProductKind !== "OPTION") {
    throw new Error("SHOPLING_LOGICAL_PRODUCT_KIND_INVALID");
  }

  if (optionCount === 1) {
    return {
      goodsKey,
      optionCount,
      transmissionKind: "PRODUCT_SALE_STATUS_SEND",
      effectiveProductKind: "SINGLE",
      applyExactOptionStatus: true,
      applyProductSaleStatus: true,
    };
  }

  return {
    goodsKey,
    optionCount,
    transmissionKind: "OPTION_SEND",
    effectiveProductKind: "OPTION",
    applyExactOptionStatus: true,
    applyProductSaleStatus: false,
  };
}

