export type FreightParserMode =
  | "labeled-next-line"
  | "labeled-inline"
  | "loose-table"
  | "failed";

export interface FreightParseDiagnostics {
  parserMode: FreightParserMode;
  warnings: string[];
  detectedCounts: {
    lines: number;
    itemLabels: number;
    urls: number;
    quantityLabels: number;
    orderNumbers: number;
  };
}

export interface FreightApplication {
  applicationNo: string;
  items: FreightApplicationItem[];
  diagnostics?: FreightParseDiagnostics;
}

export interface FreightApplicationItem {
  id: string;
  rowNo: number;
  itemName: string;
  optionText: string;
  detailUrl?: string;
  imageUrl?: string;
  localImageUrl?: string;
  selectedImageCandidateUrl?: string;
  pastedImageUrl?: string;
  hsCode?: string;
  unitPrice?: number;
  quantity: number;
  trackingNo?: string;
  orderNo?: string;
  lookupText?: string;
  locationCode?: string;
  modelNo?: string;
  modelName?: string;
  optionName?: string;
  barcode?: string;
  origin?: string;
  displayName?: string;
  matchedModelNo?: string;
  matchedModelName?: string;
  matchedProductNameKo?: string;
  matchedBarcode?: string;
  matchedOriginLabel?: string;
  matchedLabelText?: string;
  matchedImageUrl?: string;
  memo?: string;
}

export interface FreightBarcodeHistoryRecord {
  id: string;
  applicationNo: string;
  createdAt: string;
  updatedAt: string;
  title?: string;
  memo?: string;
  rawText: string;
  items: FreightApplicationItem[];
  version: number;
}
