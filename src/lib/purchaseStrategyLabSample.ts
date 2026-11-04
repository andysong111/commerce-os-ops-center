import type { PurchaseStrategyLabRow } from "./purchaseStrategyLab.ts";

type SampleRowOverrides = Partial<PurchaseStrategyLabRow> &
  Pick<PurchaseStrategyLabRow, "barcode" | "name">;

function sampleRow(overrides: SampleRowOverrides): PurchaseStrategyLabRow {
  const recommendedQuantity = overrides.recommendedQuantity ?? 10;
  return {
    barcode: overrides.barcode,
    name: overrides.name,
    modelNo: overrides.modelNo ?? null,
    purchaseStatus: overrides.purchaseStatus ?? "발주 추천",
    originalPurchaseStatus:
      overrides.originalPurchaseStatus ??
      overrides.purchaseStatus ??
      "발주 추천",
    entrySignals: overrides.entrySignals ? [...overrides.entrySignals] : [],
    recommendedQuantity,
    preGateRecommendedQuantity:
      overrides.preGateRecommendedQuantity ?? recommendedQuantity,
    moq: overrides.moq ?? 1,
    cartonQuantity: overrides.cartonQuantity ?? 1,
    unitCostKrw: overrides.unitCostKrw ?? 100,
    priorityScore: overrides.priorityScore ?? 0,
    revenueQualifiedMonthCount:
      overrides.revenueQualifiedMonthCount ?? 1,
    averageMonthlyRevenueKrw: overrides.averageMonthlyRevenueKrw ?? 50_000,
    risingStrength: overrides.risingStrength ?? "NONE",
    permanentlyDiscontinued: overrides.permanentlyDiscontinued ?? false,
    operationallyReady: overrides.operationallyReady ?? true,
    inventoryMode: overrides.inventoryMode ?? "VERIFIED",
  };
}

const rabbitColors = [
  ["BBA2-1", "화이트", 58_810],
  ["BBA2-2", "그레이", 58_810],
  ["BBA2-3", "라이트브라운", 50_000],
  ["BBA3-1", "브라운", 103_960],
  ["BBA3-2", "옐로우", 53_560],
  ["BBA3-3", "핑크", 93_550],
] as const;

/**
 * Local-only visual fallback. These rows reproduce the two production
 * failures reported by the operator without reading or mutating a live Draft.
 * The page must label this as sample data and production must never fall back
 * to it silently.
 */
export function purchaseStrategyLabSampleRows(): PurchaseStrategyLabRow[] {
  return [
    sampleRow({
      barcode: "SAMPLE-PRIOR",
      name: "앞순위 완료월 상품 묶음(샘플)",
      recommendedQuantity: 3_000,
      unitCostKrw: 1_493,
      revenueQualifiedMonthCount: 12,
      averageMonthlyRevenueKrw: 2_500_770,
    }),
    sampleRow({
      barcode: "BAF1-1",
      name: "허리펴는 등스트레칭기구",
      recommendedQuantity: 204,
      unitCostKrw: 1_430,
      revenueQualifiedMonthCount: 1,
      averageMonthlyRevenueKrw: 41_926,
      entrySignals: [
        "MONTHLY_REVENUE_40000",
        "STOCKOUT_DEMAND_RECOVERY",
      ],
    }),
    ...rabbitColors.map(([barcode, color, revenue]) =>
      sampleRow({
        barcode,
        name: `토끼브로치 · ${color}`,
        modelNo: "AAA092",
        purchaseStatus: barcode === "BBA3-3" ? "발주 추천" : "발주 보류",
        originalPurchaseStatus:
          barcode === "BBA3-3" ? "발주 추천" : "발주 보류",
        entrySignals: ["MONTHLY_REVENUE_40000"],
        recommendedQuantity: barcode === "BBA3-3" ? 50 : 0,
        preGateRecommendedQuantity: 50,
        unitCostKrw: 275,
        revenueQualifiedMonthCount: barcode === "BBA3-3" ? 1 : 0,
        averageMonthlyRevenueKrw: revenue,
      }),
    ),
  ];
}

export const PURCHASE_STRATEGY_LAB_SAMPLE_BUDGET_KRW = 4_500_000;
