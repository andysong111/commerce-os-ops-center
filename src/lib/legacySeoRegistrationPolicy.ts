type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

export type LegacySeoRegistrationExclusion = {
  excluded: boolean;
  reason: string;
};

export function legacySeoRegistrationExclusionFromPolicy(
  policyInput: unknown,
): LegacySeoRegistrationExclusion {
  const policy = record(policyInput);
  const excluded = policy.excluded === true;
  return {
    excluded,
    reason: excluded ? text(policy.reason) || "등록 제외" : "",
  };
}

export function legacySeoRegistrationExclusion(
  itemInput: unknown,
): LegacySeoRegistrationExclusion {
  const item = record(itemInput);
  return legacySeoRegistrationExclusionFromPolicy(item.legacySeoRegistrationPolicy);
}

export function isLegacySeoRegistrationExcluded(itemInput: unknown) {
  return legacySeoRegistrationExclusion(itemInput).excluded;
}

export function isLegacySeoRegistrationPolicyExcluded(policyInput: unknown) {
  return legacySeoRegistrationExclusionFromPolicy(policyInput).excluded;
}
