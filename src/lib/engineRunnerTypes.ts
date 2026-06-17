export type EngineRunnerKind = "keyword_engine" | "detail_page_engine";

export type EngineRunnerProvider = "github_actions";

export type EngineRunnerMode = "dry_run" | "generate_artifacts" | "preview_only";

export type EngineRunnerExecutionStatus =
  | "not_configured"
  | "ready"
  | "dispatch_preview"
  | "dispatch_requested"
  | "running"
  | "completed"
  | "failed"
  | "blocked";

export type EngineRunnerSafetyFlags = {
  externalEngineRepo: true;
  localPowerShellExecution: false;
  shoplingExecution: false;
  productionPublish: false;
  requiresHumanReview: true;
  artifactsMustBeReviewedInOpsCenter: true;
};

export type EngineRunnerConfig = {
  kind: EngineRunnerKind;
  label: string;
  provider: EngineRunnerProvider;
  repo: string;
  intendedWorkflowFile: string;
  supportedModes: readonly EngineRunnerMode[];
  outputReviewRoute: string;
  expectedArtifacts: readonly string[];
  safetyFlags: EngineRunnerSafetyFlags;
};

export type EngineRunnerDispatchInput = {
  kind: EngineRunnerKind;
  mode: EngineRunnerMode;
  inputs?: Record<string, string>;
};

export type EngineRunnerDispatchPreview = {
  previewOnly: true;
  status: EngineRunnerExecutionStatus;
  provider: EngineRunnerProvider;
  repo: string;
  workflowFile: string;
  ref: string;
  inputs: Record<string, string>;
  safetyFlags: EngineRunnerSafetyFlags;
};
