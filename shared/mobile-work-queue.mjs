import { createHash } from "node:crypto";
import { AGENT_ONLINE_MS, REQUEST_MAX_AGE_MS, isAgentOnline, isMobileRequestId, normalizeAgentStatus, normalizeWorkRequest } from "./mobile-work-center.mjs";

const TERMINAL_STATES = new Set(["completed", "failed", "needs_pc", "ambiguous"]);
const PUBLIC_CODES = new Set([
  "PC_READY", "DONE", "CHECK_PC", "RESULT_UNCERTAIN", "AGENT_BUSY", "REJECTED_BY_PC",
  "LOGIN_REQUIRED", "LOGIN_EXPIRED", "MISSING_PROOF", "PARTIAL_RESULT", "EXTENSION_UNAVAILABLE",
]);

export function emptyQueue() {
  return { agent: null, pending: null, jobs: [] };
}

function updateJob(state, job, patch) {
  return { ...state, jobs: [ { ...job, ...patch }, ...state.jobs.filter(({ id }) => id !== job.id)].slice(0, 20) };
}

function isActive(job) {
  return job?.status === "queued" || job?.status === "running" || job?.status === "ambiguous";
}

export function publicQueue(state, now) {
  return {
    agent: {
      connected: isAgentOnline(state.agent, now) && state.agent.ready,
      busy: state.agent?.busy === true,
      actions: state.agent?.actions ?? [],
      lastSeenAt: state.agent?.seenAt ?? null,
    },
    jobs: state.jobs.map(({ id, actionId, execute, status, updatedAt, code }) => ({
      id, actionId, execute, status, updatedAt, code,
      connectionLost: status === "running" && (!state.agent || now - state.agent.seenAt >= AGENT_ONLINE_MS),
    })),
  };
}

export function applyWorkQueue(state, event, now) {
  const job = state.jobs[0];
  if (event.type === "enqueue") {
    const command = normalizeWorkRequest(event.command);
    if (!command) return { status: 400, code: "INVALID_ACTION" };
    const fingerprint = createHash("sha256").update(JSON.stringify(command)).digest("hex");
    const previous = state.jobs.find(({ id }) => id === command.id);
    if (previous) return previous.fingerprint === fingerprint ? { status: 200 } : { status: 409, code: "REQUEST_ID_REUSED" };
    if (command.issuedAt > now + 30_000 || now - command.issuedAt >= REQUEST_MAX_AGE_MS) return { status: 409, code: "REQUEST_EXPIRED" };
    if (isActive(job)) return { status: 409, code: "JOB_ACTIVE" };
    if (!isAgentOnline(state.agent, now) || !state.agent.ready) return { status: 503, code: "PC_OFFLINE" };
    if (state.agent.busy) return { status: 409, code: "PC_BUSY" };
    if (!state.agent.actions.includes(command.actionId)) return { status: 409, code: "ACTION_UNAVAILABLE" };
    const entry = { id: command.id, actionId: command.actionId, execute: command.execute, fingerprint, status: "queued", updatedAt: now, code: null };
    return { status: 202, state: updateJob({ ...state, pending: command }, entry, {}) };
  }

  if (event.type === "poll") {
    const agent = normalizeAgentStatus(event.agent, now);
    const stateChanged = !state.agent || now - state.agent.seenAt >= 45_000
      || state.agent.ready !== agent.ready || state.agent.busy !== agent.busy
      || JSON.stringify(state.agent.actions) !== JSON.stringify(agent.actions);
    const next = stateChanged ? { ...state, agent } : state;
    if (job?.status === "running" && event.canClaim === false && event.progress?.id === job.id
      && [null, "LOGIN_CHECKING", "KAKAO_CAPTCHA"].includes(event.progress.code) && job.code !== event.progress.code) {
      return { status: 200, state: updateJob(next, job, { code: event.progress.code, updatedAt: now }) };
    }
    if (job?.status === "running" && event.canClaim === true && now - job.updatedAt >= REQUEST_MAX_AGE_MS) {
      return { status: 200, state: updateJob(next, job, { status: "ambiguous", code: "RESULT_UNCERTAIN", updatedAt: now }) };
    }
    if (job?.status !== "queued" || !state.pending) return { status: 200, state: next === state ? undefined : next };
    if (now - state.pending.issuedAt >= REQUEST_MAX_AGE_MS) {
      return { status: 200, state: updateJob({ ...next, pending: null }, job, { status: "expired", updatedAt: now }) };
    }
    if (event.canClaim !== true || !agent.ready || agent.busy || !agent.actions.includes(job.actionId)) {
      return { status: 200, state: next === state ? undefined : next };
    }
    return {
      status: 200, command: state.pending,
      state: updateJob({ ...next, pending: null }, job, { status: "running", updatedAt: now }),
    };
  }

  if (event.type === "finish" && isMobileRequestId(event.id) && TERMINAL_STATES.has(event.status) && PUBLIC_CODES.has(event.code)) {
    if (job?.id !== event.id) return { status: 409, code: "JOB_NOT_CURRENT" };
    if (job.status === event.status && job.code === event.code) return { status: 200 };
    if (job.status !== "running") return { status: 409, code: "JOB_NOT_RUNNING" };
    return { status: 200, state: updateJob(state, job, { status: event.status, code: event.code, updatedAt: now }) };
  }

  // Release only an acknowledged ambiguous result after the owner checks the
  // original marketplace, printer or local execution receipt.
  if (event.type === "acknowledge" && event.confirmed === true && isMobileRequestId(event.id) && job?.id === event.id && job.status === "ambiguous") {
    return { status: 200, state: updateJob(state, job, { status: "acknowledged", updatedAt: now }) };
  }
  return { status: 400, code: "INVALID_EVENT" };
}
