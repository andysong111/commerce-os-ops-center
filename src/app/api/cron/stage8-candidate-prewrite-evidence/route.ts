import {
  createCandidateDemandParityRequest,
  loadCandidateDemandParityStatus,
  loadLatestCandidateSalesSnapshot,
  runCandidateDemandParityStep,
  type CandidateDemandParityStatus,
  type CandidateSalesSnapshot,
} from "@/lib/stage8CandidateDemandParity";
import {
  createCandidateMismatchEvidenceRequest,
  loadCandidateMismatchEvidenceStatus,
  runCandidateMismatchEvidenceStep,
  type CandidateMismatchEvidenceStatus,
} from "@/lib/stage8CandidateMismatchEvidence";
import { loadCandidatePromotionGate } from "@/lib/stage8CandidatePromotionGate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_STEPS_PER_INVOCATION = 3;
const EXTRA_STEP_START_BUDGET_MS = 12_000;

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET?.trim();
  const supplied = request.headers.get("authorization")?.trim();
  return Boolean(expected && supplied === `Bearer ${expected}`);
}

function safeMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error ?? ""))
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[A-Za-z0-9+/=_-]{48,}/g, "[redacted]")
    .slice(0, 1000);
}

function candidateSalesStillCollecting(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    message.startsWith("CANDIDATE_SALES_COLLECTION_INCOMPLETE:") ||
    message === "CANDIDATE_SALES_REPORT_REQUIRED" ||
    message === "CANDIDATE_SALES_REQUEST_REQUIRED"
  );
}

function parityMatchesCandidate(
  parity: CandidateDemandParityStatus,
  candidate: CandidateSalesSnapshot,
) {
  return (
    parity.candidateSalesRequestId === candidate.salesRequestId &&
    parity.analysisAsOf === candidate.analysisAsOf &&
    parity.planningContentFingerprint === candidate.planningContentFingerprint &&
    parity.candidateEventFingerprint === candidate.eventFingerprint &&
    parity.candidatePlanFingerprint === candidate.planFingerprint
  );
}

function evidenceMatchesCandidate(
  evidence: CandidateMismatchEvidenceStatus,
  parity: CandidateDemandParityStatus,
  candidate: CandidateSalesSnapshot,
) {
  return Boolean(
    parity.requestId &&
      parity.report &&
      evidence.candidateSalesRequestId === candidate.salesRequestId &&
      evidence.candidateParityRequestId === parity.requestId &&
      evidence.analysisAsOf === candidate.analysisAsOf &&
      evidence.planningContentFingerprint === candidate.planningContentFingerprint &&
      evidence.candidateEventFingerprint === candidate.eventFingerprint &&
      evidence.candidatePlanFingerprint === candidate.planFingerprint &&
      evidence.candidateParityFingerprint === parity.report.parityFingerprint,
  );
}

async function runParityBurst() {
  const startedAt = Date.now();
  let stepCount = 0;
  let result = await runCandidateDemandParityStep();
  stepCount += 1;
  while (
    stepCount < MAX_STEPS_PER_INVOCATION &&
    result.processed === true &&
    result.state === "RUNNING" &&
    Date.now() - startedAt < EXTRA_STEP_START_BUDGET_MS
  ) {
    result = await runCandidateDemandParityStep();
    stepCount += 1;
  }
  return { ...result, stepCount, burstElapsedMs: Date.now() - startedAt };
}

async function runEvidenceBurst() {
  const startedAt = Date.now();
  let stepCount = 0;
  let result = await runCandidateMismatchEvidenceStep();
  stepCount += 1;
  while (
    stepCount < MAX_STEPS_PER_INVOCATION &&
    result.processed === true &&
    result.state === "RUNNING" &&
    Date.now() - startedAt < EXTRA_STEP_START_BUDGET_MS
  ) {
    result = await runCandidateMismatchEvidenceStep();
    stepCount += 1;
  }
  return { ...result, stepCount, burstElapsedMs: Date.now() - startedAt };
}

