export interface BarcodeLabelPrintInput {
  quantity: unknown;
  memo?: string;
  bundleUnit?: unknown;
  printCount?: unknown;
}

export interface BarcodeLabelPrintCalculation {
  bundleUnit?: number;
  printCount: number;
  remainder: number;
  fullBundleCount?: number;
  hasRemainderWarning: boolean;
}

export interface BarcodeLabelPageInput extends BarcodeLabelPrintInput {
  id: string;
  barcode?: string;
}

export interface BarcodeLabelPage<T extends BarcodeLabelPageInput> {
  item: T;
  labelNumber: number;
  printCount: number;
}

function toPositiveNumber(value: unknown): number | undefined {
  if (value === "" || value === null || value === undefined) return undefined;

  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function isIndividualOrBoxMemo(memo = ""): boolean {
  return memo.includes("개별") || memo.includes("박스");
}

function detectMemoBundleUnit(memo = ""): number | undefined {
  const detectedBundleMatch = memo.match(/(\d+(?:\.\d+)?)\s*개씩/);
  return toPositiveNumber(detectedBundleMatch?.[1]);
}


function buildBundleCalculation(
  quantity: number,
  bundleUnit: number,
  memo = "",
): BarcodeLabelPrintCalculation {
  const remainder = isIndividualOrBoxMemo(memo) ? 0 : quantity % bundleUnit;

  return {
    bundleUnit,
    printCount: Math.ceil(quantity / bundleUnit),
    remainder,
    fullBundleCount: Math.floor(quantity / bundleUnit),
    hasRemainderWarning: remainder > 0,
  };
}

/**
 * Calculates how many barcode labels an item needs.
 *
 * Manual print count and bundle-unit values take precedence over memo detection.
 * A non-positive or otherwise invalid quantity always falls back to one label.
 */
export function calculateBarcodeLabelPrint({
  quantity,
  memo = "",
  bundleUnit,
  printCount,
}: BarcodeLabelPrintInput): BarcodeLabelPrintCalculation {
  const validQuantity = toPositiveNumber(quantity);
  if (validQuantity === undefined) {
    return { printCount: 1, remainder: 0, hasRemainderWarning: false };
  }

  const manualPrintCount = toPositiveNumber(printCount);
  if (manualPrintCount !== undefined) {
    return { printCount: Math.ceil(manualPrintCount), remainder: 0, hasRemainderWarning: false };
  }

  const manualBundleUnit = toPositiveNumber(bundleUnit);
  if (manualBundleUnit !== undefined) {
    return buildBundleCalculation(validQuantity, manualBundleUnit, memo);
  }

  const detectedBundleUnit = detectMemoBundleUnit(memo);
  if (detectedBundleUnit !== undefined) {
    return buildBundleCalculation(validQuantity, detectedBundleUnit, memo);
  }

  if (memo.includes("개별")) {
    return { printCount: Math.ceil(validQuantity), remainder: 0, hasRemainderWarning: false };
  }

  if (memo.includes("박스")) {
    return { printCount: 1, remainder: 0, hasRemainderWarning: false };
  }

  return { printCount: Math.ceil(validQuantity), remainder: 0, hasRemainderWarning: false };
}

export function formatBarcodeBundleUnit(input: BarcodeLabelPrintInput): string {
  const manualBundleUnit = toPositiveNumber(input.bundleUnit);
  const bundleUnit = manualBundleUnit ?? detectMemoBundleUnit(input.memo);

  if (bundleUnit !== undefined) return `${bundleUnit}개`;
  if (input.memo?.includes("박스")) return "박스 외부";
  return "개별";
}

export function formatBarcodeLabelQuantity(input: BarcodeLabelPrintInput): string {
  const bundleUnit = formatBarcodeBundleUnit(input);

  if (bundleUnit === "개별") return "개별 부착";
  if (bundleUnit === "박스 외부") return "박스 외부 부착";
  return `${bundleUnit} 1세트`;
}

export function buildBarcodeLabelPages<T extends BarcodeLabelPageInput>(
  items: T[],
): BarcodeLabelPage<T>[] {
  return items.flatMap((item) => {
    if (!item.barcode?.trim()) return [];

    const calculation = calculateBarcodeLabelPrint(item);
    return Array.from({ length: calculation.printCount }, (_, index) => ({
      item,
      labelNumber: index + 1,
      printCount: calculation.printCount,
    }));
  });
}

export function buildSampleBarcodeLabelPages<T extends BarcodeLabelPageInput>(
  items: T[],
): BarcodeLabelPage<T>[] {
  const seenBarcodes = new Set<string>();

  return items.flatMap((item) => {
    const barcode = item.barcode?.trim();
    if (!barcode || seenBarcodes.has(barcode)) return [];

    seenBarcodes.add(barcode);
    return [{ item, labelNumber: 1, printCount: 1 }];
  });
}

export function getTotalBarcodeLabelCount<T extends BarcodeLabelPageInput>(items: T[]): number {
  return buildBarcodeLabelPages(items).length;
}

export function getSampleBarcodeLabelCount<T extends BarcodeLabelPageInput>(items: T[]): number {
  return buildSampleBarcodeLabelPages(items).length;
}
