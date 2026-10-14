import { isSourcingReceiptPending } from "./sourcingReceiptGate.ts";

type UnknownRecord = Record<string, unknown>;

export type ProductLaunchSeoMaterialReadiness = {
  ready: boolean;
  errorCount: number;
  warningCount: number;
  errors: string[];
  warnings: string[];
  receiptPending: boolean;
};

const OPTION_BARCODE_NO_PATTERN = /^(?:OB)?\d{12}$/;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function code(value: unknown) {
  return text(value).toUpperCase().replace(/[^A-Z0-9_-]/g, "");
}

function optionsFrom(item: UnknownRecord) {
  const options = Array.isArray(item.orderOptions)
    ? item.orderOptions.map(record)
    : [];
  const rowBarcode = code(item.barcode || item.warehouseLocation);
  return options.map((option) => ({
    ...option,
    optionName: text(option.optionName) || "옵션",
    saleOption: text(option.saleOption ?? option.value),
    barcode: code(option.barcode) || (options.length === 1 ? rowBarcode : ""),
    optionBarcodeNo: text(option.optionBarcodeNo).toUpperCase(),
    baseSalePriceKrw: Number(option.baseSalePriceKrw),
    unitCostKrw: Number(option.unitCostKrw),
  }));
}

export function productLaunchSeoMaterialReadiness(
  itemInput: unknown,
): ProductLaunchSeoMaterialReadiness {
  const item = record(itemInput);
  const errors: string[] = [];
  const warnings: string[] = [];
  const receiptPending = isSourcingReceiptPending(item);
  const options = optionsFrom(item);

  if (receiptPending) errors.push("신규소싱 상품의 입고확정이 필요합니다.");
  if (!text(item.id)) errors.push("출시 상품 ID가 없습니다.");
  if (!text(item.modelNumber)) errors.push("모델번호가 없습니다.");
  if (!text(item.productName)) errors.push("모델명이 없습니다.");
  if (!text(item.shoplingCategory)) errors.push("샵플링 표준 카테고리가 없습니다.");
  if (!text(item.selfCodeBase)) errors.push("자사상품 기본코드가 없습니다.");

  const detailPage = record(item.detailPageAsset);
  if (!text(detailPage.html)) errors.push("상세페이지 HTML이 없습니다.");
  if (!text(detailPage.mainImageUrl)) errors.push("대표이미지가 없습니다.");
  if (!options.length) errors.push("발주·입고 옵션가격이 없습니다.");

  const seenBarcodes = new Set<string>();
  const seenOptionBarcodeNos = new Set<string>();
  for (const [index, option] of options.entries()) {
    const optionLabel = option.saleOption || `${index + 1}번째 옵션`;
    if (!option.saleOption) errors.push(`${index + 1}번째 옵션값이 없습니다.`);
    if (!option.barcode) errors.push(`${optionLabel} B코드가 없습니다.`);
    if (!OPTION_BARCODE_NO_PATTERN.test(option.optionBarcodeNo)) {
      errors.push(`${optionLabel} 옵션바코드NO는 숫자 12자리여야 합니다.`);
    }
    if (!(option.baseSalePriceKrw > 0)) {
      errors.push(`${optionLabel} 기준 판매가가 없습니다.`);
    }
    if (!(option.unitCostKrw > 0)) {
      warnings.push(`${optionLabel} 매입가가 없습니다.`);
    }
    if (option.barcode) {
      if (seenBarcodes.has(option.barcode)) {
        errors.push(`옵션 B코드 ${option.barcode}가 중복되었습니다.`);
      }
      seenBarcodes.add(option.barcode);
    }
    if (option.optionBarcodeNo) {
      const comparableNo = option.optionBarcodeNo.replace(/^OB/, "");
      if (seenOptionBarcodeNos.has(comparableNo)) {
        errors.push(`옵션바코드NO ${comparableNo}가 중복되었습니다.`);
      }
      seenOptionBarcodeNos.add(comparableNo);
    }
  }

  if (new Set(options.map((option) => option.optionName)).size > 1) {
    errors.push("샵플링 자동등록은 한 종류의 옵션명만 지원합니다.");
  }

  const uniqueErrors = [...new Set(errors)];
  const uniqueWarnings = [...new Set(warnings)];
  return {
    ready: uniqueErrors.length === 0,
    errorCount: uniqueErrors.length,
    warningCount: uniqueWarnings.length,
    errors: uniqueErrors,
    warnings: uniqueWarnings,
    receiptPending,
  };
}
