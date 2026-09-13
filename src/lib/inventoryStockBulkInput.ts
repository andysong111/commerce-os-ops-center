import { normalizeInventoryBarcode } from "@/lib/productMasterInventoryIdentity";

export type InventoryStockoutBulkInput = {
  barcodes: string[];
  errors: string[];
};

export type InventoryStocktakeBulkItem = {
  barcode: string;
  baselineQuantity: number;
};

export type InventoryStocktakeBulkInput = {
  items: InventoryStocktakeBulkItem[];
  errors: string[];
};

export function parseInventoryStockoutBulkText(raw: string): InventoryStockoutBulkInput {
  const tokens = String(raw ?? "")
    .split(/[\s,;]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  const barcodes: string[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    const barcode = normalizeInventoryBarcode(token);
    if (!barcode) {
      errors.push(`잘못된 B코드: ${token}`);
      continue;
    }
    if (seen.has(barcode)) continue;
    seen.add(barcode);
    barcodes.push(barcode);
  }
  if (barcodes.length > 50) errors.push("한 번에 최대 50개까지 처리할 수 있습니다.");
  return { barcodes: barcodes.slice(0, 50), errors };
}

export function parseInventoryStocktakeBulkText(raw: string): InventoryStocktakeBulkInput {
  const lines = String(raw ?? "")
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  const items: InventoryStocktakeBulkItem[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  lines.forEach((line, index) => {
    const parts = line.split(/[\s,;:=]+/).filter(Boolean);
    if (parts.length !== 2) {
      errors.push(`${index + 1}행 형식 오류: B코드와 수량을 입력해 주세요.`);
      return;
    }
    const barcode = normalizeInventoryBarcode(parts[0]);
    const baselineQuantity = Number(parts[1]);
    if (!barcode) {
      errors.push(`${index + 1}행 잘못된 B코드: ${parts[0]}`);
      return;
    }
    if (!Number.isInteger(baselineQuantity) || baselineQuantity < 1 || baselineQuantity > 1_000_000) {
      errors.push(`${index + 1}행 수량은 1개 이상의 정수여야 합니다.`);
      return;
    }
    if (seen.has(barcode)) {
      errors.push(`${index + 1}행 중복 B코드: ${barcode}`);
      return;
    }
    seen.add(barcode);
    items.push({ barcode, baselineQuantity });
  });

  if (items.length > 50) errors.push("한 번에 최대 50개까지 처리할 수 있습니다.");
  return { items: items.slice(0, 50), errors };
}
