import { AI_SAURUS_ORIGIN } from "./aiSaurusBulkDetailTypes";

export const AI_SAURUS_REVIEW_ROLES = [
  "representative_main_catalog",
  "representative_alternate_whole",
  "representative_evidence_detail",
  "representative_lifestyle_usage",
  "representative_adaptive_support",
] as const;

export type AiSaurusReviewRole = (typeof AI_SAURUS_REVIEW_ROLES)[number];
export type AiSaurusReviewAssets = Partial<Record<AiSaurusReviewRole, string>>;

const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

export function saurusResultImageUrl(id: string) {
  return `${AI_SAURUS_ORIGIN}/api/saas/marketplace-assets/${id}/image.jpg`;
}

export function readSaurusReviewAssets(value: unknown, detailAssetId: string): AiSaurusReviewAssets | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const records = AI_SAURUS_REVIEW_ROLES.flatMap((role) => {
    const id = source[role];
    return typeof id === "string" && ID.test(id) && id !== detailAssetId ? [{ role, id }] : [];
  });
  const unique = records.filter(({ id }) => records.filter((record) => record.id === id).length === 1);
  return unique.length ? Object.fromEntries(unique.map(({ role, id }) => [role, id])) : undefined;
}
