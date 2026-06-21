import { NextResponse } from "next/server";
import { getEngineRunnerConfig, isEngineDispatchTokenConfigured } from "@/lib/engineRunnerConfig";
import { downloadWorkflowArtifact, extractExpectedArtifactFiles } from "@/lib/githubActionsArtifacts";
import type { EngineRunnerKind } from "@/lib/engineRunnerTypes";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const kind = body.kind as EngineRunnerKind | undefined;
  const config = kind ? getEngineRunnerConfig(kind) : null;
  const artifactId = Number(body.artifactId);
  const runId = Number(body.runId);

  if (!kind || !config) {
    return NextResponse.json({ ok: false, message: "Unsupported engine runner kind." }, { status: 400 });
  }
  if (!Number.isSafeInteger(artifactId) || artifactId <= 0) {
    return NextResponse.json({ ok: false, message: "Invalid GitHub Actions artifact id." }, { status: 400 });
  }
  if (!isEngineDispatchTokenConfigured()) {
    return NextResponse.json({ ok: false, status: "not_configured", message: "GitHub Actions artifact import is not configured yet." });
  }

  const source = {
    repo: config.repo,
    runId: Number.isSafeInteger(runId) && runId > 0 ? runId : null,
    artifactId,
    artifactName: config.expectedArtifactName,
  };

  try {
    const token = process.env.GITHUB_ENGINE_DISPATCH_TOKEN!.trim();
    const zipBytes = await downloadWorkflowArtifact({ ...config, token }, artifactId);
    const extracted = extractExpectedArtifactFiles(kind, zipBytes);
    const missingMessage = extracted.missingFiles.length
      ? `예상 파일을 찾지 못했습니다. 예상 파일: ${extracted.missingFiles.join(", ")}. ZIP 안에서 발견한 파일: ${extracted.foundSafeFiles.length ? extracted.foundSafeFiles.join(", ") : "없음"}`
      : undefined;
    return NextResponse.json({
      ok: extracted.missingFiles.length === 0,
      status: extracted.missingFiles.length === 0 ? "ready" : "missing_expected_files",
      message: missingMessage,
      kind,
      source,
      files: extracted.files,
      missingFiles: extracted.missingFiles,
      skippedFiles: extracted.skippedFiles,
      generatedSourceFiles: extracted.generatedSourceFiles,
      foundSafeFiles: extracted.foundSafeFiles,
      reviewRoute: config.outputReviewRoute,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not import GitHub Actions artifact.";
    return NextResponse.json({ ok: false, status: "github_actions_error", kind, source, message }, { status: 502 });
  }
}
