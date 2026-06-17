import type { EngineRunnerConfig } from "./engineRunnerTypes";

export type GitHubActionsRun = {
  id: number;
  name: string;
  status: string | null;
  conclusion: string | null;
  event: string;
  branch: string;
  headSha: string;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
  runNumber: number;
  runAttempt: number;
};

export type GitHubActionsArtifact = {
  id: number;
  name: string;
  sizeInBytes: number;
  expired: boolean;
  createdAt: string;
  updatedAt: string;
  archiveDownloadUrlAvailable: boolean;
  expected: boolean;
};

type RunListingConfig = Pick<
  EngineRunnerConfig,
  "repoOwner" | "repoName" | "intendedWorkflowFile" | "expectedArtifactName"
> & { token: string; perPage?: number };

type ArtifactListingConfig = Pick<EngineRunnerConfig, "repoOwner" | "repoName" | "expectedArtifactName"> & {
  token: string;
};

function githubHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function assertGitHubResponse(response: Response, resource: string) {
  if (!response.ok) {
    throw new Error(`GitHub Actions ${resource} request failed with HTTP ${response.status}.`);
  }
}

export async function listWorkflowRuns(config: RunListingConfig): Promise<GitHubActionsRun[]> {
  const encodedWorkflowFile = encodeURIComponent(config.intendedWorkflowFile);
  const perPage = config.perPage ?? 10;
  const apiUrl = `https://api.github.com/repos/${config.repoOwner}/${config.repoName}/actions/workflows/${encodedWorkflowFile}/runs?per_page=${perPage}`;

  const response = await fetch(apiUrl, { headers: githubHeaders(config.token) });
  assertGitHubResponse(response, "workflow runs");
  const payload = (await response.json()) as { workflow_runs?: unknown[] };
  const runs = Array.isArray(payload.workflow_runs) ? payload.workflow_runs : [];

  return runs.map((run) => {
    const value = run as Record<string, unknown>;

    return {
      id: Number(value.id),
      name: String(value.name ?? ""),
      status: typeof value.status === "string" ? value.status : null,
      conclusion: typeof value.conclusion === "string" ? value.conclusion : null,
      event: String(value.event ?? ""),
      branch: String(value.head_branch ?? ""),
      headSha: String(value.head_sha ?? ""),
      createdAt: String(value.created_at ?? ""),
      updatedAt: String(value.updated_at ?? ""),
      htmlUrl: String(value.html_url ?? ""),
      runNumber: Number(value.run_number ?? 0),
      runAttempt: Number(value.run_attempt ?? 0),
    };
  });
}

export async function listWorkflowRunArtifacts(
  config: ArtifactListingConfig,
  runId: number,
): Promise<GitHubActionsArtifact[]> {
  const apiUrl = `https://api.github.com/repos/${config.repoOwner}/${config.repoName}/actions/runs/${runId}/artifacts`;
  const response = await fetch(apiUrl, { headers: githubHeaders(config.token) });
  assertGitHubResponse(response, "run artifacts");
  const payload = (await response.json()) as { artifacts?: unknown[] };
  const artifacts = Array.isArray(payload.artifacts) ? payload.artifacts : [];

  return artifacts.map((artifact) => {
    const value = artifact as Record<string, unknown>;
    const name = String(value.name ?? "");

    return {
      id: Number(value.id),
      name,
      sizeInBytes: Number(value.size_in_bytes ?? 0),
      expired: Boolean(value.expired),
      createdAt: String(value.created_at ?? ""),
      updatedAt: String(value.updated_at ?? ""),
      archiveDownloadUrlAvailable: Boolean(value.archive_download_url),
      expected: name === config.expectedArtifactName,
    };
  });
}
