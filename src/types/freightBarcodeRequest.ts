export interface FreightApplication {
  applicationNo: string;
  items: FreightApplicationItem[];
}

export interface FreightApplicationItem {
  id: string;
  rowNo: number;
  itemName: string;
  optionText: string;
  detailUrl?: string;
  hsCode?: string;
  unitPrice?: number;
  quantity: number;
  trackingNo?: string;
  orderNo?: string;
  lookupText?: string;
  matchedModelNo?: string;
  matchedModelName?: string;
  matchedProductNameKo?: string;
  matchedBarcode?: string;
  matchedOriginLabel?: string;
  matchedLabelText?: string;
  matchedImageUrl?: string;
  memo?: string;
}
