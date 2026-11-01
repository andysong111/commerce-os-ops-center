import type { PurchaseReplacementDraftLine } from "@/lib/purchaseCyclePreflightCore";
import { isTrustedPurchaseDraftManualAddition } from "./purchaseCycleDraftRegenerationCore.ts";
import {
  canonicalSourcingBarcode,
  type PurchaseIdentityMetadata,
} from "./sourcingReservationIdentity.ts";

type ReplacementLedgerRow = {
  sourceSystem: string;
  sourceRunId: string | null;
  barcode: string;
  openQuantity: number;
  committedQuantity: number;
  latestPayload: unknown;
};

const RESTORED_CONFIRMED_SOURCING_NOTE =
  "기존 확정 신규소싱 예약에서 복구 · 이번 수동 선택에만 포함";

/**
 * Returns only trusted operator-owned payloads for lines that still belong to
 * the visible replacement selection. A system-generated restored-sourcing note is
 * accepted only on the current PURCHASE_PREFLIGHT regeneration row; this repairs
 * legacy rows whose explicit boolean marker fell outside ledger retention.
 */
export function purchaseReplacementTrustedPayloadRows<TRow extends ReplacementLedgerRow>(
  commitments: TRow[],
  activeRows: TRow[],
  draftId: string,
  selectedBarcodes: ReadonlySet<string>,
) {
  const currentDraftRows = activeRows.filter((row) => row.sourceRunId === draftId);
  const supersedesDraftIds = [...new Set(
    currentDraftRows
      .map((row) => text(object(row.latestPayload).supersedesDraftId))
      .filter(Boolean),
  )];
  const excluded = payloadExclusions(currentDraftRows);
  const predecessorId = supersedesDraftIds.length === 1 ? supersedesDraftIds[0] : null;
  const predecessorRows = predecessorId
    ? commitments.filter(
        (row) =>
          row.sourceSystem === "fast-purchase-mvp" &&
          row.sourceRunId === predecessorId &&
          row.committedQuantity > 0,
      )
    : [];
  const restoredConfirmedSourcingBarcodes = new Set(
    currentDraftRows
      .filter((row) => isRestoredConfirmedSourcingPayload(row.latestPayload))
      .map((row) => row.barcode),
  );
  const historicalConfirmedSourcingRows = commitments.filter((row) => {
    if (!restoredConfirmedSourcingBarcodes.has(row.barcode)) return false;
    return object(row.latestPayload).sourcingConfirmed === true;
  });
  const trustedByBarcode = new Map<string, TRow>();

  for (const row of [
    ...historicalConfirmedSourcingRows,
    ...predecessorRows,
    ...activeRows,
  ]) {
    if (!selectedBarcodes.has(row.barcode) || excluded.has(row.barcode)) continue;
    const payload = object(row.latestPayload);
    const restoredCurrentMarker = row.sourceRunId === draftId &&
      isRestoredConfirmedSourcingPayload(payload);
    if (
      payload.sourcingConfirmed === true ||
      isTrustedPurchaseDraftManualAddition(payload) ||
      restoredCurrentMarker
    ) {
      trustedByBarcode.set(
        row.barcode,
        restoredCurrentMarker && payload.sourcingConfirmed !== true
          ? {
              ...row,
              latestPayload: { ...payload, sourcingConfirmed: true },
            }
          : row,
      );
    }
  }

  return trustedByBarcode;
}

