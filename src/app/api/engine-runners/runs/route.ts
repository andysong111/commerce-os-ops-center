import { NextResponse } from "next/server";
import { getEngineRunnerConfig, isEngineDispatchTokenConfigured } from "@/lib/engineRunnerConfig";
import { listWorkflowRunArtifacts, listWorkflowRuns } from "@/lib/githubActionsRuns";
import type { EngineRunnerKind } from "@/lib/engineRunnerTypes";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const kind = searchParams.get("kind") as EngineRunnerKind | null;
  const config = kind ? getEngineRunnerConfig(kind) : null;

  if (!kind || !config) {
    return NextResponse.json({ ok: false, message: "Unsupported engine runner kind." }, { status: 400 });
  }

  const basePayload = {
    kind: config.kind,
    repo: config.repo,
    workflowFile: config.intendedWorkflowFile,
    actionsUrl: config.actionsUrl,
    expectedArtifactName: config.expectedArtifactName,
    outputReviewRoute: config.outputReviewRoute,
  };

  if (!isEngineDispatchTokenConfigured()) {
    return NextResponse.json({ ok: true, status: "not_configured", ...basePayload, runs: [] });
  }

  const token = process.env.GITHUB_ENGINE_DISPATCH_TOKEN!.trim();
  const runs = await listWorkflowRuns({ ...config, token, perPage: 10 });
  const runsWithArtifacts = await Promise.all(
    runs.slice(0, 5).map(async (run) => ({
      ...run,
      artifacts: await listWorkflowRunArtifacts({ ...config, token }, run.id),
    })),
  );

  return NextResponse.json({
    ok: true,
    status: "ready",
    ...basePayload,
    runs: [
      ...runsWithArtifacts,
      ...runs.slice(5).map((run) => ({ ...run, artifacts: [] })),
    ],
  });
}
