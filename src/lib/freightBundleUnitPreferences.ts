import type { FreightApplicationItem } from "../types/freightBarcodeRequest.ts";

export const FREIGHT_BUNDLE_UNIT_PREFERENCES_STORAGE_KEY =
  "commerce-os.freightBundleUnitPreferences.v1";
export const FREIGHT_BUNDLE_UNIT_LEDGER_SKIPS_STORAGE_KEY =
  "commerce-os.freightBundleUnitLedgerSkips.v1";

export interface FreightBundleUnitPreference {
  barcode: string;
  bundleUnit: number;
  updatedAt: string;
}

export interface FreightBundleUnitLedgerSkipMarker {
  barcode: string;
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

export function listFreightBundleUnitLedgerSkipMarkers(
  storage: FreightBundleUnitPreferenceStorage | undefined = browserStorage(),
): FreightBundleUnitLedgerSkipMarker[] {
  if (!storage) return [];
  try {
    const parsed: unknown = JSON.parse(
      storage.getItem(FREIGHT_BUNDLE_UNIT_LEDGER_SKIPS_STORAGE_KEY) ?? "[]",
    );
    if (!Array.isArray(parsed)) return [];
    const latestByBarcode = new Map<string, FreightBundleUnitLedgerSkipMarker>();
    for (const value of parsed) {
      if (!value || typeof value !== "object") continue;
      const candidate = value as Partial<FreightBundleUnitLedgerSkipMarker>;
      const barcode = normalizeFreightBundleBarcode(candidate.barcode);
      const updatedAt = candidate.updatedAt ?? "";
      if (!barcode || !Number.isFinite(Date.parse(updatedAt))) continue;
      latestByBarcode.set(barcode, { barcode, updatedAt });
    }
    return [...latestByBarcode.values()].sort((left, right) =>
      left.barcode.localeCompare(right.barcode),
    );
  } catch {
    return [];
  }
}

export function reconcileFreightBundleUnitLedgerSkipMarkers(
  attempted: FreightBundleUnitPreference[],
  storedBarcodes: unknown[],
  skippedBarcodes: unknown[],
  storage: FreightBundleUnitPreferenceStorage | undefined = browserStorage(),
): FreightBundleUnitLedgerSkipMarker[] {
  if (!storage) return [];
  const stored = new Set(storedBarcodes.map(normalizeFreightBundleBarcode).filter(Boolean));
  const skipped = new Set(skippedBarcodes.map(normalizeFreightBundleBarcode).filter(Boolean));
  const attemptedByBarcode = new Map(
    attempted.map((preference) => [preference.barcode, preference] as const),
  );
  const next = new Map(
    listFreightBundleUnitLedgerSkipMarkers(storage)
      .filter((marker) => !stored.has(marker.barcode))
      .map((marker) => [marker.barcode, marker] as const),
  );
  for (const barcode of skipped) {
    const preference = attemptedByBarcode.get(barcode);
    if (preference) {
      next.set(barcode, { barcode, updatedAt: preference.updatedAt });
    }
  }
  const markers = [...next.values()].sort((left, right) =>
    left.barcode.localeCompare(right.barcode),
  );
  storage.setItem(
    FREIGHT_BUNDLE_UNIT_LEDGER_SKIPS_STORAGE_KEY,
    JSON.stringify(markers),
  );
  return markers;
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
    preferences.map((preference) => [preference.barcode, preference] as const),
  );
  return items.map((item) => {
    const preference = byBarcode.get(normalizeFreightBundleBarcode(item.barcode));
    if (!preference) return item;
    const remoteTime = Date.parse(item.bundleUnitUpdatedAt ?? "");
    const localTime = Date.parse(preference.updatedAt);
    if (Number.isFinite(remoteTime) && remoteTime > localTime) return item;
    return {
      ...item,
      bundleUnit: preference.bundleUnit,
      bundleUnitUpdatedAt: preference.updatedAt,
    };
  });
}
