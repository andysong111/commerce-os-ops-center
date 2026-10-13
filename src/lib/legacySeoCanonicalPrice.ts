import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import {
  readProductLaunchStorageJson,
  type ProductLaunchAdminConfig,
  type ProductLaunchIdentity,
} from "@/lib/productLaunchTrackerServer";

type UnknownRecord = Record<string, unknown>;

type CanonicalBatch = {
  import_batch_id: string;
  source_revision: string;
  source_workbook: string;
  source_sheet: string;
  expected_row_count: number;
  imported_row_count: number;
};

type CanonicalPriceRow = {
  canonical_price_id: string;
  import_batch_id: string;
  source_row_index: number | null;
  model_number: string;
  source_model_number: string;
  product_name: string;
  sale_option: string;
  option_key: string;
  unit_cost_krw: number | string | null;
  base_sale_price_krw: number | string | null;
  price_status: string;
  confidence: string;
  cost_basis_date: string | null;
  cost_source_sheet: string;
  confirmation_reason: string;
};

type CanonicalMatchAudit = {
  method:
    | "uniform_single_residual_name_mismatch"
    | "bijective_affix_option_name"
    | "known_legacy_option_alias"
    | "unique_product_name_option_affix";
  currentSaleOption: string;
  canonicalSaleOption: string;
};

export type LegacySeoCanonicalPriceIssue = {
  itemId: string;
  modelNumber: string;
  saleOption: string;
  reason: string;
  canonicalCandidates?: Array<{
    productName: string;
    saleOption: string;
  }>;
};

export type LegacySeoCanonicalPriceItemResult = {
  itemId: string;
  modelNumber: string;
  excluded: boolean;
  excludedReason: string;
  optionCount: number;
  appliedCount: number;
  unresolved: LegacySeoCanonicalPriceIssue[];
};

const ITEM_TABLE = "product_launch_items";
const OPTION_TABLE = "product_launch_options";
const PRICE_TABLE = "legacy_seo_canonical_prices";
const BATCH_TABLE = "legacy_seo_canonical_price_batches";
const PATCH_CONCURRENCY = 10;
const CANONICAL_PRICE_SOURCE = "china_order_final_confirmed_v4";
const CANONICAL_PRICE_REVISION = "20260809_v4_option_max_uniform";

const CANONICAL_MODEL_SOURCE_RULES: Record<
  string,
  { mode: "replace" | "supplement"; sourceModels: string[] }
> = {
  AAA086: { mode: "supplement", sourceModels: ["AAA087", "AAA088", "AAA089"] },
  AAA327: { mode: "replace", sourceModels: ["AAA317"] },
  AAA420: { mode: "replace", sourceModels: ["AAA327"] },
};

