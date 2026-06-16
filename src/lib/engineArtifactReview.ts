export type EngineArtifactSource =
  | "keyword-engine-soon"
  | "product-detail-page-auto";

export type EngineReviewStatus =
  | "imported"
  | "needs_review"
  | "approved"
  | "held"
  | "blocked"
  | "preview_ready"
  | "export_ready"
  | "execution_disabled";

export type EngineIntegrationMode =
  | "imported_artifact_review"
  | "preview_only"
  | "execution_preparation";

export type EngineIntegrationSafetyFlags = {
  externalEngineExecution: false;
  notPublished: true;
  notAppliedToShopling: true;
  previewOnly: true;
  requiresHumanApproval: true;
};

export type EngineArtifactReviewSummary = {
  source: EngineArtifactSource;
  mode: EngineIntegrationMode;
  statuses: EngineReviewStatus[];
  safetyFlags: EngineIntegrationSafetyFlags;
};

export const DEFAULT_ENGINE_INTEGRATION_SAFETY_FLAGS: EngineIntegrationSafetyFlags = {
  externalEngineExecution: false,
  notPublished: true,
  notAppliedToShopling: true,
  previewOnly: true,
  requiresHumanApproval: true,
};

export function createEngineArtifactReviewSummary(input: {
  source: EngineArtifactSource;
  mode?: EngineIntegrationMode;
  statuses?: EngineReviewStatus[];
}): EngineArtifactReviewSummary {
  return {
    source: input.source,
    mode: input.mode ?? "imported_artifact_review",
    statuses: input.statuses ?? ["imported", "needs_review", "execution_disabled"],
    safetyFlags: DEFAULT_ENGINE_INTEGRATION_SAFETY_FLAGS,
  };
}
