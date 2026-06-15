import type { ProductMasterImportValidationResult } from "./productMasterImportExport.ts";
import {
  getProductMasterStorage,
  type ProductMasterStorageAdapter,
} from "./productMasterStorage.ts";
import { normalizeProductText } from "./productMasterStore.ts";

export interface ProductMasterImportApplicationResult {
  importedCount: number;
  skippedCount: number;
  skippedExistingModelNos: string[];
  errors: string[];
  totalAttempted: number;
}

/**
 * Applies the valid portion of an import preview to temporary Product Master
 * storage. Existing model numbers are deliberately preserved rather than
 * overwritten.
 */
export function importProductMasterItemsToTemporaryStorage(
  preview: ProductMasterImportValidationResult,
  storage: ProductMasterStorageAdapter = getProductMasterStorage(),
): ProductMasterImportApplicationResult {
  const duplicateModelNos = new Set(
    preview.duplicateModelNos.map(normalizeProductText),
  );
  const seenModelNos = new Set<string>();
  const skippedExistingModelNos: string[] = [];
  const errors: string[] = [];
  let importedCount = 0;
  let skippedValidCount = 0;

  for (const item of preview.validItems) {
    const normalizedModelNo = normalizeProductText(item.modelNo);

    if (
      !normalizedModelNo ||
      duplicateModelNos.has(normalizedModelNo) ||
      seenModelNos.has(normalizedModelNo)
    ) {
      skippedValidCount += 1;
      continue;
    }
    seenModelNos.add(normalizedModelNo);

    if (storage.findByModelNo(item.modelNo)) {
      skippedExistingModelNos.push(item.modelNo);
      skippedValidCount += 1;
      continue;
    }

    try {
      storage.create(item);
      importedCount += 1;
    } catch (error) {
      skippedValidCount += 1;
      errors.push(
        `${item.modelNo}: ${
          error instanceof Error ? error.message : "Unknown import error"
        }`,
      );
    }
  }

  return {
    importedCount,
    skippedCount: preview.invalidRows.length + skippedValidCount,
    skippedExistingModelNos,
    errors,
    totalAttempted: preview.summary.totalRows,
  };
}
