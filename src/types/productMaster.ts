export type ProductStatus = "active" | "inactive" | "discontinued";

export interface ProductOption {
  optionId: string;
  optionName: string;
  optionImageUrl?: string;
  referenceUnitCostCny?: number;
  memo?: string;
}

export interface ProductMaster {
  modelNo: string;
  modelName: string;
  category: string;
  mainImageUrl?: string;
  status: ProductStatus;
  memo?: string;
  options: ProductOption[];
}
