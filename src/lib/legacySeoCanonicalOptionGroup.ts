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

function singleUnitSignature(values: string[]) {
  const stripped = values.map((value) => value.replace(/1p$/, ""));
  if (!stripped.some((value, index) => value !== values[index])) return "";
  if (stripped.some((value) => value.length < 2)) return "";
  if (new Set(stripped).size !== values.length) return "";
  return [...stripped].sort().join("|");
}

function bijectiveAffixMatch(left: string[], right: string[]) {
  if (left.length !== right.length || left.length < 2) return false;
  const claimed = new Set<string>();
  for (const value of left) {
    if (value.length < 2) return false;
    const candidates = right.filter(
      (candidate) =>
        candidate.length >= 2 &&
        candidate !== value &&
        (candidate.endsWith(value) || value.endsWith(candidate)),
    );
    if (candidates.length !== 1 || claimed.has(candidates[0])) return false;
    claimed.add(candidates[0]);
  }
  return claimed.size === right.length;
}

export function legacySeoCanonicalOptionSignature(values: unknown[]) {
  return normalizedUniqueKeys(values).join("|");
}

export function legacySeoCompleteBCodeGroupMatches(
  groupBCodes: unknown[],
  currentBCodes: unknown[],
) {
  const normalize = (values: unknown[]) =>
    values.map((value) => String(value ?? "").normalize("NFKC").trim().toUpperCase());
  const group = normalize(groupBCodes);
  const current = normalize(currentBCodes);
  if (!group.length || group.length !== current.length) return false;
  if (group.some((value) => !value) || current.some((value) => !value)) return false;
  if (new Set(group).size !== group.length || new Set(current).size !== current.length) {
    return false;
  }
  return [...group].sort().join("|") === [...current].sort().join("|");
}

export function legacySeoOptionGroupMatchesCanonical(
  groupSaleOptions: unknown[],
  canonicalSaleOptions: unknown[],
) {
  const groupKeys = normalizedUniqueKeys(groupSaleOptions);
  const canonicalKeys = normalizedUniqueKeys(canonicalSaleOptions);
  if (!canonicalKeys.length || !groupKeys.length) return false;
  if (groupKeys.join("|") === canonicalKeys.join("|")) return true;

  // The canonical workbook can retain older rows for the same model. A live
  // Shopling group is still safe when every one of its options has one exact
  // canonical row; unused historical canonical rows do not define the live SKU.
  if (groupKeys.every((key) => canonicalKeys.includes(key))) return true;

  // A one-option Shopling product is identified by model_no and its managed
  // B-code. Its display label commonly changed between "단품", pack wording,
  // and the actual color name, so a one-row canonical model can match it safely.
  if (groupKeys.length === 1 && canonicalKeys.length === 1) return true;

  if (groupKeys.length !== canonicalKeys.length) return false;

  // Older stock sheets sometimes prefix each option with its display order
  // while Shopling stores only the dimensions. Accept only a complete,
  // one-to-one multi-option match so different options cannot collapse.
  if (groupKeys.length < 2) return false;
  const groupOrdinal = ordinalAffixSignature(groupKeys);
  const canonicalOrdinal = ordinalAffixSignature(canonicalKeys);
  if (
    (groupOrdinal && groupOrdinal === canonicalKeys.join("|")) ||
    (canonicalOrdinal && canonicalOrdinal === groupKeys.join("|"))
  ) {
    return true;
  }

  const groupSingleUnit = singleUnitSignature(groupKeys);
  const canonicalSingleUnit = singleUnitSignature(canonicalKeys);
  if (
    (groupSingleUnit && groupSingleUnit === canonicalKeys.join("|")) ||
    (canonicalSingleUnit && canonicalSingleUnit === groupKeys.join("|"))
  ) {
    return true;
  }

  return (
    bijectiveAffixMatch(groupKeys, canonicalKeys) ||
    bijectiveAffixMatch(canonicalKeys, groupKeys)
  );
}
