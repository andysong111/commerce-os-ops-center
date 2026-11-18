import type { FreightApplicationItem } from "../types/freightBarcodeRequest.ts";

export const FREIGHT_BUNDLE_UNIT_PREFERENCES_STORAGE_KEY =
  "commerce-os.freightBundleUnitPreferences.v1";

export interface FreightBundleUnitPreference {
  barcode: string;
  bundleUnit: number;
  updatedAt: string;
}

export interface FreightBundleUnitPreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStorage(): FreightBundleUnitPreferenceStorage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function normalizeFreightBundleBarcode(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

export function isFreightBundleUnitEmpty(
  value: unknown,
): value is null | undefined {
  return value === undefined || value === null;
}

function positiveInteger(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

export function listFreightBundleUnitPreferences(
  storage: FreightBundleUnitPreferenceStorage | undefined = browserStorage(),
): FreightBundleUnitPreference[] {
  if (!storage) return [];
  try {
    const parsed: unknown = JSON.parse(
      storage.getItem(FREIGHT_BUNDLE_UNIT_PREFERENCES_STORAGE_KEY) ?? "[]",
    );
    if (!Array.isArray(parsed)) return [];

    const latestByBarcode = new Map<string, FreightBundleUnitPreference>();
    for (const value of parsed) {
      if (!value || typeof value !== "object") continue;
      const candidate = value as Partial<FreightBundleUnitPreference>;
      const barcode = normalizeFreightBundleBarcode(candidate.barcode);
      const bundleUnit = positiveInteger(candidate.bundleUnit);
      if (!barcode || !bundleUnit || typeof candidate.updatedAt !== "string") continue;
      const current = latestByBarcode.get(barcode);
      if (!current || current.updatedAt <= candidate.updatedAt) {
        latestByBarcode.set(barcode, { barcode, bundleUnit, updatedAt: candidate.updatedAt });
      }
    }
    return [...latestByBarcode.values()].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    );
  } catch {
    return [];
  }
}

export function findFreightBundleUnitPreference(
  barcode: unknown,
  storage: FreightBundleUnitPreferenceStorage | undefined = browserStorage(),
): FreightBundleUnitPreference | undefined {
  const normalized = normalizeFreightBundleBarcode(barcode);
  if (!normalized) return undefined;
  return listFreightBundleUnitPreferences(storage).find(
    (preference) => preference.barcode === normalized,
  );
}

export function saveFreightBundleUnitPreference(
  barcode: unknown,
  bundleUnit: unknown,
  storage: FreightBundleUnitPreferenceStorage | undefined = browserStorage(),
  now = new Date().toISOString(),
): FreightBundleUnitPreference | undefined {
  const normalizedBarcode = normalizeFreightBundleBarcode(barcode);
  const normalizedBundleUnit = positiveInteger(bundleUnit);
  if (!normalizedBarcode || !normalizedBundleUnit || !storage) return undefined;

  const preference = { barcode: normalizedBarcode, bundleUnit: normalizedBundleUnit, updatedAt: now };
  const next = listFreightBundleUnitPreferences(storage).filter(
    (saved) => saved.barcode !== normalizedBarcode,
  );
  next.push(preference);
  next.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  storage.setItem(FREIGHT_BUNDLE_UNIT_PREFERENCES_STORAGE_KEY, JSON.stringify(next));
  return preference;
}

export function applyFreightBundleUnitPreferences(
  items: FreightApplicationItem[],
  preferences: FreightBundleUnitPreference[] = listFreightBundleUnitPreferences(),
): FreightApplicationItem[] {
  const byBarcode = new Map(
    preferences.map((preference) => [preference.barcode, preference.bundleUnit]),
  );
  return items.map((item) => {
    const bundleUnit = byBarcode.get(normalizeFreightBundleBarcode(item.barcode));
    return bundleUnit ? { ...item, bundleUnit } : item;
  });
}
