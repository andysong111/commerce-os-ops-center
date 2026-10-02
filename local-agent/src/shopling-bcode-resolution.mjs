import { normalizeBCode } from "./shopling-unshipped-reconciliation.mjs";

const VALID_BCODE = /^[A-Z]{3}\d+-\d+$/;

function clean(value) {
  return String(value ?? "").normalize("NFKC").trim();
}

function pick(row, keys) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && value !== "") return clean(value);
  }
  return "";
}

function orderNumber(row) {
  return pick(row, ["ord_no", "shoplingOrderNo", "orderNo"]);
}

function productId(row) {
  return pick(row, ["prod_id", "productId", "goods_key", "goodsKey"]);
}

function optionId(row) {
  return pick(row, ["opt_id", "optId", "option_id", "optionId"]);
}

function bCode(row) {
  return normalizeBCode(pick(row, [
    "optPtnOptCd",
    "opt_ptn_opt_cd",
    "ptn_opt_cd",
    "partnerOptionCode",
    "bCode",
  ]));
}

function unresolved(order, code, details = {}) {
  return {
    shoplingOrderNo: orderNumber(order),
    code,
    ...details,
  };
}

export function resolveOrderBCode(order, productRows) {
  const orderNo = orderNumber(order);
  const targetProductId = productId(order);
  const targetOptionId = optionId(order);
  if (!orderNo || !targetProductId) {
    return { ok: false, issue: unresolved(order, "ORDER_PRODUCT_ID_MISSING") };
  }

  const productCandidates = productRows.filter((row) => productId(row) === targetProductId);
  if (!productCandidates.length) {
    return {
      ok: false,
      issue: unresolved(order, "PRODUCT_VARIANT_NOT_FOUND", {
        productId: targetProductId,
      }),
    };
  }

  const exact = targetOptionId
    ? productCandidates.filter((row) => optionId(row) === targetOptionId)
    : productCandidates;
  if (exact.length !== 1) {
    return {
      ok: false,
      issue: unresolved(order, targetOptionId ? "OPTION_VARIANT_NOT_UNIQUE" : "ORDER_OPTION_ID_REQUIRED", {
        productId: targetProductId,
        optionId: targetOptionId,
        candidateCount: exact.length,
      }),
    };
  }

  const optionCode = bCode(exact[0]);
  const modelNo = pick(exact[0], ["model_no", "modelNo", "modelNumber"]);
  const modelName = pick(exact[0], ["model_nm", "modelName"]);
  if (!VALID_BCODE.test(optionCode)) {
    return {
      ok: false,
      issue: unresolved(order, "BCODE_NOT_RESOLVED", {
        productId: targetProductId,
        optionId: targetOptionId,
        modelNo,
        modelName,
      }),
    };
  }

  return {
    ok: true,
    value: {
      shoplingOrderNo: orderNo,
      productId: targetProductId,
      optionId: optionId(exact[0]),
      bCode: optionCode,
      bCodeEvidence: "EXACT_OPTION_MANAGEMENT_CODE",
      modelNo,
      modelName,
      productName: pick(order, ["t_prod_nm", "productName"]),
      optionName: pick(order, ["t_opt_valu", "optionName"]),
    },
  };
}

export function resolveShipmentManifestBCodes({ manifest, orderRows, productRows }) {
  if (!manifest || !Array.isArray(manifest.orders)) {
    const error = new Error("Shipment manifest must contain an orders array.");
    error.code = "SHIPMENT_MANIFEST_INVALID";
    throw error;
  }
  if (!Array.isArray(orderRows) || !Array.isArray(productRows)) {
    const error = new Error("Shopling order and product rows must be arrays.");
    error.code = "SHOPLING_BCODE_SOURCE_INVALID";
    throw error;
  }

  const ordersByNumber = new Map();
  for (const row of orderRows) {
    const key = orderNumber(row);
    if (!key) continue;
    const current = ordersByNumber.get(key) || [];
    current.push(row);
    ordersByNumber.set(key, current);
  }

  const resolutions = [];
  const unresolvedOrders = [];
  const enrichedOrders = manifest.orders.map((manifestOrder) => {
    const orderNo = orderNumber(manifestOrder);
    const candidates = ordersByNumber.get(orderNo) || [];
    if (candidates.length !== 1) {
      unresolvedOrders.push({
        shoplingOrderNo: orderNo,
        code: candidates.length ? "ORDER_ROW_NOT_UNIQUE" : "ORDER_ROW_NOT_FOUND",
        candidateCount: candidates.length,
      });
      return { ...manifestOrder, bCode: "" };
    }

    const order = candidates[0];
    const manifestProductId = pick(manifestOrder, ["shoplingProductCode", "productId"]);
    if (manifestProductId && manifestProductId !== productId(order)) {
      unresolvedOrders.push({
        shoplingOrderNo: orderNo,
        code: "MANIFEST_ORDER_PRODUCT_MISMATCH",
        manifestProductId,
        orderProductId: productId(order),
      });
      return { ...manifestOrder, bCode: "" };
    }

    const resolution = resolveOrderBCode(order, productRows);
    if (!resolution.ok) {
      unresolvedOrders.push(resolution.issue);
      return { ...manifestOrder, bCode: "" };
    }
    resolutions.push(resolution.value);
    return {
      ...manifestOrder,
      bCode: resolution.value.bCode,
      productName: resolution.value.productName || manifestOrder.productName,
      optionName: resolution.value.optionName || manifestOrder.optionName,
      shoplingOptionId: resolution.value.optionId,
    };
  });

  return {
    ...manifest,
    orders: enrichedOrders,
    bCodeResolution: {
      mode: "EXACT_PRODUCT_OPTION_ID",
      resolvedCount: resolutions.length,
      unresolvedCount: unresolvedOrders.length,
      ready: unresolvedOrders.length === 0,
      resolutions,
      unresolvedOrders,
    },
  };
}
