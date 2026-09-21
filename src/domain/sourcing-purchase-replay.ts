const SOURCE_SYSTEM = "fast-purchase-mvp";
const DRAFT_ID = /^fast-purchase-draft:[a-f0-9]{20}$/;

export type SourcingPurchaseReplayIdentity = {
  intakeId: string;
  outboxId: string;
  barcode: string;
  modelNumber: string;
  productName: string;
  quantity: number;
};

export type SourcingPurchaseCommitmentLike = {
  sourceSystem: string;
  sourceLineId: string;
  sourceRunId: string | null;
  barcode: string;
  requestedQuantity: number;
  reservedAt: string | null;
  updatedAt: string;
  latestPayload: unknown;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function seoulMonth(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("SOURCING_PURCHASE_REPLAY_TIME_INVALID");
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}`;
}

export function resolveExistingSourcingPurchase(
  commitments: SourcingPurchaseCommitmentLike[],
  normalized: SourcingPurchaseReplayIdentity,
) {
  const matches = commitments.filter((row) => {
    if (row.sourceSystem !== SOURCE_SYSTEM) return false;
    const payload = record(row.latestPayload);
    return (
      text(payload.sourcingOutboxId).toLowerCase() === normalized.outboxId ||
      text(payload.sourcingIntakeId).toLowerCase() === normalized.intakeId
    );
  });
  if (!matches.length) return null;
  if (matches.length > 1) throw new Error("SOURCING_PURCHASE_REPLAY_AMBIGUOUS");

  const row = matches[0];
  const payload = record(row.latestPayload);
  if (
    text(payload.sourcingOutboxId).toLowerCase() !== normalized.outboxId ||
    text(payload.sourcingIntakeId).toLowerCase() !== normalized.intakeId ||
    row.barcode !== normalized.barcode ||
    text(payload.modelNo).toUpperCase() !== normalized.modelNumber ||
    text(payload.productName) !== normalized.productName ||
    row.requestedQuantity !== normalized.quantity
  ) {
    throw new Error("SOURCING_PURCHASE_REPLAY_IDENTITY_CONFLICT");
  }
  if (!row.sourceRunId || !DRAFT_ID.test(row.sourceRunId)) {
    throw new Error("SOURCING_PURCHASE_REPLAY_DRAFT_INVALID");
  }
  return {
    ok: true as const,
    draftId: row.sourceRunId,
    cycleMonth: seoulMonth(row.reservedAt || row.updatedAt),
    externalLineId: row.sourceLineId,
    barcode: normalized.barcode,
    modelNumber: normalized.modelNumber,
    productName: normalized.productName,
    quantity: normalized.quantity,
    duplicate: true as const,
    externalOrderExecuted: false as const,
  };
}
