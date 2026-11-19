export type FreightBundleUnitLedgerUpdate = {
  barcode: string;
  bundleUnit: number;
  updatedAt: string;
};

export type FreightBundleUnitLedgerSkipped = {
  barcode: string;
  reason: "BARCODE_NOT_FOUND";
};

type SaveBundleUnits = (
  updates: FreightBundleUnitLedgerUpdate[],
) => Promise<FreightBundleUnitLedgerUpdate[]>;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error ?? "");
}

export async function saveFreightBundleUnitLedgerUpdates(
  updates: FreightBundleUnitLedgerUpdate[],
  saveBundleUnits: SaveBundleUnits,
): Promise<{
  updates: FreightBundleUnitLedgerUpdate[];
  skipped: FreightBundleUnitLedgerSkipped[];
}> {
  async function saveBatch(batch: FreightBundleUnitLedgerUpdate[]): Promise<{
    updates: FreightBundleUnitLedgerUpdate[];
    skipped: FreightBundleUnitLedgerSkipped[];
  }> {
    try {
      return { updates: await saveBundleUnits(batch), skipped: [] };
    } catch (error) {
      if (!errorMessage(error).startsWith("SKU_BUNDLE_UNIT_BARCODE_NOT_FOUND:")) {
        throw error;
      }
      if (batch.length === 1) {
        return {
          updates: [],
          skipped: [{ barcode: batch[0].barcode, reason: "BARCODE_NOT_FOUND" }],
        };
      }
      const middle = Math.ceil(batch.length / 2);
      const left = await saveBatch(batch.slice(0, middle));
      const right = await saveBatch(batch.slice(middle));
      return {
        updates: [...left.updates, ...right.updates],
        skipped: [...left.skipped, ...right.skipped],
      };
    }
  }

  const result = await saveBatch(updates);
  return {
    updates: result.updates.sort((left, right) =>
      left.barcode.localeCompare(right.barcode),
    ),
    skipped: result.skipped.sort((left, right) =>
      left.barcode.localeCompare(right.barcode),
    ),
  };
}
