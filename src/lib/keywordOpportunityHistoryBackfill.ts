import type { EngineRunnerConfig } from "./engineRunnerTypes";
import {
  downloadWorkflowArtifact,
  extractExpectedArtifactFiles,
} from "./githubActionsArtifacts";
import {
  listWorkflowRunArtifacts,
  listWorkflowRuns,
  type GitHubActionsArtifact,
  type GitHubActionsRun,
} from "./githubActionsRuns";
import type { KeywordOpportunityHistoryObservation } from "./keywordOpportunityLibrary";
import {
  parseKeywordRecommendationArtifact,
  type KeywordRecommendationGroup,
} from "./productLaunchKeywordRecommendations";
import { prepareNoSpaceRecommendationArtifactFiles } from "./productLaunchNoSpaceArtifactFiles";

type BackfillConfig = Pick<
  EngineRunnerConfig,
  | "repoOwner"
  | "repoName"
  | "intendedWorkflowFile"
  | "expectedArtifactName"
> & { token: string };

type BackfillDeps = {
  listRuns: typeof listWorkflowRuns;
  listArtifacts: typeof listWorkflowRunArtifacts;
  downloadArtifact: typeof downloadWorkflowArtifact;
  extractArtifact: typeof extractExpectedArtifactFiles;
};

const DEFAULT_DEPS: BackfillDeps = {
  listRuns: listWorkflowRuns,
  listArtifacts: listWorkflowRunArtifacts,
  downloadArtifact: downloadWorkflowArtifact,
  extractArtifact: extractExpectedArtifactFiles,
};

export type KeywordOpportunityHistoryBackfillResult = {
  observations: KeywordOpportunityHistoryObservation[];
  stats: {
    successfulRunsChecked: number;
    artifactsFound: number;
    artifactsImported: number;
    artifactsFailed: number;
    goodsKeysRecovered: number;
    keywordObservationsRecovered: number;
  };
};

function isSuccessfulDispatch(run: GitHubActionsRun) {
  return (
    run.event === "workflow_dispatch" &&
    run.status === "completed" &&
    run.conclusion === "success"
  );
}

function exactHistoricalArtifact(
  artifacts: GitHubActionsArtifact[],
  expectedName: string,
) {
  return artifacts.find(
    (artifact) =>
      artifact.name === expectedName &&
      !artifact.expired &&
      artifact.archiveDownloadUrlAvailable,
  );
}

function backfillItems(groups: KeywordRecommendationGroup[]) {
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          item.selectedByEngine ||
          item.quality === "최적" ||
          item.quality === "추천",
      ),
    }))
    .filter((group) => group.items.length > 0);
}

async function mapInBatches<T, R>(
  values: T[],
  batchSize: number,
  callback: (value: T) => Promise<R>,
) {
  const results: R[] = [];
  for (let index = 0; index < values.length; index += batchSize) {
    results.push(
      ...(await Promise.all(
        values.slice(index, index + batchSize).map(callback),
      )),
    );
  }
  return results;
}

export async function loadKeywordOpportunityHistory(
  config: BackfillConfig,
  deps: BackfillDeps = DEFAULT_DEPS,
): Promise<KeywordOpportunityHistoryBackfillResult> {
  const runs = (
    await deps.listRuns({ ...config, perPage: 100 })
  ).filter(isSuccessfulDispatch);

  const runArtifacts = await mapInBatches(runs, 5, async (run) => ({
    run,
    artifact: exactHistoricalArtifact(
      await deps.listArtifacts(config, run.id),
      config.expectedArtifactName,
    ),
  }));
  const available = runArtifacts.filter(
    (
      item,
    ): item is { run: GitHubActionsRun; artifact: GitHubActionsArtifact } =>
      Boolean(item.artifact),
  );

  let artifactsFailed = 0;
  const recovered: Array<KeywordOpportunityHistoryObservation | null> =
    await mapInBatches(available, 3, async ({ run, artifact }) => {
      try {
        const zip = await deps.downloadArtifact(config, artifact.id);
        const extracted = deps.extractArtifact("keyword_engine", zip);
        if (extracted.missingFiles.length > 0) {
          artifactsFailed += 1;
          return null;
        }
        const prepared = prepareNoSpaceRecommendationArtifactFiles(
          extracted.files,
        );
        const parsed = parseKeywordRecommendationArtifact(prepared.files);
        const groups = backfillItems(parsed.groups);
        if (groups.length === 0) return null;
        return {
          requestId: parsed.requestId || `keyword-history-run-${run.id}`,
          capturedAt: artifact.createdAt || run.createdAt,
          groups,
        } satisfies KeywordOpportunityHistoryObservation;
      } catch {
        artifactsFailed += 1;
        return null;
      }
    });
  const observations = recovered.filter(
    (item): item is KeywordOpportunityHistoryObservation => item !== null,
  );
  const goodsKeys = new Set(
    observations.flatMap((observation) =>
      observation.groups.map((group) => group.goodsKey),
    ),
  );

  return {
    observations,
    stats: {
      successfulRunsChecked: runs.length,
      artifactsFound: available.length,
      artifactsImported: observations.length,
      artifactsFailed,
      goodsKeysRecovered: goodsKeys.size,
      keywordObservationsRecovered: observations.reduce(
        (sum, observation) =>
          sum +
          observation.groups.reduce(
            (groupSum, group) => groupSum + group.items.length,
            0,
          ),
        0,
      ),
    },
  };
}
