import { parseSimpleXml } from "@/lib/shopling/simpleXml";
import {
  shoplingReadConfigFromEnv,
  type ShoplingReadConfig,
} from "@/lib/shopling/shoplingReadClient";
import { postShoplingXml } from "@/lib/shopling/shoplingTlsTransport";

export type ShoplingOptionDesiredStatus = "SOLD_OUT" | "ON_SALE";

type RawObject = Record<string, unknown>;

type OptionSelection = {
  title: string;
  value: string;
};

type ShoplingOptionVariant = {
  goodsKey: string;
  partnerGoodsCode: string;
  selection: OptionSelection[];
  optionId: string;
  optionStatus: string;
  optionQuantity: string;
  partnerOptionCode: string;
};

export type ShoplingOptionStatusApplyResult = {
  matchedGoodsKey: string;
  barcode: string;
  desiredStatus: ShoplingOptionDesiredStatus;
  targetStatusCode: "B" | "C";
  statusBefore: "B" | "C";
  statusAfter: "B" | "C";
  optionQuantity: string;
  optionId: string;
  mutated: boolean;
  modifyCode: string;
  successCount: number;
  failCount: number;
  verifiedAt: string;
};

const DEFAULT_MODIFY_URL =
  "https://api.shopling.co.kr/prod/prod_modify_api.phtml?mode=2";
const MAX_GOODS_KEYS = 40;

function object(value: unknown): RawObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RawObject)
    : undefined;
}

function objects(value: unknown): RawObject[] {
  if (Array.isArray(value)) {
    return value.map(object).filter(Boolean) as RawObject[];
  }
  const row = object(value);
  return row ? [row] : [];
}

function scalar(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (["string", "number", "boolean"].includes(typeof value)) {
    return String(value).trim();
  }
  const row = object(value);
  if (!row) return "";
  return scalar(row["#text"] ?? row.__cdata ?? row.cdata);
}

function splitCsv(value: unknown) {
  const text = scalar(value);
  return text ? text.split(",").map((item) => item.trim()) : [];
}

