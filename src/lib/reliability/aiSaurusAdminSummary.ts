import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const AI_SAURUS_SOURCE = "ai-saurus";
const ACTIVE_AUTOFIX_STATES = new Set([
  "queued",
  "claimed",
  "patch_ready",
  "validating",
  "pr_open",
]);
const APPLIED_IMPROVEMENT_STATES = new Set([
  "policy_active",
  "applied",
  "measuring",
  "verified",
]);

function cleanText(value: unknown, maxLength = 1200) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rows<T>(result: { data: unknown; error: { message: string } | null }) {
  if (result.error) throw new Error(result.error.message);
  return (Array.isArray(result.data) ? result.data : []) as T[];
}

type IncidentRow = {
  id: string;
  engine: string;
  title: string;
  status: string;
  severity: string;
  risk_level: string;
  error_code: string | null;
  occurrence_count: number | string;
  automatic_recovery_attempts: number | string;
  automatic_recovery_successes: number | string;
  learning_state: string;
  regression_state: string;
  last_seen_at: string;
};

type LearningRow = {
  id: string;
  incident_id: string;
  state: string;
  title: string;
  symptom: string;
  root_cause: string;
  resolution: string;
  prevention_rule: string;
  confidence: number | string;
  updated_at: string;
};

type RegressionRow = {
  id: string;
  incident_id: string;
  source_repo: string;
  test_path: string;
  test_name: string;
  protected_invariant: string;
  status: string;
  workflow_name: string | null;
  commit_sha: string | null;
  updated_at: string;
};

type ImprovementRow = {
  id: string;
  learning_case_id: string;
  incident_id: string;
  engine: string;
  error_code: string | null;
  title: string;
  fact_summary: string;
  root_cause: string;
  change_summary: string;
  expected_effect: string;
  improvement_kind: string;
  status: string;
  application_mode: string;
  risk_level: string;
  confidence: number | string;
  requires_approval: boolean;
  target_repo: string | null;
  target_test_name: string | null;
  applied_at: string | null;
  applied_reference: string | null;
  baseline_events: number | string;
  baseline_failures: number | string;
  baseline_recoveries: number | string;
  current_events: number | string;
  current_failures: number | string;
  current_recoveries: number | string;
  baseline_failure_rate: number | string | null;
  current_failure_rate: number | string | null;
  current_recovery_rate: number | string | null;
  improvement_percent: number | string | null;
  measurement_result: string;
  last_measured_at: string | null;
  updated_at: string;
};

type ActivityRow = {
  id: string;
  improvement_id: string;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  summary: string;
  occurred_at: string;
};

