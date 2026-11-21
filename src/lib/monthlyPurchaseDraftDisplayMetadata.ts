import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import { loadProductLaunchPurchaseMetadataByBarcode } from "@/lib/productLaunchPurchaseMetadata";
import { loadShoplingCurrentModelSnapshot } from "@/lib/shopling/shoplingCurrentModelIdentity";

export type MonthlyDraftDisplayMetadata = {
  barcode: string;
  modelNo: string;
  modelName: string;
  saleOption: string;
  imageUrl?: string;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function barcode(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

function normalizedModelNo(value: unknown, fallback = "") {
  const candidate = text(value);
  return candidate && !/^LEGACY-/i.test(candidate) ? candidate : fallback;
}

export async function loadMonthlyDraftDisplayMetadata(barcodes: string[]) {
  const requested = [
    ...new Set(barcodes.map(barcode).filter((value) => /^[A-Z]{3}\d+-\d+$/.test(value))),
  ].sort();
  const warnings: string[] = [];

  let planning: Awaited<ReturnType<typeof loadProductPlanningSnapshot>> | null = null;
  let tracker: Awaited<
    ReturnType<typeof loadProductLaunchPurchaseMetadataByBarcode>
  > | null = null;

  try {
    planning = await loadProductPlanningSnapshot();
  } catch (error) {
    warnings.push(
      `Product Master 표시정보를 일부 불러오지 못했습니다: ${
        error instanceof Error ? error.message : "UNKNOWN"
      }`,
    );
  }

  try {
    tracker = await loadProductLaunchPurchaseMetadataByBarcode();
    if (tracker.error) warnings.push(`상품출시 구매정보 경고: ${tracker.error}`);
  } catch (error) {
    warnings.push(
      `상품출시 구매정보를 불러오지 못했습니다: ${
        error instanceof Error ? error.message : "UNKNOWN"
      }`,
    );
  }

  const planningByBarcode = new Map(
    (planning?.products ?? [])
      .filter((row) => row.skuActive !== false)
      .map((row) => [barcode(row.barcode), row] as const),
  );

  const goodsKeysByBarcode = new Map<string, string[]>();
  for (const code of requested) {
    const profile = planningByBarcode.get(code);
    const goodsKeys = [
      ...new Set(
        (profile?.listings ?? [])
          .filter((listing) => listing.active !== false)
          .map((listing) => text(listing.goodsKey))
          .filter((goodsKey) => /^\d+$/.test(goodsKey)),
      ),
    ].sort((left, right) => Number(left) - Number(right));
    goodsKeysByBarcode.set(code, goodsKeys);
  }

  const liveByBarcode = new Map<
    string,
    { modelNo: string | null; modelName: string | null }
  >();
  const allGoodsKeys = [...new Set([...goodsKeysByBarcode.values()].flat())];
  if (allGoodsKeys.length) {
    try {
      const live = await loadShoplingCurrentModelSnapshot(allGoodsKeys);
      const byGoodsKey = new Map(live.rows.map((row) => [row.goodsKey, row] as const));
      for (const [code, goodsKeys] of goodsKeysByBarcode) {
        const sourceRows = goodsKeys
          .map((goodsKey) => byGoodsKey.get(goodsKey))
          .filter((row): row is NonNullable<typeof row> => Boolean(row));
        const modelNos = [
          ...new Set(
            sourceRows
              .filter((row) => row.state === "EXACT_AAA")
              .flatMap((row) => row.modelNos.map(text).filter(Boolean)),
          ),
        ];
        const modelNames = [
          ...new Set(
            sourceRows.flatMap((row) => row.modelNames.map(text).filter(Boolean)),
          ),
        ];
        liveByBarcode.set(code, {
          modelNo: modelNos.length === 1 ? modelNos[0] : null,
          modelName: modelNames.length ? modelNames.join(" / ") : null,
        });
      }
    } catch (error) {
      warnings.push(
        `Shopling 모델명 표시정보를 불러오지 못했습니다: ${
          error instanceof Error ? error.message : "UNKNOWN"
        }`,
      );
    }
  }

  const byBarcode: Record<string, MonthlyDraftDisplayMetadata> = {};
  for (const code of requested) {
    const profile = planningByBarcode.get(code);
    const trackerRow = tracker?.byBarcode.get(code);
    const trackerUsable = trackerRow && !trackerRow.conflict ? trackerRow : null;
    const live = liveByBarcode.get(code);
    byBarcode[code] = {
      barcode: code,
      modelNo:
        normalizedModelNo(trackerUsable?.modelNumber) ||
        normalizedModelNo(profile?.modelNo) ||
        normalizedModelNo(live?.modelNo) ||
        "",
      modelName:
        text(trackerUsable?.productName) ||
        text(profile?.productName) ||
        text(live?.modelName) ||
        "",
      saleOption:
        text(trackerUsable?.saleOption) || text(profile?.optionName) || "",
    };
  }

  return { byBarcode, warnings };
}