function cdata(value: string) {
  return `<![CDATA[${String(value).replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
}

function compactXml(lines: string[]) {
  return `<?xml version="1.0" encoding="UTF-8"?>${lines.join("")}`;
}

function normalizeBarcode(value: string) {
  return String(value ?? "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/\s+/g, "");
}

function normalizeGoodsKeys(values: string[]) {
  return [
    ...new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value ?? "").trim())
        .filter((value) => /^\d+$/.test(value)),
    ),
  ].slice(0, MAX_GOODS_KEYS);
}

function targetStatusCode(desired: ShoplingOptionDesiredStatus): "B" | "C" {
  return desired === "SOLD_OUT" ? "C" : "B";
}

function cartesianSelections(dimensions: Array<{ title: string; values: string[] }>) {
  if (!dimensions.length) return [] as OptionSelection[][];
  return dimensions.reduce<OptionSelection[][]>(
    (combinations, dimension) =>
      combinations.flatMap((prefix) =>
        dimension.values.map((value) => [
          ...prefix,
          { title: dimension.title, value },
        ]),
      ),
    [[]],
  );
}

function parseProductVariants(body: string) {
  let parsed: RawObject;
  try {
    parsed = parseSimpleXml(body.trim());
  } catch {
    throw new Error("SHOPLING_OPTION_PRODUCTS_INVALID_XML");
  }
  const rspns = object(parsed.rspns ?? parsed);
  const container = object(rspns?.apiProdGather);
  if (!container) throw new Error("SHOPLING_OPTION_PRODUCTS_RESPONSE_ERROR");

  const variants: ShoplingOptionVariant[] = [];
  for (const goods of objects(container.goodsInfo)) {
    const goodsKey = scalar(goods.goods_key);
    if (!/^\d+$/.test(goodsKey)) continue;
    const partnerGoodsCode = scalar(goods.ptn_goods_cd);
    const options = object(goods.options);
    if (!options) continue;

    const dimensions = objects(options.optList)
      .map((list) => ({
        title: scalar(list.title),
        values: splitCsv(list.value),
      }))
      .filter((dimension) => dimension.title && dimension.values.length);
    const selections = cartesianSelections(dimensions);
    const optionIds = splitCsv(options.optId);
    const statuses = splitCsv(options.optStatus);
    const quantities = splitCsv(options.optQty);
    const partnerOptionCodes = splitCsv(options.optPtnOptCd);
    const optionCount = Math.max(
      selections.length,
      optionIds.length,
      statuses.length,
      quantities.length,
      partnerOptionCodes.length,
    );

    if (!optionCount) continue;
    if (selections.length !== optionCount) {
      throw new Error(
        `SHOPLING_OPTION_COMBINATION_COUNT_MISMATCH:${goodsKey}:${selections.length}:${optionCount}`,
      );
    }
    if (
      statuses.length !== optionCount ||
      quantities.length !== optionCount ||
      partnerOptionCodes.length !== optionCount
    ) {
      throw new Error(
        `SHOPLING_OPTION_ARRAY_COUNT_MISMATCH:${goodsKey}:${statuses.length}:${quantities.length}:${partnerOptionCodes.length}:${optionCount}`,
      );
    }

    for (let index = 0; index < optionCount; index += 1) {
      variants.push({
        goodsKey,
        partnerGoodsCode,
        selection: selections[index] ?? [],
        optionId: optionIds[index] ?? "",
        optionStatus: statuses[index] ?? "",
        optionQuantity: quantities[index] ?? "",
        partnerOptionCode: normalizeBarcode(partnerOptionCodes[index] ?? ""),
      });
    }
  }
  return variants;
}

function buildExactProductReadXml(
  config: Pick<ShoplingReadConfig, "loginId" | "companyId" | "authKey">,
  goodsKeys: string[],
) {
  const today = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return compactXml([
    "<reqst><apiProdGather>",
    `<login_id>${cdata(config.loginId)}</login_id>`,
    `<company_id>${cdata(config.companyId)}</company_id>`,
    `<api_auth_key>${cdata(config.authKey)}</api_auth_key>`,
    `<start_dt>${today}</start_dt><end_dt>${today}</end_dt>`,
    `<prod_id>${cdata(goodsKeys.join(","))}</prod_id>`,
    `<prod_fields>${cdata("goods_key,ptn_goods_cd")}</prod_fields>`,
    "<opt_yn>Y</opt_yn><attri_yn>N</attri_yn>",
    "</apiProdGather></reqst>",
  ]);
}

function buildModifyXml(
  config: Pick<ShoplingReadConfig, "loginId" | "companyId" | "authKey">,
  variant: ShoplingOptionVariant,
  target: "B" | "C",
) {
  if (!variant.selection.length) {
    throw new Error("SHOPLING_OPTION_SELECTION_REQUIRED");
  }
  if (!/^\d+$/.test(variant.optionQuantity)) {
    throw new Error("SHOPLING_OPTION_QUANTITY_INVALID");
  }
  return compactXml([
    "<reqst><apiProdMdy>",
    `<login_id>${cdata(config.loginId)}</login_id>`,
    `<company_id>${cdata(config.companyId)}</company_id>`,
    `<api_auth_key>${cdata(config.authKey)}</api_auth_key>`,
    "<goodsInfo>",
    `<goods_key>${cdata(variant.goodsKey)}</goods_key>`,
    "<options>",
    ...variant.selection.map(
      (selection) =>
        `<optList><title>${cdata(selection.title)}</title><value>${cdata(selection.value)}</value></optList>`,
    ),
    `<optStatus>${target}</optStatus>`,
    `<optQty>${variant.optionQuantity}</optQty>`,
    "</options>",
    "</goodsInfo>",
    "</apiProdMdy></reqst>",
  ]);
}

function parseModifyResponse(body: string, goodsKey: string) {
  let parsed: RawObject;
  try {
    parsed = parseSimpleXml(body.trim());
  } catch {
    throw new Error("SHOPLING_OPTION_MODIFY_INVALID_XML");
  }
  const rspns = object(parsed.rspns ?? parsed);
  const container = object(rspns?.apiProdMdyRst);
  if (!container) throw new Error("SHOPLING_OPTION_MODIFY_RESPONSE_ERROR");
  const rows = objects(container.goodsRst);
  const exact = rows.filter((row) => scalar(row.goods_key) === goodsKey);
  if (exact.length !== 1) {
    throw new Error(`SHOPLING_OPTION_MODIFY_RESULT_COUNT:${exact.length}`);
  }
  const code = scalar(exact[0].code);
  const message = scalar(exact[0].msg);
  const successCount = Number(scalar(container.succs_cnt));
  const failCount = Number(scalar(container.fail_cnt));
  if (
    code !== "000" ||
    successCount !== 1 ||
    failCount !== 0
  ) {
    throw new Error(
      `SHOPLING_OPTION_MODIFY_REJECTED:${code || "NO_CODE"}:${message || "NO_MESSAGE"}:${Number.isFinite(successCount) ? successCount : "NA"}:${Number.isFinite(failCount) ? failCount : "NA"}`,
    );
  }
  return { code, successCount, failCount };
}

async function postXml(url: string, xml: string, userAgent: string) {
  const response = await postShoplingXml(url, xml, {
    headers: {
      accept: "application/xml, text/xml",
      "content-type": "application/xml; charset=utf-8",
      "user-agent": userAgent,
    },
    timeoutMs: 45_000,
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`SHOPLING_OPTION_HTTP_${response.status}`);
  }
  return body;
}

async function readVariants(
  config: ShoplingReadConfig,
  goodsKeys: string[],
) {
  const xml = buildExactProductReadXml(config, goodsKeys);
  const body = await postXml(
    config.productsUrl,
    xml,
    "commerce-os-shopling-option-read/1.0",
  );
  return parseProductVariants(body);
}

function exactVariant(
  variants: ShoplingOptionVariant[],
  barcode: string,
) {
  const matches = variants.filter(
    (variant) => variant.partnerOptionCode === barcode,
  );
  if (matches.length !== 1) {
    throw new Error(
      `SHOPLING_OPTION_EXACT_MATCH_REQUIRED:${barcode}:${matches.length}`,
    );
  }
  return matches[0];
}

export async function applyShoplingOptionStatus(input: {
  barcode: string;
  desiredStatus: ShoplingOptionDesiredStatus;
  goodsKeys: string[];
  env?: Record<string, string | undefined>;
}): Promise<ShoplingOptionStatusApplyResult> {
  const barcode = normalizeBarcode(input.barcode);
  if (!/^B[A-Z]{2}\d+-\d+$/.test(barcode)) {
    throw new Error("SHOPLING_OPTION_BARCODE_INVALID");
  }
  if (!(["SOLD_OUT", "ON_SALE"] as string[]).includes(input.desiredStatus)) {
    throw new Error("SHOPLING_OPTION_DESIRED_STATUS_INVALID");
  }
  const goodsKeys = normalizeGoodsKeys(input.goodsKeys);
  if (!goodsKeys.length) throw new Error("SHOPLING_OPTION_GOODS_KEY_REQUIRED");

  const config = shoplingReadConfigFromEnv(input.env ?? process.env);
  const target = targetStatusCode(input.desiredStatus);
  const beforeVariants = await readVariants(config, goodsKeys);
  const before = exactVariant(beforeVariants, barcode);
  if (!(["B", "C"] as string[]).includes(before.optionStatus)) {
    throw new Error(
      `SHOPLING_OPTION_STATUS_TRANSITION_BLOCKED:${before.optionStatus || "EMPTY"}`,
    );
  }
  if (!/^\d+$/.test(before.optionQuantity)) {
    throw new Error("SHOPLING_OPTION_QUANTITY_INVALID");
  }

  if (before.optionStatus === target) {
    return {
      matchedGoodsKey: before.goodsKey,
      barcode,
      desiredStatus: input.desiredStatus,
      targetStatusCode: target,
      statusBefore: before.optionStatus as "B" | "C",
      statusAfter: before.optionStatus as "B" | "C",
      optionQuantity: before.optionQuantity,
      optionId: before.optionId,
      mutated: false,
      modifyCode: "NOOP_ALREADY_DESIRED",
      successCount: 0,
      failCount: 0,
      verifiedAt: new Date().toISOString(),
    };
  }

  const modifyUrl =
    (input.env ?? process.env).SHOPLING_PRODUCTS_MODIFY_API_URL?.trim() ||
    DEFAULT_MODIFY_URL;
  const modifyXml = buildModifyXml(config, before, target);
  const modifyBody = await postXml(
    modifyUrl,
    modifyXml,
    "commerce-os-shopling-option-modify/1.0",
  );
  const modified = parseModifyResponse(modifyBody, before.goodsKey);

  const afterVariants = await readVariants(config, [before.goodsKey]);
  const after = exactVariant(afterVariants, barcode);
  if (after.optionStatus !== target) {
    throw new Error(
      `SHOPLING_OPTION_READBACK_STATUS_MISMATCH:${target}:${after.optionStatus || "EMPTY"}`,
    );
  }
  if (after.optionQuantity !== before.optionQuantity) {
    throw new Error(
      `SHOPLING_OPTION_READBACK_QTY_MISMATCH:${before.optionQuantity}:${after.optionQuantity}`,
    );
  }

  return {
    matchedGoodsKey: before.goodsKey,
    barcode,
    desiredStatus: input.desiredStatus,
    targetStatusCode: target,
    statusBefore: before.optionStatus as "B" | "C",
    statusAfter: after.optionStatus as "B" | "C",
    optionQuantity: before.optionQuantity,
    optionId: before.optionId,
    mutated: true,
    modifyCode: modified.code,
    successCount: modified.successCount,
    failCount: modified.failCount,
    verifiedAt: new Date().toISOString(),
  };
}
