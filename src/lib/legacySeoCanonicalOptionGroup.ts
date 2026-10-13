export function legacySeoCanonicalOptionKey(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/[\s,，/|:：()\[\]{}._-]+/g, "");
}

function normalizedUniqueKeys(values: unknown[]) {
  return [...new Set(values.map(legacySeoCanonicalOptionKey).filter(Boolean))].sort();
}

function stripLeadingOrdinal(value: string) {
  return value.replace(/^\d+호(?=.{2,})/, "");
}

function ordinalAffixSignature(values: string[]) {
  const stripped = values.map(stripLeadingOrdinal);
  if (!stripped.some((value, index) => value !== values[index])) return "";
  if (new Set(stripped).size !== values.length) return "";
  return [...stripped].sort().join("|");
}

export function legacySeoCanonicalOptionSignature(values: unknown[]) {
  return normalizedUniqueKeys(values).join("|");
}

export function legacySeoOptionGroupMatchesCanonical(
  groupSaleOptions: unknown[],
  canonicalSaleOptions: unknown[],
) {
  const groupKeys = normalizedUniqueKeys(groupSaleOptions);
  const canonicalKeys = normalizedUniqueKeys(canonicalSaleOptions);
  if (!canonicalKeys.length || groupKeys.length !== canonicalKeys.length) return false;
  if (groupKeys.join("|") === canonicalKeys.join("|")) return true;

  // Older stock sheets sometimes prefix each option with its display order
  // while Shopling stores only the dimensions. Accept only a complete,
  // one-to-one multi-option match so different options cannot collapse.
  if (groupKeys.length < 2) return false;
  const groupOrdinal = ordinalAffixSignature(groupKeys);
  const canonicalOrdinal = ordinalAffixSignature(canonicalKeys);
  return Boolean(
    (groupOrdinal && groupOrdinal === canonicalKeys.join("|")) ||
      (canonicalOrdinal && canonicalOrdinal === groupKeys.join("|")),
  );
}
