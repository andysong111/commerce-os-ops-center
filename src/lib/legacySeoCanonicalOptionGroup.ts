export function legacySeoCanonicalOptionKey(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/[\s,，/|:：()\[\]{}._-]+/g, "");
}

export function legacySeoCanonicalOptionSignature(values: unknown[]) {
  return values
    .map(legacySeoCanonicalOptionKey)
    .filter(Boolean)
    .sort()
    .join("|");
}

export function legacySeoOptionGroupMatchesCanonical(
  groupSaleOptions: unknown[],
  canonicalSaleOptions: unknown[],
) {
  const groupKeys = groupSaleOptions.map(legacySeoCanonicalOptionKey).filter(Boolean);
  const canonicalKeys = canonicalSaleOptions.map(legacySeoCanonicalOptionKey).filter(Boolean);
  if (!canonicalKeys.length || groupKeys.length !== canonicalKeys.length) return false;
  return legacySeoCanonicalOptionSignature(groupKeys) === legacySeoCanonicalOptionSignature(canonicalKeys);
}
