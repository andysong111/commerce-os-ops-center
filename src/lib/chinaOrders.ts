import type {
  ChinaOrderCalculatedRow,
  ChinaOrderRow,
  ChinaOrderWarning,
} from "@/types/chinaOrders";

export const SAMPLE_CHINA_ORDERS: ChinaOrderRow[] = [
  {
    id: "sample-1",
    freightGroupId: "20260601-001",
    modelNo: "aaa270",
    modelName: "말발굽 고리링",
    optionName: "골드",
    quantity: 200,
    unitCostCny: 0.35,
    domesticChinaFreightCny: 10,
    internalExchangeRateKrwPerCny: 235,
  },
  {
    id: "sample-2",
    freightGroupId: "20260601-001",
    modelNo: "aaa270",
    modelName: "말발굽 고리링",
    optionName: "실버",
    quantity: 200,
    unitCostCny: 0.35,
    domesticChinaFreightCny: 0,
    internalExchangeRateKrwPerCny: 235,
  },
  {
    id: "sample-3",
    freightGroupId: "20260601-001",
    modelNo: "aaa270",
    modelName: "말발굽 고리링",
    optionName: "블랙",
    quantity: 200,
    unitCostCny: 0.35,
    domesticChinaFreightCny: 0,
    internalExchangeRateKrwPerCny: 235,
  },
  {
    id: "sample-4",
    freightGroupId: "20260601-002",
    modelNo: "aaa179",
    modelName: "닭물통 니플형",
    optionName: "단품",
    quantity: 300,
    unitCostCny: 0.61,
    domesticChinaFreightCny: 42,
    internalExchangeRateKrwPerCny: 235,
  },
];

export function createEmptyChinaOrder(id: string): ChinaOrderRow {
  return {
    id,
    freightGroupId: "",
    modelNo: "",
    modelName: "",
    optionName: "",
    quantity: 0,
    unitCostCny: 0,
    domesticChinaFreightCny: 0,
    internalExchangeRateKrwPerCny: 235,
  };
}

export function calculateChinaOrders(
  rows: ChinaOrderRow[],
): ChinaOrderCalculatedRow[] {
  const groupTotals = new Map<
    string,
    { quantity: number; domesticFreightCny: number }
  >();

  for (const row of rows) {
    if (!row.freightGroupId.trim()) continue;

    const totals = groupTotals.get(row.freightGroupId) ?? {
      quantity: 0,
      domesticFreightCny: 0,
    };

    totals.quantity += validNonNegativeNumber(row.quantity);
    totals.domesticFreightCny += validNonNegativeNumber(
      row.domesticChinaFreightCny,
    );
    groupTotals.set(row.freightGroupId, totals);
  }

  return rows.map((row) => {
    const group = groupTotals.get(row.freightGroupId);
    const groupTotalQuantity = group?.quantity ?? 0;
    const groupTotalDomesticChinaFreightCny =
      group?.domesticFreightCny ?? 0;
    const domesticFreightPerUnitCny =
      groupTotalQuantity > 0
        ? groupTotalDomesticChinaFreightCny / groupTotalQuantity
        : 0;
    const finalUnitCostCny =
      validNonNegativeNumber(row.unitCostCny) + domesticFreightPerUnitCny;
    const finalUnitCostKrw =
      finalUnitCostCny *
      validNonNegativeNumber(row.internalExchangeRateKrwPerCny);

    return {
      ...row,
      groupTotalQuantity,
      groupTotalDomesticChinaFreightCny,
      domesticFreightPerUnitCny,
      finalUnitCostCny,
      finalUnitCostKrw,
      totalFinalPurchaseCostKrw:
        finalUnitCostKrw * validNonNegativeNumber(row.quantity),
    };
  });
}

export function getChinaOrderWarnings(
  row: ChinaOrderRow,
): ChinaOrderWarning[] {
  const warnings: ChinaOrderWarning[] = [];

  if (!row.freightGroupId.trim()) warnings.push("운임 그룹 필요");
  if (!Number.isFinite(row.quantity) || row.quantity <= 0)
    warnings.push("수량 확인");
  if (!Number.isFinite(row.unitCostCny) || row.unitCostCny <= 0)
    warnings.push("단가 확인");
  if (
    !Number.isFinite(row.internalExchangeRateKrwPerCny) ||
    row.internalExchangeRateKrwPerCny <= 0
  )
    warnings.push("환율 확인");

  return warnings;
}

function validNonNegativeNumber(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}
