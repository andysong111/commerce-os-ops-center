import type {
  EngineRunnerConfig,
  EngineRunnerDispatchInput,
  EngineRunnerDispatchPreview,
  EngineRunnerKind,
} from "./engineRunnerTypes";

export const ENGINE_RUNNER_SAFETY_FLAGS = {
  externalEngineRepo: true,
  localPowerShellExecution: false,
  shoplingExecution: false,
  productionPublish: false,
  requiresHumanReview: true,
  artifactsMustBeReviewedInOpsCenter: true,
} as const;

export const engineRunnerConfigs = [
  {
    kind: "keyword_engine",
    label: "Keyword Engine Runner",
    provider: "github_actions",
    repo: "andysong111/andysong111-keyword-engine-soon",
    intendedWorkflowFile: "keyword-engine-runner.yml",
    supportedModes: ["dry_run"],
    outputReviewRoute: "/keyword-review-queue",
    expectedArtifacts: [
      "keyword_mvp_approval_sheet.csv",
      "keyword_mvp_manual_candidates.csv",
      "keyword_mvp_summary.md",
    ],
    safetyFlags: ENGINE_RUNNER_SAFETY_FLAGS,
  },
  {
    kind: "detail_page_engine",
    label: "Detail Page Engine Runner",
    provider: "github_actions",
    repo: "andysong111/product-detail-page-auto",
    intendedWorkflowFile: "detail-page-engine-runner.yml",
    supportedModes: ["generate_artifacts"],
    outputReviewRoute: "/detail-page-draft-review",
    expectedArtifacts: [
      "detailpage_final.html",
      "detailpage_render_report.json",
      "multi_source_summary.json",
    ],
    safetyFlags: ENGINE_RUNNER_SAFETY_FLAGS,
  },
] as const satisfies readonly EngineRunnerConfig[];

export function getEngineRunnerConfig(kind: EngineRunnerKind) {
  return engineRunnerConfigs.find((config) => config.kind === kind) ?? null;
}

export function isEngineDispatchTokenConfigured() {
  return Boolean(process.env.GITHUB_ENGINE_DISPATCH_TOKEN?.trim());
}

export function buildEngineDispatchPreview(
  request: EngineRunnerDispatchInput,
): EngineRunnerDispatchPreview {
  const config = getEngineRunnerConfig(request.kind);

  if (!config) {
    throw new Error("Unsupported engine runner kind.");
  }

  if (!(config.supportedModes as readonly string[]).includes(request.mode)) {
    throw new Error("Unsupported engine runner mode.");
  }

  return {
    previewOnly: true,
    status: "dispatch_preview",
    provider: config.provider,
    repo: config.repo,
    workflowFile: config.intendedWorkflowFile,
    ref: "main",
    inputs: {
      mode: request.mode,
      ...(request.inputs ?? {}),
    },
    safetyFlags: config.safetyFlags,
  };
}
