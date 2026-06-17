import { NextResponse } from "next/server";
import {
  buildEngineDispatchPreview,
  getEngineRunnerConfig,
  isEngineDispatchTokenConfigured,
} from "@/lib/engineRunnerConfig";
import { dispatchGitHubActionsWorkflow } from "@/lib/githubActionsDispatch";
import type { EngineRunnerDispatchInput } from "@/lib/engineRunnerTypes";

export async function POST(request: Request) {
  let body: EngineRunnerDispatchInput;
  let preview: ReturnType<typeof buildEngineDispatchPreview>;

  try {
    body = await request.json();
    preview = buildEngineDispatchPreview(body);
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Invalid dispatch request." },
      { status: 400 },
    );
  }

  if (!isEngineDispatchTokenConfigured()) {
    return NextResponse.json(
      { message: "GitHub Actions dispatch is not configured yet." },
      { status: 501 },
    );
  }

  const config = getEngineRunnerConfig(body.kind)!;
  const token = process.env.GITHUB_ENGINE_DISPATCH_TOKEN!.trim();
  const result = await dispatchGitHubActionsWorkflow({
    owner: config.repoOwner,
    repo: config.repoName,
    workflowFile: config.intendedWorkflowFile,
    ref: preview.ref,
    inputs: preview.inputs,
    token,
  });

  const payload = {
    status: result.ok ? "dispatch_requested" : "blocked",
    ok: result.ok,
    message: result.message,
    runnerKind: config.kind,
    repo: config.repo,
    workflowFile: config.intendedWorkflowFile,
    ref: result.ref,
    actionsUrl: config.actionsUrl,
    expectedArtifactName: config.expectedArtifactName,
    expectedArtifacts: config.expectedArtifacts,
    outputReviewRoute: config.outputReviewRoute,
    note: "GitHub accepts the dispatch request without returning a run id immediately. Open the Actions page to monitor the run. Artifact import will be added in a later PR.",
  };

  return NextResponse.json(payload, { status: result.ok ? 200 : 502 });
}
