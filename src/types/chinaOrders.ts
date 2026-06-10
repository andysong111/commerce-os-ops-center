export interface ChinaOrderRow {
  id: string;
  freightGroupId: string;
  modelNo: string;
  modelName: string;
  optionName: string;
  quantity: number;
  unitCostCny: number;
  domesticChinaFreightCny: number;
  internalExchangeRateKrwPerCny: number;
}

export interface ChinaOrderCalculatedRow extends ChinaOrderRow {
  groupTotalQuantity: number;
  groupTotalDomesticChinaFreightCny: number;
  domesticFreightPerUnitCny: number;
  finalUnitCostCny: number;
  finalUnitCostKrw: number;
  totalFinalPurchaseCostKrw: number;
}

export type EditableChinaOrderField = Exclude<
  keyof ChinaOrderRow,
  "id"
>;

export type ChinaOrderWarning =
  | "운임 그룹 필요"
  | "수량 확인"
  | "단가 확인"
  | "환율 확인";
