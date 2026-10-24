type StoredPlanningSnapshot<TProduct> = {
  generatedAt: string;
  contentFingerprint: string;
  products: TProduct[];
};

type OperationRow = {
  status?: unknown;
  input_snapshot?: unknown;
  started_at?: unknown;
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function iso(value: unknown) {
  const parsed = Date.parse(String(value ?? "").trim());
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

/**
 * Selects a recent, self-consistent Product Master snapshot already frozen in
 * a successful live-refresh request. This is only a bounded availability
 * fallback; a stale, incomplete, future-dated, or fingerprint-mismatched row
 * is never accepted.
 */
export function selectRecentStoredPlanningSnapshot<TProduct>(
  rows: OperationRow[],
  options: { now?: Date; maxAgeMs: number },
): StoredPlanningSnapshot<TProduct> | null {
  const nowMs = (options.now ?? new Date()).valueOf();
  if (!Number.isFinite(nowMs) || !Number.isFinite(options.maxAgeMs) || options.maxAgeMs < 0) {
    throw new Error("PRODUCT_MASTER_STORED_FALLBACK_RANGE_INVALID");
  }

  const candidates: Array<StoredPlanningSnapshot<TProduct> & { sourceMs: number }> = [];
  for (const row of rows) {
    if (String(row.status ?? "").trim() !== "SUCCEEDED") continue;
    const input = object(row.input_snapshot);
    const snapshot = object(input.planningSnapshot);
    const planningGeneratedAt = iso(input.planningGeneratedAt);
    const snapshotGeneratedAt = iso(snapshot.generatedAt);
    const planningFingerprint = String(input.planningContentFingerprint ?? "").trim();
    const snapshotFingerprint = String(snapshot.contentFingerprint ?? "").trim();
    const productCount = Number(input.planningProductCount);
    const products = Array.isArray(snapshot.products)
      ? (snapshot.products as TProduct[])
      : [];
    const storedAt = iso(input.createdAt) || iso(row.started_at);
    const sourceMs = Date.parse(snapshotGeneratedAt || "");
    const storedMs = Date.parse(storedAt || "");

    if (
      !planningGeneratedAt ||
      !snapshotGeneratedAt ||
      planningGeneratedAt !== snapshotGeneratedAt ||
      !/^sha256:[a-f0-9]{64}$/.test(planningFingerprint) ||
      planningFingerprint !== snapshotFingerprint ||
      !Number.isSafeInteger(productCount) ||
      productCount < 1 ||
      products.length !== productCount ||
      !Number.isFinite(sourceMs) ||
      !Number.isFinite(storedMs) ||
      sourceMs > nowMs ||
      storedMs > nowMs ||
      nowMs - sourceMs > options.maxAgeMs ||
      nowMs - storedMs > options.maxAgeMs
    ) {
      continue;
    }

    candidates.push({
      generatedAt: snapshotGeneratedAt,
      contentFingerprint: snapshotFingerprint,
      products,
      sourceMs,
    });
  }

  candidates.sort((left, right) => right.sourceMs - left.sourceMs);
  const selected = candidates[0];
  return selected
    ? {
        generatedAt: selected.generatedAt,
        contentFingerprint: selected.contentFingerprint,
        products: selected.products,
      }
    : null;
}
