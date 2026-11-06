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

export type ShoplingGoodsKeyTransmissionStep = ShoplingGoodsKeyShape & {
  sequence: number;
  transmissionKind: ShoplingGoodsKeyTransmissionKind;
  effectiveProductKind: ShoplingLogicalProductKind;
};

export type ShoplingGoodsKeyStateTransitionPlan = ShoplingGoodsKeyShape & {
  applyExactOptionStatus: boolean;
  applyProductSaleStatus: boolean;
  productStatusTarget: "SOLD_OUT" | "ON_SALE" | null;
  transitionReason:
    | "ORDINARY_SINGLE"
    | "SPLIT_ONE_OPTION_PRODUCT"
    | "OPTION_PARTIAL_STATE"
    | "OPTION_FULL_SOLD_OUT"
    | "OPTION_PARTIAL_RECOVERY";
  transmissions: ShoplingGoodsKeyTransmissionStep[];
};

type ShoplingGoodsKeyStateTransitionInput = {
  logicalProductKind: ShoplingLogicalProductKind;
  shape: ShoplingGoodsKeyShape;
  desiredStatus: "SOLD_OUT" | "ON_SALE";
  productSaleStatusBefore: string;
  sellableOptionCountAfter: number;
  soldOutOptionCountAfter: number;
};

function transmissionStep(
  shape: ShoplingGoodsKeyShape,
  sequence: number,
  transmissionKind: ShoplingGoodsKeyTransmissionKind,
): ShoplingGoodsKeyTransmissionStep {
  return {
    ...shape,
    sequence,
    transmissionKind,
    effectiveProductKind:
      transmissionKind === "OPTION_SEND" ? "OPTION" : "SINGLE",
  };
}

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

/**
 * Plans the marketplace transmission after the exact option API write has
 * been read back. Product exposure is an aggregate property: the final option
 * becoming sold out must use the product sold-out lane, while the first option
 * returning to sale must expose the product before the option lane runs.
 */
export function planShoplingGoodsKeyStateTransition(
  input: ShoplingGoodsKeyStateTransitionInput,
): ShoplingGoodsKeyStateTransitionPlan {
  const base = planShoplingGoodsKeyTransmission(
    input.logicalProductKind,
    input.shape,
  );
  const productSaleStatusBefore = String(
    input.productSaleStatusBefore ?? "",
  ).trim().toUpperCase();
  const sellableOptionCountAfter = Number(input.sellableOptionCountAfter);
  const soldOutOptionCountAfter = Number(input.soldOutOptionCountAfter);
  if (!(["B", "C"] as string[]).includes(productSaleStatusBefore)) {
    throw new Error(
      `SHOPLING_PRODUCT_STATUS_TRANSITION_BLOCKED:${productSaleStatusBefore || "EMPTY"}`,
    );
  }
  if (
    !Number.isInteger(sellableOptionCountAfter) ||
    sellableOptionCountAfter < 0 ||
    !Number.isInteger(soldOutOptionCountAfter) ||
    soldOutOptionCountAfter < 0 ||
    sellableOptionCountAfter + soldOutOptionCountAfter !== base.optionCount
  ) {
    throw new Error(
      `SHOPLING_OPTION_AGGREGATE_STATUS_UNCERTAIN:${base.goodsKey}:${sellableOptionCountAfter}:${soldOutOptionCountAfter}:${base.optionCount}`,
    );
  }

  if (input.logicalProductKind === "SINGLE") {
    return {
      ...base,
      productStatusTarget: input.desiredStatus,
      transitionReason: "ORDINARY_SINGLE",
      transmissions: [
        transmissionStep(base, 1, "PRODUCT_SALE_STATUS_SEND"),
      ],
    };
  }

  if (base.optionCount === 1) {
    return {
      ...base,
      productStatusTarget: input.desiredStatus,
      transitionReason: "SPLIT_ONE_OPTION_PRODUCT",
      transmissions: [
        transmissionStep(base, 1, "PRODUCT_SALE_STATUS_SEND"),
      ],
    };
  }

  if (input.desiredStatus === "SOLD_OUT" && sellableOptionCountAfter === 0) {
    return {
      ...base,
      applyProductSaleStatus: true,
      productStatusTarget: "SOLD_OUT",
      transitionReason: "OPTION_FULL_SOLD_OUT",
      transmissions: [
        transmissionStep(base, 1, "PRODUCT_SALE_STATUS_SEND"),
      ],
    };
  }

  if (input.desiredStatus === "ON_SALE" && sellableOptionCountAfter < 1) {
    throw new Error(
      `SHOPLING_OPTION_ON_SALE_AGGREGATE_MISMATCH:${base.goodsKey}`,
    );
  }

  if (input.desiredStatus === "ON_SALE" && productSaleStatusBefore === "C") {
    return {
      ...base,
      applyProductSaleStatus: true,
      productStatusTarget: "ON_SALE",
      transitionReason: "OPTION_PARTIAL_RECOVERY",
      transmissions: [
        transmissionStep(base, 1, "PRODUCT_SALE_STATUS_SEND"),
        transmissionStep(base, 2, "OPTION_SEND"),
      ],
    };
  }

  return {
    ...base,
    applyProductSaleStatus: false,
    productStatusTarget: null,
    transitionReason: "OPTION_PARTIAL_STATE",
    transmissions: [transmissionStep(base, 1, "OPTION_SEND")],
  };
}