function isRestoredConfirmedSourcingPayload(value: unknown) {
  const payload = object(value);
  return text(payload.operatorNote ?? payload.note) ===
    RESTORED_CONFIRMED_SOURCING_NOTE &&
    text(payload.dataMode) === "PURCHASE_PREFLIGHT" &&
    payload.regeneration === true &&
    payload.externalOrderExecuted !== true;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function identityText(value: unknown) {
  return text(value).replace(/\s+/gu, " ").toLocaleLowerCase("ko-KR");
}

function sourcingIdentityPayload<TRow extends ReplacementLedgerRow>(
  commitments: TRow[],
  source: TRow | undefined,
  identityHistory: readonly ReplacementLedgerRow[] = [],
) {
  const fallback = object(source?.latestPayload);
  const productName = identityText(fallback.productName);
  const candidates = [...commitments, ...identityHistory]
    .filter((row) => row.barcode === source?.barcode)
    .map((row) => object(row.latestPayload))
    .filter((payload) =>
      payload.sourcingConfirmed === true &&
      (!productName || identityText(payload.productName) === productName)
    )
    .sort((left, right) =>
      identityPayloadScore(right) - identityPayloadScore(left)
    );
  return candidates[0] ?? fallback;
}

export function purchaseReplacementSourcingIdentityBarcodes<
  TRow extends ReplacementLedgerRow,
>(activeRows: readonly TRow[]) {
  return [...new Set(
    activeRows
      .filter((row) => {
        const payload = object(row.latestPayload);
        return payload.sourcingConfirmed === true ||
          isRestoredConfirmedSourcingPayload(payload);
      })
      .map((row) => row.barcode),
  )];
}

function identityPayloadScore(payload: Record<string, unknown>) {
  return Number(Boolean(text(payload.productName))) * 8 +
    Number(Boolean(text(payload.saleOption))) * 4 +
    Number(Boolean(text(payload.chinaOption))) * 2 +
    Number(Boolean(text(payload.supplierLink)));
}

function payloadExclusions(rows: ReplacementLedgerRow[]) {
  const result = new Set<string>();
  for (const row of rows) {
    const payload = object(row.latestPayload);
    const values = Array.isArray(payload.operatorExcludedBarcodes)
      ? payload.operatorExcludedBarcodes
      : [];
    for (const value of values) {
      const barcode = text(value).toUpperCase().replace(/\s+/g, "");
      if (barcode) result.add(barcode);
    }
  }
  return result;
}

/**
 * Rebuilds the visible replacement snapshot and recovers only its immediate
 * predecessor. This lets a corrected recommendation pass reconsider lines
 * that a buggy pass just dropped, without walking older history or reviving
 * operator-excluded products.
 */
export function purchaseReplacementDraftSnapshotLines(
  commitments: ReplacementLedgerRow[],
  activeRows: ReplacementLedgerRow[],
  draftId: string,
  overrides: ReadonlyMap<string, { targetQuantity: number }>,
  metadataByBarcode?: ReadonlyMap<string, PurchaseIdentityMetadata> | null,
  identityHistory: readonly ReplacementLedgerRow[] = [],
): PurchaseReplacementDraftLine[] {
  const quantities = new Map<string, number>();
  for (const row of activeRows) {
    quantities.set(
      row.barcode,
      Math.max(quantities.get(row.barcode) ?? 0, row.openQuantity),
    );
  }
  for (const [barcode, override] of overrides) {
    if (!quantities.has(barcode)) continue;
    if (override.targetQuantity > 0) quantities.set(barcode, override.targetQuantity);
    else quantities.delete(barcode);
  }

  const currentDraftRows = activeRows.filter((row) => row.sourceRunId === draftId);
  const supersedesDraftIds = [...new Set(
    currentDraftRows
      .map((row) => text(object(row.latestPayload).supersedesDraftId))
      .filter(Boolean),
  )];
  const excluded = payloadExclusions(currentDraftRows);
  const predecessorId = supersedesDraftIds.length === 1 ? supersedesDraftIds[0] : null;
  const predecessorRows = predecessorId
    ? commitments.filter(
        (row) =>
          row.sourceSystem === "fast-purchase-mvp" &&
          row.sourceRunId === predecessorId &&
          row.committedQuantity > 0 &&
          !quantities.has(row.barcode) &&
          !excluded.has(row.barcode),
      )
    : [];
  const predecessorBarcodes = new Set(predecessorRows.map((row) => row.barcode));

  const sourceByBarcode = new Map(
    [...predecessorRows, ...activeRows].map((row) => [row.barcode, row] as const),
  );
  for (const row of activeRows) {
    const payload = object(row.latestPayload);
    if (
      payload.sourcingConfirmed === true ||
      isTrustedPurchaseDraftManualAddition(payload) ||
      isRestoredConfirmedSourcingPayload(payload)
    ) {
      sourceByBarcode.set(row.barcode, row);
    }
  }
  for (const row of predecessorRows) {
    quantities.set(
      row.barcode,
      Math.max(quantities.get(row.barcode) ?? 0, row.committedQuantity),
    );
  }

  const resolved = new Map<string, PurchaseReplacementDraftLine>();
  for (const [barcode, quantity] of quantities) {
    const source = sourceByBarcode.get(barcode);
    const payload = object(source?.latestPayload);
    const preserveOnRegeneration =
      payload.sourcingConfirmed === true ||
      isTrustedPurchaseDraftManualAddition(payload) ||
      isRestoredConfirmedSourcingPayload(payload);
    const sourcingIdentityGuard =
      payload.sourcingConfirmed === true ||
      isRestoredConfirmedSourcingPayload(payload);
    const identityPayload = sourcingIdentityGuard
      ? sourcingIdentityPayload(commitments, source, identityHistory)
      : payload;
    const resolvedBarcode = sourcingIdentityGuard
      ? canonicalSourcingBarcode(barcode, identityPayload, metadataByBarcode)
      : barcode;
    if (resolved.has(resolvedBarcode)) {
      throw new Error(`PURCHASE_SOURCING_BARCODE_IDENTITY_DUPLICATE:${resolvedBarcode}`);
    }
    resolved.set(resolvedBarcode, {
      barcode: resolvedBarcode,
      quantity,
      name: text(identityPayload.productName),
      preserveOnRegeneration,
      recoveredFromPredecessor: predecessorBarcodes.has(barcode),
    });
  }
  return [...resolved.values()];
}
