type UnknownRecord = Record<string, unknown>;

const LIVE_GROUPED_OPTION_SOURCE = "shopling_live_grouped_option_sync";

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function array(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function legacySeoCanonicalOptionGroupMismatch(itemInput: unknown) {
  const item = record(itemInput);
  const itemSync = record(item.shoplingOptionSync);
  return (
    text(itemSync.source) === LIVE_GROUPED_OPTION_SOURCE &&
    text(itemSync.selectionReason) === "canonical_option_group_mismatch"
  );
}

export function legacySeoShoplingSyncConfirmed(itemInput: unknown) {
  const item = record(itemInput);
  const itemSync = record(item.shoplingOptionSync);
  const itemSyncSource = text(itemSync.source);

  // Once a current item-level live sync result exists it is authoritative.
  // `existing_preserved` deliberately means the canonical option structure was
  // not confirmed, so stale option-level sync metadata must never upgrade it to
  // a confirmed state.
  if (itemSyncSource === LIVE_GROUPED_OPTION_SOURCE) {
    return text(itemSync.status) === "synced";
  }

  // Backward-compatible fallback for rows that predate the item-level marker.
  const options = array(item.orderOptions).map(record);
  return (
    options.length > 0 &&
    options.every(
      (option) =>
        text(record(option.shoplingOptionSync).source) ===
        LIVE_GROUPED_OPTION_SOURCE,
    )
  );
}
