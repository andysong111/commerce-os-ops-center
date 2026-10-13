import { seoCatalogExclusion } from "./seoCatalogExclusionPolicy.ts";

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
  const catalog = seoCatalogExclusion(item.modelNumber ?? item.model_number);
  if (catalog.excluded) {
    return { excluded: true, reason: catalog.reason };
  }
  const explicit = legacySeoRegistrationExclusionFromPolicy(
    item.legacySeoRegistrationPolicy,
  );
  if (explicit.excluded) return explicit;

  return { excluded: false, reason: "" };
}

export function isLegacySeoRegistrationExcluded(itemInput: unknown) {
  return legacySeoRegistrationExclusion(itemInput).excluded;
}

export function isLegacySeoRegistrationPolicyExcluded(policyInput: unknown) {
  return legacySeoRegistrationExclusionFromPolicy(policyInput).excluded;
}