const CANONICAL_OPTION_KEY_ALIASES: Record<string, Record<string, string[]>> = {
  AAA127: { "단품": ["펀칭기"] },
  AAA208: { "단품": ["단품옵션미기재"] },
  AAA286: { "중형": ["m"] },
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function modelKey(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

export function legacySeoCanonicalOptionKey(value: unknown) {
  return text(value)
    .toLowerCase()
    .replace(/[\s,，/|:：()\[\]{}._-]+/g, "");
}

function postgrestIn(values: string[]) {
  return values
    .map((value) => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`)
    .join(",");
}

function positiveNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function currentOptionSale(option: UnknownRecord) {
  const payload = record(option.option_payload);
  return Math.round(
    positiveNumber(option.baseSalePriceKrw) ||
      positiveNumber(option.base_sale_price_krw) ||
      positiveNumber(payload.baseSalePriceKrw),
  );
}

function currentOptionCost(option: UnknownRecord) {
  const payload = record(option.option_payload);
  return Math.round(
    positiveNumber(option.unitCostKrw) ||
      positiveNumber(option.unit_cost_krw) ||
      positiveNumber(payload.unitCostKrw),
  );
}

function canonicalMarkerConfirmed(option: UnknownRecord) {
  const payload = record(option.option_payload);
  const canonical = record(option.canonicalChinaPrice ?? payload.canonicalChinaPrice);
  if (
    text(canonical.source) !== CANONICAL_PRICE_SOURCE ||
    text(canonical.sourceRevision) !== CANONICAL_PRICE_REVISION
  ) {
    return false;
  }
  const canonicalSale = Math.round(positiveNumber(canonical.finalSalePriceKrw));
  const canonicalCost = Math.round(
    positiveNumber(canonical.unitCostKrwMirror) ||
      positiveNumber(canonical.unitCostKrwExact),
  );
  return (
    currentOptionSale(option) > 0 &&
    currentOptionCost(option) > 0 &&
    currentOptionSale(option) === canonicalSale &&
    currentOptionCost(option) === canonicalCost
  );
}

export function legacySeoCentralPricePolicyConfirmed(item: UnknownRecord) {
  const payload = record(item.item_payload);
  const policy = record(item.pricePolicy ?? payload.pricePolicy);
  return (
    text(policy.status).toLowerCase() === "success" &&
    policy.required !== false &&
    positiveNumber(policy.goodsKeyCount) > 0 &&
    Boolean(text(policy.completedAt) || text(policy.updatedAt))
  );
}

function legacyStockPriceConfirmed(option: UnknownRecord) {
  const payload = record(option.option_payload);
  const optionId = text(option.optionId ?? option.option_id ?? option.id ?? payload.id);
  return (
    /^stock-[a-z0-9-]+-\d+$/i.test(optionId) &&
    currentOptionSale(option) > 0 &&
    currentOptionCost(option) > 0
  );
}

export function legacySeoPriceAuthorityConfirmed(
  item: UnknownRecord,
  option: UnknownRecord,
) {
  if (canonicalMarkerConfirmed(option)) return true;
  if (legacySeoCentralPricePolicyConfirmed(item)) {
    return currentOptionSale(option) > 0 && currentOptionCost(option) > 0;
  }
  return legacyStockPriceConfirmed(option);
}

function activePriceRow(row: CanonicalPriceRow) {
  return text(row.price_status) === "적용대상";
}

function discontinuedPriceRow(row: CanonicalPriceRow) {
  return text(row.price_status).includes("단종") || text(row.price_status).includes("적용제외");
}

function canonicalValueSignature(row: CanonicalPriceRow) {
  const cost = positiveNumber(row.unit_cost_krw);
  const sale = Math.round(positiveNumber(row.base_sale_price_krw));
  return cost > 0 && sale > 0 ? `${cost.toFixed(6)}|${sale}` : "";
}

function sameCanonicalValues(rows: CanonicalPriceRow[]) {
  if (!rows.length) return false;
  const signatures = new Set(rows.map(canonicalValueSignature).filter(Boolean));
  return signatures.size === 1 && rows.every((row) => Boolean(canonicalValueSignature(row)));
}

function optionSaleKey(option: UnknownRecord) {
  return legacySeoCanonicalOptionKey(
    record(option.option_payload).saleOption ?? option.sale_option,
  );
}

function canonicalRowKey(row: CanonicalPriceRow) {
  return row.option_key || legacySeoCanonicalOptionKey(row.sale_option);
}

function canonicalCandidateSummaries(rows: CanonicalPriceRow[]) {
  const seen = new Set<string>();
  return rows
    .map((row) => ({
      productName: text(row.product_name),
      saleOption: text(row.sale_option),
    }))
    .filter((row) => {
      const identity = `${row.productName}\u0000${row.saleOption}`;
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    })
    .slice(0, 20);
}

function canonicalQueryModels(modelNumbers: string[]) {
  const values = new Set(modelNumbers);
  for (const modelNumber of modelNumbers) {
    for (const sourceModel of CANONICAL_MODEL_SOURCE_RULES[modelNumber]?.sourceModels ?? []) {
      values.add(sourceModel);
    }
  }
  return [...values];
}

function uniqueUniformResidualCanonicalRow(
  option: UnknownRecord,
  options: UnknownRecord[],
  activeRows: CanonicalPriceRow[],
) {
  // This fallback is intentionally narrow. It only resolves one renamed/typo option
  // when every other option name matches exactly and every canonical row has the same
  // confirmed cost and final sale price. The canonical ledger itself is never edited.
  if (
    options.length < 2 ||
    activeRows.length !== options.length ||
    !sameCanonicalValues(activeRows)
  ) {
    return null;
  }

  const optionKeys = options.map(optionSaleKey);
  const canonicalKeys = activeRows.map(canonicalRowKey);
  if (optionKeys.some((key) => !key) || canonicalKeys.some((key) => !key)) return null;
  if (
    new Set(optionKeys).size !== optionKeys.length ||
    new Set(canonicalKeys).size !== canonicalKeys.length
  ) {
    return null;
  }

  const optionKeySet = new Set(optionKeys);
  const canonicalKeySet = new Set(canonicalKeys);
  const unmatchedOptionKeys = optionKeys.filter((key) => !canonicalKeySet.has(key));
  const unmatchedCanonicalRows = activeRows.filter(
    (row) => !optionKeySet.has(canonicalRowKey(row)),
  );
  if (unmatchedOptionKeys.length !== 1 || unmatchedCanonicalRows.length !== 1) {
    return null;
  }

  return optionSaleKey(option) === unmatchedOptionKeys[0]
    ? unmatchedCanonicalRows[0]
    : null;
}

function uniqueProductNameMatch(
  rows: CanonicalPriceRow[],
  itemProductName: string,
) {
  const itemKey = legacySeoCanonicalOptionKey(itemProductName);
  if (!itemKey) return null;
  const exact = rows.filter(
    (row) => legacySeoCanonicalOptionKey(row.product_name) === itemKey,
  );
  if (exact.length === 1) return exact[0];
  const contains = rows.filter((row) => {
    const rowKey = legacySeoCanonicalOptionKey(row.product_name);
    return Boolean(rowKey) && (rowKey.includes(itemKey) || itemKey.includes(rowKey));
  });
  return contains.length === 1 ? contains[0] : null;
}

async function readActiveBatch(
  config: ProductLaunchAdminConfig,
  ownerId: string,
): Promise<CanonicalBatch | null> {
  const params = new URLSearchParams({
    select:
      "import_batch_id,source_revision,source_workbook,source_sheet,expected_row_count,imported_row_count",
    owner_id: `eq.${ownerId}`,
    is_active: "eq.true",
    status: "eq.ready",
    order: "updated_at.desc",
    limit: "1",
  });
  const { body } = await readProductLaunchStorageJson(
    `${config.supabaseUrl}/rest/v1/${BATCH_TABLE}?${params.toString()}`,
    {
      headers: createSupabaseAdminHeaders(config.secretKey),
      cache: "no-store",
    },
  );
  const row = Array.isArray(body) ? record(body[0]) : {};
  if (!text(row.import_batch_id)) return null;
  return {
    import_batch_id: text(row.import_batch_id),
    source_revision: text(row.source_revision),
    source_workbook: text(row.source_workbook),
    source_sheet: text(row.source_sheet),
    expected_row_count: Math.max(0, Math.floor(Number(row.expected_row_count) || 0)),
    imported_row_count: Math.max(0, Math.floor(Number(row.imported_row_count) || 0)),
  };
}

async function readCanonicalRows(
  config: ProductLaunchAdminConfig,
  ownerId: string,
  batchId: string,
  modelNumbers: string[],
): Promise<CanonicalPriceRow[]> {
  if (!modelNumbers.length) return [];
  const queryModels = canonicalQueryModels(modelNumbers);
  const params = new URLSearchParams({
    select:
      "canonical_price_id,import_batch_id,source_row_index,model_number,product_name,sale_option,option_key,unit_cost_krw,base_sale_price_krw,price_status,confidence,cost_basis_date,cost_source_sheet,confirmation_reason",
    owner_id: `eq.${ownerId}`,
    import_batch_id: `eq.${batchId}`,
    model_number: `in.(${postgrestIn(queryModels)})`,
    order: "source_row_index.asc.nullslast,created_at.asc",
    limit: "5000",
  });
  const { body } = await readProductLaunchStorageJson(
    `${config.supabaseUrl}/rest/v1/${PRICE_TABLE}?${params.toString()}`,
    {
      headers: createSupabaseAdminHeaders(config.secretKey),
      cache: "no-store",
    },
  );
  const rawRows = (Array.isArray(body) ? body : []).map((value) => {
    const row = record(value);
    const sourceModelNumber = modelKey(row.model_number);
    return {
      canonical_price_id: text(row.canonical_price_id),
      import_batch_id: text(row.import_batch_id),
      source_row_index:
        row.source_row_index === null || row.source_row_index === undefined
          ? null
          : Number(row.source_row_index),
      model_number: sourceModelNumber,
      source_model_number: sourceModelNumber,
      product_name: text(row.product_name),
      sale_option: text(row.sale_option),
      option_key: text(row.option_key) || legacySeoCanonicalOptionKey(row.sale_option),
      unit_cost_krw: row.unit_cost_krw as number | string | null,
      base_sale_price_krw: row.base_sale_price_krw as number | string | null,
      price_status: text(row.price_status),
      confidence: text(row.confidence),
      cost_basis_date: text(row.cost_basis_date) || null,
      cost_source_sheet: text(row.cost_source_sheet),
      confirmation_reason: text(row.confirmation_reason),
    };
  });
  const rowsBySourceModel = new Map<string, CanonicalPriceRow[]>();
  for (const row of rawRows) {
    const list = rowsBySourceModel.get(row.source_model_number) ?? [];
    list.push(row);
    rowsBySourceModel.set(row.source_model_number, list);
  }

  const rows: CanonicalPriceRow[] = [];
  for (const modelNumber of modelNumbers) {
    const rule = CANONICAL_MODEL_SOURCE_RULES[modelNumber];
    const directRows = rule?.mode === "replace"
      ? []
      : (rowsBySourceModel.get(modelNumber) ?? []);
    rows.push(...directRows);
    const claimedKeys = new Set(directRows.map(canonicalRowKey).filter(Boolean));
    for (const sourceModel of rule?.sourceModels ?? []) {
      for (const sourceRow of rowsBySourceModel.get(sourceModel) ?? []) {
        const key = canonicalRowKey(sourceRow);
        if (rule?.mode === "supplement" && key && claimedKeys.has(key)) continue;
        if (key) claimedKeys.add(key);
        rows.push({ ...sourceRow, model_number: modelNumber });
      }
    }
  }
  return rows;
}

function matchCanonicalRow(
  option: UnknownRecord,
  activeRows: CanonicalPriceRow[],
  optionCount: number,
  itemProductName: string,
  modelNumber: string,
) {
  const saleOption = text(record(option.option_payload).saleOption ?? option.sale_option);
  const key = legacySeoCanonicalOptionKey(saleOption);
  const exact = activeRows.filter(
    (row) => (row.option_key || legacySeoCanonicalOptionKey(row.sale_option)) === key,
  );
  if (exact.length === 1) return { row: exact[0], reason: "" };
  if (exact.length > 1) {
    if (sameCanonicalValues(exact)) {
      return { row: exact[0], reason: "" };
    }
    const exactProduct = uniqueProductNameMatch(exact, itemProductName);
    if (exactProduct) return { row: exactProduct, reason: "" };
    return {
      row: null,
      reason: "중국주문 최종가격 옵션이 중복되고 원가/판매가가 달라 자동 매칭할 수 없음",
    };
  }

  const aliasKeys = CANONICAL_OPTION_KEY_ALIASES[modelNumber]?.[key] ?? [];
  if (aliasKeys.length) {
    const aliasMatches = activeRows.filter((row) => aliasKeys.includes(canonicalRowKey(row)));
    if (aliasMatches.length === 1) {
      return {
        row: aliasMatches[0],
        reason: "",
        matchAudit: {
          method: "known_legacy_option_alias" as const,
          currentSaleOption: saleOption,
          canonicalSaleOption: aliasMatches[0].sale_option,
        },
      };
    }
  }

  const itemKey = legacySeoCanonicalOptionKey(itemProductName);
  const productNameAffixMatches = activeRows.filter((row) => {
    const rowProductKey = legacySeoCanonicalOptionKey(row.product_name);
    return Boolean(itemKey && key && rowProductKey === `${itemKey}${key}`);
  });
  if (productNameAffixMatches.length === 1) {
    return {
      row: productNameAffixMatches[0],
      reason: "",
      matchAudit: {
        method: "unique_product_name_option_affix" as const,
        currentSaleOption: saleOption,
        canonicalSaleOption: productNameAffixMatches[0].sale_option,
      },
    };
  }

  const productMatch = uniqueProductNameMatch(activeRows, itemProductName);
  if (productMatch && optionCount === 1) {
    return { row: productMatch, reason: "" };
  }
  if (optionCount === 1 && activeRows.length === 1) {
    return { row: activeRows[0], reason: "" };
  }
  if (optionCount === 1 && sameCanonicalValues(activeRows)) {
    return { row: activeRows[0], reason: "" };
  }
  return { row: null, reason: "중국주문 최종가격에서 동일 옵션을 찾지 못함" };
}

function bijectiveAffixResidualCanonicalRows(
  options: UnknownRecord[],
  activeRows: CanonicalPriceRow[],
  itemProductName: string,
  modelNumber: string,
) {
  // Deliberately fail closed. This is not fuzzy matching: it only accepts a full
  // one-to-one residual mapping where every unmatched normalized option name is a
  // unique prefix/suffix extension of exactly one unused canonical option name.
  const directMatches = options.map((option) =>
    matchCanonicalRow(option, activeRows, options.length, itemProductName, modelNumber),
  );
  const unmatchedOptions = options.filter((_, index) => !directMatches[index]?.row);
  if (!unmatchedOptions.length) return new Map<string, CanonicalPriceRow>();

  const usedCanonicalIds = new Set(
    directMatches
      .map((matched) => matched.row?.canonical_price_id)
      .filter((value): value is string => Boolean(value)),
  );
  const residualRows = activeRows.filter(
    (row) => !usedCanonicalIds.has(row.canonical_price_id),
  );
  if (residualRows.length !== unmatchedOptions.length) {
    return new Map<string, CanonicalPriceRow>();
  }

  const mapping = new Map<string, CanonicalPriceRow>();
  const claimedCanonicalIds = new Set<string>();
  for (const option of unmatchedOptions) {
    const optionId = text(option.option_id);
    const currentKey = optionSaleKey(option);
    if (!optionId || currentKey.length < 2) {
      return new Map<string, CanonicalPriceRow>();
    }
    const candidates = residualRows.filter((row) => {
      const canonicalKey = canonicalRowKey(row);
      if (!canonicalKey || canonicalKey === currentKey || canonicalKey.length < 2) {
        return false;
      }
      return canonicalKey.endsWith(currentKey) || currentKey.endsWith(canonicalKey);
    });
    if (candidates.length !== 1) {
      return new Map<string, CanonicalPriceRow>();
    }
    const candidate = candidates[0];
    if (claimedCanonicalIds.has(candidate.canonical_price_id)) {
      return new Map<string, CanonicalPriceRow>();
    }
    claimedCanonicalIds.add(candidate.canonical_price_id);
    mapping.set(optionId, candidate);
  }

  return mapping.size === unmatchedOptions.length
    ? mapping
    : new Map<string, CanonicalPriceRow>();
}

async function patchOptionPrice(
  config: ProductLaunchAdminConfig,
  ownerId: string,
  option: UnknownRecord,
  canonical: CanonicalPriceRow,
  batch: CanonicalBatch,
  matchAudit?: CanonicalMatchAudit,
) {
  const exactUnitCost = positiveNumber(canonical.unit_cost_krw);
  const finalSalePrice = Math.round(positiveNumber(canonical.base_sale_price_krw));
  if (exactUnitCost <= 0 || finalSalePrice <= 0) {
    throw new Error("중국주문 최종가격 원가/판매가가 0원입니다.");
  }
  const integerUnitCost = Math.round(exactUnitCost);
  const payload = {
    ...record(option.option_payload),
    unitCostKrw: integerUnitCost,
    baseSalePriceKrw: finalSalePrice,
    canonicalChinaPrice: {
      source: "china_order_final_confirmed_v4",
      sourceRevision: batch.source_revision,
      sourceWorkbook: batch.source_workbook,
      sourceSheet: batch.source_sheet,
      sourceRowIndex: canonical.source_row_index,
      canonicalPriceId: canonical.canonical_price_id,
      canonicalModelNumber: canonical.source_model_number,
      productName: canonical.product_name,
      saleOption: canonical.sale_option,
      unitCostKrwExact: exactUnitCost,
      unitCostKrwMirror: integerUnitCost,
      finalSalePriceKrw: finalSalePrice,
      confidence: canonical.confidence,
      costBasisDate: canonical.cost_basis_date,
      costSourceSheet: canonical.cost_source_sheet,
      confirmationReason: canonical.confirmation_reason,
      ...(matchAudit
        ? {
            matchMethod: matchAudit.method,
            currentSaleOption: matchAudit.currentSaleOption,
            canonicalSaleOption: matchAudit.canonicalSaleOption,
          }
        : {}),
      appliedAt: new Date().toISOString(),
    },
  };
  const params = new URLSearchParams({
    owner_id: `eq.${ownerId}`,
    item_id: `eq.${text(option.item_id)}`,
    option_id: `eq.${text(option.option_id)}`,
  });
  await readProductLaunchStorageJson(
    `${config.supabaseUrl}/rest/v1/${OPTION_TABLE}?${params.toString()}`,
    {
      method: "PATCH",
      headers: {
        ...createSupabaseAdminHeaders(config.secretKey),
        Prefer: "return=minimal",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        unit_cost_krw: integerUnitCost,
        base_sale_price_krw: finalSalePrice,
        option_payload: payload,
        updated_at: new Date().toISOString(),
      }),
      cache: "no-store",
    },
  );
}

async function runInChunks(tasks: Array<() => Promise<void>>) {
  for (let index = 0; index < tasks.length; index += PATCH_CONCURRENCY) {
    await Promise.all(tasks.slice(index, index + PATCH_CONCURRENCY).map((task) => task()));
  }
}

export async function applyLegacySeoCanonicalPrices(input: {
  config: ProductLaunchAdminConfig;
  identity: ProductLaunchIdentity;
  modelNumbers: string[];
}) {
  const requested = [...new Set(input.modelNumbers.map(modelKey).filter(Boolean))].slice(0, 100);
  const batch = await readActiveBatch(input.config, input.identity.userId);
  if (!requested.length) {
    return {
      batchReady: Boolean(batch),
      batch,
      requestedCount: 0,
      appliedOptionCount: 0,
      unresolvedCount: 0,
      results: [] as LegacySeoCanonicalPriceItemResult[],
    };
  }
  if (!batch || batch.expected_row_count <= 0 || batch.imported_row_count < batch.expected_row_count) {
    const reason = batch
      ? `중국주문 최종가격 원장 적재 미완료 (${batch.imported_row_count}/${batch.expected_row_count})`
      : "중국주문 최종가격 원장이 아직 적재되지 않음";
    return {
      batchReady: false,
      batch,
      requestedCount: requested.length,
      appliedOptionCount: 0,
      unresolvedCount: requested.length,
      results: requested.map((modelNumber) => ({
        itemId: "",
        modelNumber,
        excluded: false,
        excludedReason: "",
        optionCount: 0,
        appliedCount: 0,
        unresolved: [{ itemId: "", modelNumber, saleOption: "", reason }],
      })),
    };
  }

  const itemParams = new URLSearchParams({
    select: "item_id,model_number,product_name,item_payload",
    owner_id: `eq.${input.identity.userId}`,
    shopling_upload_status: "eq.완료",
    archived_at: "is.null",
    model_number: `in.(${postgrestIn(requested)})`,
    limit: "500",
  });
  const { body: itemBody } = await readProductLaunchStorageJson(
    `${input.config.supabaseUrl}/rest/v1/${ITEM_TABLE}?${itemParams.toString()}`,
    {
      headers: createSupabaseAdminHeaders(input.config.secretKey),
      cache: "no-store",
    },
  );
  const items = (Array.isArray(itemBody) ? itemBody : []).map(record);
  const itemIds = items.map((item) => text(item.item_id)).filter(Boolean);
  const rows = await readCanonicalRows(
    input.config,
    input.identity.userId,
    batch.import_batch_id,
    requested,
  );
  const rowsByModel = new Map<string, CanonicalPriceRow[]>();
  for (const row of rows) {
    const list = rowsByModel.get(row.model_number) ?? [];
    list.push(row);
    rowsByModel.set(row.model_number, list);
  }

  const optionsByItem = new Map<string, UnknownRecord[]>();
  if (itemIds.length) {
    const optionParams = new URLSearchParams({
      select:
        "item_id,option_id,option_index,sale_option,barcode,base_sale_price_krw,unit_cost_krw,option_payload,option_barcode_no",
      owner_id: `eq.${input.identity.userId}`,
      item_id: `in.(${postgrestIn(itemIds)})`,
      order: "item_id.asc,option_index.asc",
      limit: "5000",
    });
    const { body: optionBody } = await readProductLaunchStorageJson(
      `${input.config.supabaseUrl}/rest/v1/${OPTION_TABLE}?${optionParams.toString()}`,
      {
        headers: createSupabaseAdminHeaders(input.config.secretKey),
        cache: "no-store",
      },
    );
    for (const value of Array.isArray(optionBody) ? optionBody : []) {
      const option = record(value);
      const itemId = text(option.item_id);
      const list = optionsByItem.get(itemId) ?? [];
      list.push(option);
      optionsByItem.set(itemId, list);
    }
  }

  const tasks: Array<() => Promise<void>> = [];
  const results: LegacySeoCanonicalPriceItemResult[] = [];
  let appliedOptionCount = 0;
  for (const item of items) {
    const itemId = text(item.item_id);
    const modelNumber = modelKey(item.model_number);
    const modelRows = rowsByModel.get(modelNumber) ?? [];
    const activeRows = modelRows.filter(activePriceRow);
    const options = optionsByItem.get(itemId) ?? [];
    const excluded = activeRows.length === 0 && modelRows.some(discontinuedPriceRow);
    const excludedReason = excluded ? "중국주문 최종확정표에서 단종/적용제외" : "";
    const unresolved: LegacySeoCanonicalPriceIssue[] = [];
    const authoritativeOptions = options.filter((option) =>
      legacySeoPriceAuthorityConfirmed(item, option),
    );
    const optionsNeedingCanonical = options.filter(
      (option) => !legacySeoPriceAuthorityConfirmed(item, option),
    );
    let appliedCount = authoritativeOptions.length;
    appliedOptionCount += authoritativeOptions.length;

    if (!excluded && !activeRows.length && optionsNeedingCanonical.length) {
      unresolved.push({
        itemId,
        modelNumber,
        saleOption: "",
        reason: "중국주문 최종확정표에 적용대상 가격이 없음",
      });
    }
    if (!excluded && !options.length) {
      unresolved.push({
        itemId,
        modelNumber,
        saleOption: "",
        reason: "Shopling 동기화 옵션이 없어 가격을 연결할 수 없음",
      });
    }

    if (!excluded && activeRows.length && optionsNeedingCanonical.length) {
      const affixResidualByOption = bijectiveAffixResidualCanonicalRows(
        optionsNeedingCanonical,
        activeRows,
        text(item.product_name),
        modelNumber,
      );
      for (const option of optionsNeedingCanonical) {
        const saleOption = text(record(option.option_payload).saleOption ?? option.sale_option);
        const matched = matchCanonicalRow(
          option,
          activeRows,
          optionsNeedingCanonical.length,
          text(item.product_name),
          modelNumber,
        );
        let canonical = matched.row;
        let matchAudit: CanonicalMatchAudit | undefined = matched.matchAudit;
        if (!canonical) {
          const affixResidual = affixResidualByOption.get(text(option.option_id));
          if (affixResidual) {
            canonical = affixResidual;
            matchAudit = {
              method: "bijective_affix_option_name",
              currentSaleOption: saleOption,
              canonicalSaleOption: affixResidual.sale_option,
            };
          }
        }
        if (!canonical) {
          const residual = uniqueUniformResidualCanonicalRow(
            option,
            optionsNeedingCanonical,
            activeRows,
          );
          if (residual) {
            canonical = residual;
            matchAudit = {
              method: "uniform_single_residual_name_mismatch",
              currentSaleOption: saleOption,
              canonicalSaleOption: residual.sale_option,
            };
          }
        }
        if (!canonical) {
          unresolved.push({
            itemId,
            modelNumber,
            saleOption,
            reason: matched.reason,
            canonicalCandidates: canonicalCandidateSummaries(activeRows),
          });
          continue;
        }
        if (
          positiveNumber(canonical.unit_cost_krw) <= 0 ||
          positiveNumber(canonical.base_sale_price_krw) <= 0
        ) {
          unresolved.push({
            itemId,
            modelNumber,
            saleOption,
            reason: "중국주문 최종확정표의 원가 또는 판매가가 비어 있음",
          });
          continue;
        }
        appliedCount += 1;
        appliedOptionCount += 1;
        tasks.push(() =>
          patchOptionPrice(
            input.config,
            input.identity.userId,
            option,
            canonical as CanonicalPriceRow,
            batch,
            matchAudit,
          ),
        );
      }
    }

    results.push({
      itemId,
      modelNumber,
      excluded,
      excludedReason,
      optionCount: options.length,
      appliedCount,
      unresolved,
    });
  }
  await runInChunks(tasks);

  const unresolvedCount = results.reduce(
    (sum, result) => sum + result.unresolved.length,
    0,
  );
  return {
    batchReady: true,
    batch,
    requestedCount: requested.length,
    appliedOptionCount,
    unresolvedCount,
    results,
  };
}
