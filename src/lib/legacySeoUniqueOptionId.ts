export function reserveUniqueLegacySeoOptionId(
  preferredId: string,
  fallbackBase: string,
  claimedIds: Set<string>,
) {
  const preferred = preferredId.trim();
  const fallback = fallbackBase.trim() || "shopling-option";

  for (const candidate of [preferred, fallback]) {
    if (!candidate || claimedIds.has(candidate)) continue;
    claimedIds.add(candidate);
    return candidate;
  }

  let suffix = 2;
  while (claimedIds.has(`${fallback}-${suffix}`)) suffix += 1;
  const candidate = `${fallback}-${suffix}`;
  claimedIds.add(candidate);
  return candidate;
}
