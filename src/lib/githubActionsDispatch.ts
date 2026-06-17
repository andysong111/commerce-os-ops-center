export type GitHubActionsDispatchRequest = {
  owner: string;
  repo: string;
  workflowFile: string;
  ref?: string;
  inputs: Record<string, string>;
  token: string;
};

export type GitHubActionsDispatchResult = {
  ok: boolean;
  status: number;
  repo: string;
  workflowFile: string;
  ref: string;
  actionsUrl: string;
  message: string;
};

export async function dispatchGitHubActionsWorkflow({
  owner,
  repo,
  workflowFile,
  ref = "main",
  inputs,
  token,
}: GitHubActionsDispatchRequest): Promise<GitHubActionsDispatchResult> {
  const encodedWorkflowFile = encodeURIComponent(workflowFile);
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${encodedWorkflowFile}/dispatches`;
  const actionsUrl = `https://github.com/${owner}/${repo}/actions/workflows/${workflowFile}`;

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ ref, inputs }),
  });

  if (response.status === 204) {
    return {
      ok: true,
      status: response.status,
      repo: `${owner}/${repo}`,
      workflowFile,
      ref,
      actionsUrl,
      message: "Dispatch requested.",
    };
  }

  return {
    ok: false,
    status: response.status,
    repo: `${owner}/${repo}`,
    workflowFile,
    ref,
    actionsUrl,
    message: `GitHub Actions dispatch failed with HTTP ${response.status}.`,
  };
}
