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
  const explicit = legacySeoRegistrationExclusionFromPolicy(
    item.legacySeoRegistrationPolicy,
  );
  if (explicit.excluded) return explicit;

  // Normalized legacy items are registration-ready only when the canonical
  // orderOptions array exists and contains at least one option. Older split
  // listings and incomplete historical rows often have no normalized options;
  // fail closed instead of fabricating a B-code or price for them.
  if (Object.prototype.hasOwnProperty.call(item, "orderOptions")) {
    if (!Array.isArray(item.orderOptions) || item.orderOptions.length === 0) {
      return {
        excluded: true,
        reason: "등록용 묶음옵션/B코드 없음 · 기존 쪼개등록 또는 근거부족 자동 제외",
      };
    }
  }

  return { excluded: false, reason: "" };
}

export function isLegacySeoRegistrationExcluded(itemInput: unknown) {
  return legacySeoRegistrationExclusion(itemInput).excluded;
}

export function isLegacySeoRegistrationPolicyExcluded(policyInput: unknown) {
  return legacySeoRegistrationExclusionFromPolicy(policyInput).excluded;
}