type RecoveryRow = {
  id: string;
  incident_id: string | null;
  engine: string;
  action: string;
  status: string;
  attempt_count: number | string;
  max_attempts: number | string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

type AutofixRow = {
  id: string;
  improvement_id: string;
  target_repo: string;
  status: string;
  attempts: number | string;
  max_attempts: number | string;
  github_run_id: string | null;
  branch_name: string | null;
  pr_number: number | null;
  commit_sha: string | null;
  merge_sha: string | null;
  patch_summary: string | null;
  changed_paths: unknown;
  last_error: string | null;
  failure_stage: string | null;
  failure_step: string | null;
  failure_run_id: string | null;
  quarantined_at: string | null;
  created_at: string;
  updated_at: string;
};

type EventRow = {
  id: string;
  engine: string;
  event_type: string;
  status: string;
  severity: string;
  risk_level: string;
  run_id: string | null;
  stage: string | null;
  error_code: string | null;
  automatic_recovery: boolean;
  recovery_action: string | null;
  occurred_at: string;
};

export type AiSaurusReliabilityAdminSummary = Awaited<
  ReturnType<typeof loadAiSaurusReliabilityAdminSummary>
>;

export async function loadAiSaurusReliabilityAdminSummary() {
  const client = await createSupabaseAdminClient();
  if (!client) throw new Error("Supabase admin client is unavailable");

  const [incidentResult, improvementResult, recoveryResult, eventResult] =
    await Promise.all([
      client
        .from("reliability_incidents")
        .select(
          "id,engine,title,status,severity,risk_level,error_code,occurrence_count,automatic_recovery_attempts,automatic_recovery_successes,learning_state,regression_state,last_seen_at",
        )
        .eq("source_system", AI_SAURUS_SOURCE)
        .order("last_seen_at", { ascending: false })
        .limit(80),
      client
        .from("reliability_improvements")
        .select(
          "id,learning_case_id,incident_id,engine,error_code,title,fact_summary,root_cause,change_summary,expected_effect,improvement_kind,status,application_mode,risk_level,confidence,requires_approval,target_repo,target_test_name,applied_at,applied_reference,baseline_events,baseline_failures,baseline_recoveries,current_events,current_failures,current_recoveries,baseline_failure_rate,current_failure_rate,current_recovery_rate,improvement_percent,measurement_result,last_measured_at,updated_at",
        )
        .eq("source_system", AI_SAURUS_SOURCE)
        .order("updated_at", { ascending: false })
        .limit(60),
      client
        .from("reliability_recovery_queue")
        .select(
          "id,incident_id,engine,action,status,attempt_count,max_attempts,last_error,created_at,updated_at",
        )
        .eq("source_system", AI_SAURUS_SOURCE)
        .order("created_at", { ascending: false })
        .limit(80),
      client
        .from("reliability_events")
        .select(
          "id,engine,event_type,status,severity,risk_level,run_id,stage,error_code,automatic_recovery,recovery_action,occurred_at",
        )
        .eq("source_system", AI_SAURUS_SOURCE)
        .order("occurred_at", { ascending: false })
        .limit(80),
    ]);

  const incidents = rows<IncidentRow>(incidentResult);
  const improvements = rows<ImprovementRow>(improvementResult);
  const recoveries = rows<RecoveryRow>(recoveryResult);
  const recentEvents = rows<EventRow>(eventResult);
  const incidentIds = incidents.map((row) => row.id);
  const improvementIds = improvements.map((row) => row.id);

  const [learningResult, regressionResult, activityResult, autofixResult] =
    await Promise.all([
      incidentIds.length
        ? client
            .from("reliability_learning_cases")
            .select(
              "id,incident_id,state,title,symptom,root_cause,resolution,prevention_rule,confidence,updated_at",
            )
            .in("incident_id", incidentIds)
            .order("updated_at", { ascending: false })
            .limit(80)
        : Promise.resolve({ data: [], error: null, count: 0 }),
      incidentIds.length
        ? client
            .from("reliability_regression_cases")
            .select(
              "id,incident_id,source_repo,test_path,test_name,protected_invariant,status,workflow_name,commit_sha,updated_at",
            )
            .in("incident_id", incidentIds)
            .order("updated_at", { ascending: false })
            .limit(80)
        : Promise.resolve({ data: [], error: null, count: 0 }),
      improvementIds.length
        ? client
            .from("reliability_improvement_activity")
            .select(
              "id,improvement_id,event_type,from_status,to_status,summary,occurred_at",
            )
            .in("improvement_id", improvementIds)
            .order("occurred_at", { ascending: false })
            .limit(100)
        : Promise.resolve({ data: [], error: null, count: 0 }),
      improvementIds.length
        ? client
            .from("reliability_autofix_jobs")
            .select(
              "id,improvement_id,target_repo,status,attempts,max_attempts,github_run_id,branch_name,pr_number,commit_sha,merge_sha,patch_summary,changed_paths,last_error,failure_stage,failure_step,failure_run_id,quarantined_at,created_at,updated_at",
            )
            .in("improvement_id", improvementIds)
            .order("updated_at", { ascending: false })
            .limit(80)
        : Promise.resolve({ data: [], error: null, count: 0 }),
    ]);

  const learningCases = rows<LearningRow>(learningResult);
  const regressions = rows<RegressionRow>(regressionResult);
  const activity = rows<ActivityRow>(activityResult);
  const autofixJobs = rows<AutofixRow>(autofixResult);

  const activeIncidents = incidents.filter((row) =>
    ["open", "monitoring"].includes(row.status),
  );
  const repeatedIncidents = activeIncidents.filter(
    (row) => numberValue(row.occurrence_count) >= 2,
  );
  const approvalRequired = improvements.filter(
    (row) => row.requires_approval || row.status === "approval_required",
  );
  const appliedImprovements = improvements.filter(
    (row) => Boolean(row.applied_at) || APPLIED_IMPROVEMENT_STATES.has(row.status),
  );

  return {
    generatedAt: new Date().toISOString(),
    scope: AI_SAURUS_SOURCE,
    summary: {
      activeIncidents: activeIncidents.length,
      repeatedIncidents: repeatedIncidents.length,
      learningCases: learningCases.length,
      appliedImprovements: appliedImprovements.length,
      approvalRequired: approvalRequired.length,
      verifiedImprovements: improvements.filter((row) => row.status === "verified").length,
      regressedImprovements: improvements.filter((row) => row.status === "regressed").length,
      autofixActive: autofixJobs.filter((row) => ACTIVE_AUTOFIX_STATES.has(row.status)).length,
      autofixQuarantined: autofixJobs.filter((row) => row.status === "quarantined").length,
      recoveryQueued: recoveries.filter((row) => row.status === "queued").length,
      recoveryApprovalRequired: recoveries.filter(
        (row) => row.status === "approval_required",
      ).length,
    },
    incidents: incidents.slice(0, 40).map((row) => ({
      id: row.id,
      engine: cleanText(row.engine, 120),
      title: cleanText(row.title, 240),
      status: cleanText(row.status, 40),
      severity: cleanText(row.severity, 40),
      riskLevel: cleanText(row.risk_level, 40),
      errorCode: row.error_code ? cleanText(row.error_code, 160) : null,
      occurrenceCount: numberValue(row.occurrence_count),
      automaticRecoveryAttempts: numberValue(row.automatic_recovery_attempts),
      automaticRecoverySuccesses: numberValue(row.automatic_recovery_successes),
      learningState: cleanText(row.learning_state, 40),
      regressionState: cleanText(row.regression_state, 40),
      lastSeenAt: row.last_seen_at,
    })),
    learningCases: learningCases.slice(0, 40).map((row) => ({
      id: row.id,
      incidentId: row.incident_id,
      state: cleanText(row.state, 40),
      title: cleanText(row.title, 240),
      symptom: cleanText(row.symptom),
      rootCause: cleanText(row.root_cause),
      resolution: cleanText(row.resolution),
      preventionRule: cleanText(row.prevention_rule),
      confidence: numberValue(row.confidence),
      updatedAt: row.updated_at,
    })),
    regressions: regressions.slice(0, 40).map((row) => ({
      id: row.id,
      incidentId: row.incident_id,
      sourceRepo: cleanText(row.source_repo, 240),
      testPath: cleanText(row.test_path, 320),
      testName: cleanText(row.test_name, 320),
      protectedInvariant: cleanText(row.protected_invariant),
      status: cleanText(row.status, 40),
      workflowName: row.workflow_name ? cleanText(row.workflow_name, 240) : null,
      commitSha: row.commit_sha ? cleanText(row.commit_sha, 80) : null,
      updatedAt: row.updated_at,
    })),
    improvements: improvements.slice(0, 40).map((row) => ({
      id: row.id,
      learningCaseId: row.learning_case_id,
      incidentId: row.incident_id,
      engine: cleanText(row.engine, 120),
      errorCode: row.error_code ? cleanText(row.error_code, 160) : null,
      title: cleanText(row.title, 320),
      factSummary: cleanText(row.fact_summary),
      rootCause: cleanText(row.root_cause),
      changeSummary: cleanText(row.change_summary),
      expectedEffect: cleanText(row.expected_effect),
      improvementKind: cleanText(row.improvement_kind, 80),
      status: cleanText(row.status, 60),
      applicationMode: cleanText(row.application_mode, 60),
      riskLevel: cleanText(row.risk_level, 40),
      confidence: numberValue(row.confidence),
      requiresApproval: Boolean(row.requires_approval),
      targetRepo: row.target_repo ? cleanText(row.target_repo, 240) : null,
      targetTestName: row.target_test_name ? cleanText(row.target_test_name, 360) : null,
      appliedAt: row.applied_at,
      appliedReference: row.applied_reference
        ? cleanText(row.applied_reference, 360)
        : null,
      baselineEvents: numberValue(row.baseline_events),
      baselineFailures: numberValue(row.baseline_failures),
      baselineRecoveries: numberValue(row.baseline_recoveries),
      currentEvents: numberValue(row.current_events),
      currentFailures: numberValue(row.current_failures),
      currentRecoveries: numberValue(row.current_recoveries),
      baselineFailureRate: nullableNumber(row.baseline_failure_rate),
      currentFailureRate: nullableNumber(row.current_failure_rate),
      currentRecoveryRate: nullableNumber(row.current_recovery_rate),
      improvementPercent: nullableNumber(row.improvement_percent),
      measurementResult: cleanText(row.measurement_result, 60),
      lastMeasuredAt: row.last_measured_at,
      updatedAt: row.updated_at,
    })),
    activity: activity.slice(0, 60).map((row) => ({
      id: row.id,
      improvementId: row.improvement_id,
      eventType: cleanText(row.event_type, 60),
      fromStatus: row.from_status ? cleanText(row.from_status, 60) : null,
      toStatus: row.to_status ? cleanText(row.to_status, 60) : null,
      summary: cleanText(row.summary, 800),
      occurredAt: row.occurred_at,
    })),
    recoveries: recoveries.slice(0, 50).map((row) => ({
      id: row.id,
      incidentId: row.incident_id,
      engine: cleanText(row.engine, 120),
      action: cleanText(row.action, 180),
      status: cleanText(row.status, 60),
      attemptCount: numberValue(row.attempt_count),
      maxAttempts: numberValue(row.max_attempts),
      lastError: row.last_error ? cleanText(row.last_error, 320) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    autofixJobs: autofixJobs.slice(0, 40).map((row) => ({
      id: row.id,
      improvementId: row.improvement_id,
      targetRepo: cleanText(row.target_repo, 240),
      status: cleanText(row.status, 60),
      attempts: numberValue(row.attempts),
      maxAttempts: numberValue(row.max_attempts),
      githubRunId: row.github_run_id ? cleanText(row.github_run_id, 80) : null,
      branchName: row.branch_name ? cleanText(row.branch_name, 240) : null,
      prNumber: row.pr_number,
      commitSha: row.commit_sha ? cleanText(row.commit_sha, 80) : null,
      mergeSha: row.merge_sha ? cleanText(row.merge_sha, 80) : null,
      patchSummary: row.patch_summary ? cleanText(row.patch_summary, 800) : null,
      changedPaths: Array.isArray(row.changed_paths)
        ? row.changed_paths.map((path) => cleanText(path, 320)).slice(0, 30)
        : [],
      lastError: row.last_error ? cleanText(row.last_error, 360) : null,
      failureStage: row.failure_stage ? cleanText(row.failure_stage, 120) : null,
      failureStep: row.failure_step ? cleanText(row.failure_step, 160) : null,
      failureRunId: row.failure_run_id ? cleanText(row.failure_run_id, 120) : null,
      quarantinedAt: row.quarantined_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    recentEvents: recentEvents.slice(0, 50).map((row) => ({
      id: row.id,
      engine: cleanText(row.engine, 120),
      eventType: cleanText(row.event_type, 120),
      status: cleanText(row.status, 60),
      severity: cleanText(row.severity, 40),
      riskLevel: cleanText(row.risk_level, 40),
      runId: row.run_id ? cleanText(row.run_id, 180) : null,
      stage: row.stage ? cleanText(row.stage, 160) : null,
      errorCode: row.error_code ? cleanText(row.error_code, 160) : null,
      automaticRecovery: Boolean(row.automatic_recovery),
      recoveryAction: row.recovery_action
        ? cleanText(row.recovery_action, 180)
        : null,
      occurredAt: row.occurred_at,
    })),
  };
}
