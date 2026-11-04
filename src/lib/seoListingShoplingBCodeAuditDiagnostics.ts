type UnknownRecord = Record<string, unknown>;

const DIAGNOSTIC_LIMIT = 20;
const GOODS_KEY = /^\d+$/;
const B_CODE = /^B[A-Z]{1,2}\d+-\d+$/;

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function code(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

function uniqueRows<T>(rows: T[], identity: (row: T) => string) {
  const output = new Map<string, T>();
  for (const row of rows) output.set(identity(row), row);
  return [...output.values()];
}

export function buildSeoListingShoplingBCodeAuditDiagnostics(input: {
  targetLaunchItemIds: string[];
  existingLifecycleRows: UnknownRecord[];
  launchItems: UnknownRecord[];
  launchOptions: UnknownRecord[];
  catalogRows: UnknownRecord[];
  marketLedgerRows: UnknownRecord[];
}) {
  const auditableIds = new Set(
    input.existingLifecycleRows
      .map((row) => text(row.launch_item_id))
      .filter(Boolean),
  );
  const targetIds = [
    ...new Set(input.targetLaunchItemIds.map(text).filter(Boolean)),
  ]
    .filter((launchItemId) => auditableIds.has(launchItemId))
    .slice(0, DIAGNOSTIC_LIMIT);

  return targetIds.map((launchItemId) => {
    const lifecycleRows = input.existingLifecycleRows.filter(
      (row) => text(row.launch_item_id) === launchItemId,
    );
    const lifecycleGoodsKeys = new Set(
      lifecycleRows
        .map((row) => text(row.goods_key))
        .filter((goodsKey) => GOODS_KEY.test(goodsKey)),
    );
    const launchItem = input.launchItems.find(
      (row) => text(row.item_id) === launchItemId,
    );
    const launchOptionRows = input.launchOptions.filter(
      (row) => text(row.item_id) === launchItemId,
    );
    const launchBCodes = new Set(
      launchOptionRows
        .map((row) => code(row.barcode))
        .filter((barcode) => B_CODE.test(barcode)),
    );
    const shoplingRows = input.catalogRows
      .flatMap((row) => {
        const goodsKey = text(row.goods_key);
        const lifecycleMatch = lifecycleGoodsKeys.has(goodsKey);
        const bCodeMatch = launchBCodes.has(code(row.optPtnOptCd));
        if (!lifecycleMatch && !bCodeMatch) return [];
        return [
          {
            goodsKey,
            matchBasis:
              lifecycleMatch && bCodeMatch
                ? "both"
                : lifecycleMatch
                  ? "lifecycle_goods_key"
                  : "launch_bcode",
            partnerProductCode: text(row.ptn_goods_cd),
            productGroup: text(row.prod_group),
            saleStatus: text(row.sale_status),
            partnerOptionCode: text(row.optPtnOptCd),
          },
        ];
      });
    const marketRows = input.marketLedgerRows
      .filter(
        (row) =>
          text(row.launch_item_id) === launchItemId ||
          lifecycleGoodsKeys.has(text(row.goods_key)),
      )
      .map((row) => ({
        goodsKey: text(row.goods_key),
        launchItemId: text(row.launch_item_id),
        profile: text(row.profile),
        status: text(row.status),
        titleStatus: text(row.title_status),
        marketStatus: text(row.market_status),
      }));

    return {
      launchItemId,
      modelNumber: text(launchItem?.model_number),
      archivedAt: text(launchItem?.archived_at) || null,
      lifecycle: lifecycleRows.map((row) => ({
        profile: text(row.market_account_key),
        state: text(row.state),
        goodsKey: text(row.goods_key),
        requiresReview: row.requires_review === true,
        reviewReason: text(row.review_reason),
        source: text(record(row.evidence).source),
      })),
      launchOptions: launchOptionRows.map((row) => ({
          optionId: text(row.option_id),
          optionName: text(row.option_name),
          barcode: text(row.barcode),
          optionBarcodeNo: text(row.option_barcode_no),
        })),
      shoplingCatalog: uniqueRows(
        shoplingRows,
        (row) =>
          `${row.goodsKey}\u0000${row.matchBasis}\u0000${row.partnerProductCode}\u0000${row.productGroup}\u0000${row.saleStatus}\u0000${row.partnerOptionCode}`,
      ),
      marketLedger: uniqueRows(
        marketRows,
        (row) =>
          `${row.goodsKey}\u0000${row.launchItemId}\u0000${row.profile}\u0000${row.status}\u0000${row.titleStatus}\u0000${row.marketStatus}`,
      ),
    };
  });
}
