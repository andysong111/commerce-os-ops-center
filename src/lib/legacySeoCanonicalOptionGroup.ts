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
  return groupKeys.join("|") === canonicalKeys.join("|");
}