async function gateResult() {
  const gate = await loadCandidatePromotionGate();
  return {
    ok: true,
    processed: false,
    busy: false,
    writesEnabled: false,
    approvalEnabled: false,
    state: gate.safeToApply ? "READY_CANARY" : "BLOCKED",
    message: gate.message,
    promotionGate: {
      state: gate.state,
      safeToApply: gate.safeToApply,
      candidateSalesRequestId: gate.candidateSalesRequestId,
      candidatePlanFingerprint: gate.candidatePlanFingerprint,
      candidateParityFingerprint: gate.candidateParityFingerprint,
      evidenceFingerprint: gate.evidenceFingerprint,
      promotionFingerprint: gate.promotionFingerprint,
      failedChecks: gate.checks.filter((check) => !check.passed),
    },
  };
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401 });
  }

  let candidate: CandidateSalesSnapshot;
  try {
    candidate = await loadLatestCandidateSalesSnapshot();
  } catch (error) {
    if (candidateSalesStillCollecting(error)) {
      return Response.json({
        ok: true,
        processed: false,
        busy: false,
        writesEnabled: false,
        approvalEnabled: false,
        state: "WAITING_SALES",
        message:
          "최신 canonical 판매 후보 수집·report 완료를 기다립니다. 후보 완료 전 parity/evidence를 만들지 않습니다.",
      });
    }
    return Response.json(
      {
        ok: false,
        processed: false,
        writesEnabled: false,
        approvalEnabled: false,
        state: "FAILED",
        code: "STAGE8_CANDIDATE_PREWRITE_SALES_READ_FAILED",
        message: safeMessage(error),
      },
      { status: 500 },
    );
  }

  try {
    let parity = await loadCandidateDemandParityStatus();

    if (!parityMatchesCandidate(parity, candidate)) {
      const created = await createCandidateDemandParityRequest();
      return Response.json({
        ok: true,
        processed: true,
        busy: true,
        writesEnabled: false,
        approvalEnabled: false,
        state: "QUEUED",
        phase: "PARITY",
        requestId: created.requestId,
        candidateSalesRequestId: created.candidateSalesRequestId,
        message:
          "현재 판매 후보에 고정된 쓰기 전 parity를 새로 접수했습니다. Product Master 쓰기는 하지 않습니다.",
      });
    }

    if (parity.state === "QUEUED" || parity.state === "RUNNING") {
      const result = await runParityBurst();
      return Response.json({
        ok: result.state !== "FAILED",
        processed: result.processed,
        busy: result.state === "RUNNING",
        writesEnabled: false,
        approvalEnabled: false,
        state: result.state,
        phase: "PARITY",
        candidateSalesRequestId: candidate.salesRequestId,
        result,
      });
    }

    if (parity.state === "FAILED") {
      return Response.json({
        ok: true,
        processed: false,
        busy: false,
        writesEnabled: false,
        approvalEnabled: false,
        state: "BLOCKED",
        phase: "PARITY",
        message:
          parity.message ||
          "현재 후보 parity가 실패하여 자동 재시작하지 않습니다. 원인을 보존한 채 차단합니다.",
      });
    }

    if (parity.state === "MATCH") {
      return Response.json(await gateResult());
    }

    if (parity.state !== "MISMATCH" || !parity.report) {
      return Response.json({
        ok: true,
        processed: false,
        busy: false,
        writesEnabled: false,
        approvalEnabled: false,
        state: "BLOCKED",
        phase: "PARITY",
        message: `예상하지 않은 candidate parity 상태입니다: ${parity.state}`,
      });
    }

    let evidence = await loadCandidateMismatchEvidenceStatus();
    if (!evidenceMatchesCandidate(evidence, parity, candidate)) {
      try {
        const created = await createCandidateMismatchEvidenceRequest();
        return Response.json({
          ok: true,
          processed: true,
          busy: true,
          writesEnabled: false,
          approvalEnabled: false,
          state: "QUEUED",
          phase: "EVIDENCE",
          requestId: created.requestId,
          candidateSalesRequestId: created.candidateSalesRequestId,
          candidateParityRequestId: created.candidateParityRequestId,
          targetCount: created.targetBarcodes.length,
          message:
            "현재 candidate/parity에 고정된 원주문행 mismatch evidence를 접수했습니다. Shopling GET만 사용합니다.",
        });
      } catch (error) {
        return Response.json({
          ok: true,
          processed: false,
          busy: false,
          writesEnabled: false,
          approvalEnabled: false,
          state: "BLOCKED",
          phase: "EVIDENCE",
          message: safeMessage(error),
        });
      }
    }

    evidence = await loadCandidateMismatchEvidenceStatus();
    if (evidence.state === "QUEUED" || evidence.state === "RUNNING") {
      const result = await runEvidenceBurst();
      return Response.json({
        ok: result.state !== "FAILED",
        processed: result.processed,
        busy: result.state === "RUNNING",
        writesEnabled: false,
        approvalEnabled: false,
        state: result.state,
        phase: "EVIDENCE",
        candidateSalesRequestId: candidate.salesRequestId,
        candidateParityRequestId: parity.requestId,
        result,
      });
    }

    if (evidence.state === "FAILED") {
      return Response.json({
        ok: true,
        processed: false,
        busy: false,
        writesEnabled: false,
        approvalEnabled: false,
        state: "BLOCKED",
        phase: "EVIDENCE",
        message:
          evidence.message ||
          "현재 candidate mismatch evidence가 실패하여 쓰기 전 게이트를 차단합니다.",
      });
    }

    if (evidence.state === "COMPLETE") {
      return Response.json(await gateResult());
    }

    return Response.json({
      ok: true,
      processed: false,
      busy: false,
      writesEnabled: false,
      approvalEnabled: false,
      state: "BLOCKED",
      phase: "EVIDENCE",
      message: `예상하지 않은 candidate evidence 상태입니다: ${evidence.state}`,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        processed: false,
        writesEnabled: false,
        approvalEnabled: false,
        state: "FAILED",
        code: "STAGE8_CANDIDATE_PREWRITE_WORKER_FAILED",
        message: safeMessage(error),
      },
      { status: 500 },
    );
  }
}
