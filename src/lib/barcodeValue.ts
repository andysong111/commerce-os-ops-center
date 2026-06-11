export const BARCODE_ORIGIN_LABEL = "MADE IN CHINA";
export const BARCODE_VALUE_PATTERN = /^[A-Z0-9-]+$/;

export function sanitizeBarcodeValue(value: string): string {
  return value.toUpperCase();
}

export function isValidBarcodeValue(value: string): boolean {
  return BARCODE_VALUE_PATTERN.test(value);
}

export function getEncodedBarcodeValue(value?: string): string | null {
  if (!value) return null;

  const sanitizedValue = sanitizeBarcodeValue(value);
  return isValidBarcodeValue(sanitizedValue) ? sanitizedValue : null;
}
