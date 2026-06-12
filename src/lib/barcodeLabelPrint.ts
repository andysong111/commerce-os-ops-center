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

function toPositiveNumber(value: unknown): number | undefined {
  if (value === "" || value === null || value === undefined) return undefined;

  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
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

  const detectedBundleMatch = memo.match(/(\d+(?:\.\d+)?)\s*개씩/);
  const detectedBundleUnit = toPositiveNumber(detectedBundleMatch?.[1]);
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
