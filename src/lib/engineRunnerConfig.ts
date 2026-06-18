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
    label: "키워드 엔진 실행기",
    provider: "github_actions",
    repo: "andysong111/andysong111-keyword-engine-soon",
    repoOwner: "andysong111",
    repoName: "andysong111-keyword-engine-soon",
    intendedWorkflowFile: "keyword-engine-runner.yml",
    workflowName: "Keyword Engine Runner",
    supportedModes: ["dry_run"],
    outputReviewRoute: "/keyword-review-queue",
    actionsUrl: "https://github.com/andysong111/andysong111-keyword-engine-soon/actions/workflows/keyword-engine-runner.yml",
    expectedArtifactName: "keyword-engine-mvp-output",
    expectedArtifacts: [
      "keyword_mvp_approval_sheet.csv",
      "keyword_mvp_manual_candidates.csv",
      "keyword_mvp_summary.md",
    ],
    safetyFlags: ENGINE_RUNNER_SAFETY_FLAGS,
  },
  {
    kind: "detail_page_engine",
    label: "상세페이지 엔진 실행기",
    provider: "github_actions",
    repo: "andysong111/product-detail-page-auto",
    repoOwner: "andysong111",
    repoName: "product-detail-page-auto",
    intendedWorkflowFile: "detail-page-engine-runner.yml",
    workflowName: "Detail Page Engine Runner",
    supportedModes: ["generate_artifacts"],
    outputReviewRoute: "/detail-page-draft-review",
    actionsUrl: "https://github.com/andysong111/product-detail-page-auto/actions/workflows/detail-page-engine-runner.yml",
    expectedArtifactName: "detail-page-engine-output",
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

function trimInputs(inputs: Record<string, string> = {}) {
  return Object.fromEntries(Object.entries(inputs).map(([key, value]) => [key, value.trim()]));
}

export function generateDetailPageProductCode(now = new Date()) {
  const compact = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "");
  return `DP-${compact.slice(0, 8)}-${compact.slice(9, 15)}`;
}

export function mapEngineWorkflowInputs(request: EngineRunnerDispatchInput): Record<string, string> {
  const inputs = trimInputs(request.inputs);

  if (request.kind === "keyword_engine") {
    const goodsKey = inputs.goods_key || inputs.goods_keys || "";

    if (!goodsKey) {
      throw new Error("Keyword Engine dispatch requires goods_key.");
    }

    return {
      goods_key: goodsKey,
      seed_keyword: inputs.seed_keyword || "",
      mode: request.mode,
    };
  }

  if (request.kind === "detail_page_engine") {
    if (!inputs.source_link) {
      throw new Error("Detail Page Engine dispatch requires source_link.");
    }

    return {
      product_code: inputs.product_code || generateDetailPageProductCode(),
      source_link: inputs.source_link,
      source_links: inputs.source_links || "",
      planning_point: inputs.planning_point || "",
      option_info: inputs.option_info || "",
      target: inputs.target || "",
      mode: request.mode,
    };
  }

  throw new Error("Unsupported engine runner kind.");
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
    inputs: mapEngineWorkflowInputs(request),
    safetyFlags: config.safetyFlags,
  };
}
