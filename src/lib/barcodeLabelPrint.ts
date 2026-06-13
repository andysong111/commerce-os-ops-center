export interface BarcodeLabelPrintInput {
  quantity: unknown;
  memo?: string;
  bundleUnit?: unknown;
  printCount?: unknown;
}

export interface BarcodeLabelPrintCalculation {
  bundleUnit?: number;
  printCount: number;
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

function detectMemoBundleUnit(memo = ""): number | undefined {
  const detectedBundleMatch = memo.match(/(\d+(?:\.\d+)?)\s*개씩/);
  return toPositiveNumber(detectedBundleMatch?.[1]);
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
  if (validQuantity === undefined) return { printCount: 1 };

  const manualPrintCount = toPositiveNumber(printCount);
  if (manualPrintCount !== undefined) {
    return { printCount: Math.ceil(manualPrintCount) };
  }

  const manualBundleUnit = toPositiveNumber(bundleUnit);
  if (manualBundleUnit !== undefined) {
    return {
      bundleUnit: manualBundleUnit,
      printCount: Math.ceil(validQuantity / manualBundleUnit),
    };
  }

  const detectedBundleUnit = detectMemoBundleUnit(memo);
  if (detectedBundleUnit !== undefined) {
    return {
      bundleUnit: detectedBundleUnit,
      printCount: Math.ceil(validQuantity / detectedBundleUnit),
    };
  }

  if (memo.includes("개별")) {
    return { printCount: Math.ceil(validQuantity) };
  }

  if (memo.includes("박스")) {
    return { printCount: 1 };
  }

  return { printCount: Math.ceil(validQuantity) };
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

export function getTotalBarcodeLabelCount<T extends BarcodeLabelPageInput>(items: T[]): number {
  return buildBarcodeLabelPages(items).length;
}
