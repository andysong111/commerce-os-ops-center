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
  bundleUnit?: number;
  labelPrintCount?: number;
  labelTemplate?: "auto" | "small" | "large";
}

export type FreightBarcodeHistorySource =
  | "manual-paste"
  | "restored-history";

export type FreightBarcodeProductMasterMatch = Pick<
  FreightApplicationItem,
  | "matchedModelNo"
  | "matchedModelName"
  | "matchedProductNameKo"
  | "matchedBarcode"
  | "matchedOriginLabel"
  | "matchedLabelText"
  | "matchedImageUrl"
> & {
  itemId: string;
};

export interface FreightBarcodeHistoryRecord {
  id: string;
  applicationNo: string;
  title: string;
  rawText: string;
  parsedItems: FreightApplicationItem[];
  productMasterMatches: FreightBarcodeProductMasterMatch[];
  memo: string;
  createdAt: string;
  updatedAt: string;
  source: FreightBarcodeHistorySource;
  pdfVersion: number;
  itemCount: number;
  matchedItemCount: number;
  /** @deprecated Local-history compatibility alias. Use parsedItems. */
  items: FreightApplicationItem[];
  /** @deprecated Local-history compatibility alias. Use pdfVersion. */
  version: number;
}
