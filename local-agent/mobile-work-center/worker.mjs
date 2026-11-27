import { setTimeout as delay } from "node:timers/promises";
import { mobileAction, normalizeWorkRequest, REQUEST_MAX_AGE_MS } from "../../shared/mobile-work-center.mjs";

const LOCAL_ORIGIN = "http://127.0.0.1:43121";
const DOMEGGOOK_ORIGIN = "http://127.0.0.1:43122";
const DOMEGGOOK_PATHS = Object.freeze({
  "domeggook-extension": "/api/work-center/run-all",
  "domeggook-withdrawal-check": "/api/work-center/withdrawal/dry-run-all",
  "domeggook-withdrawal-execute": "/api/work-center/withdrawal/execute-all",
});
const STANDARD_TIMEOUT = 15_000;
const JOB_TIMEOUT = 45 * 60_000;
const result = (status, code) => ({ status, code });
const LOCAL_PREFLIGHT_REJECTIONS = new Set([
  "LOCAL_WRITE_FORBIDDEN", "LOCAL_ACTION_NOT_ALLOWED", "LOCAL_ACTION_INTERACTIVE_ONLY",
  "LOCAL_DRAFT_ID_INVALID", "LOCAL_INVOICE_NUMBERS_INVALID", "LOCAL_INVOICE_GROUP_OVERLAP",
  "ALIBABA1688_UNPAID_ORDER_CONFIRMATION_REQUIRED", "LOCAL_1688_CANARY_REQUIRED",
  "SHOPLING_PICKING_API_APPROVAL_REQUIRED", "POPBILL_CREDENTIAL_REQUIRED",
]);

export function createWindowsWorkAdapter({ fetchImpl = fetch, wait = delay, now = Date.now, ondolpass = null } = {}) {
  async function request(url, options = {}, timeout = STANDARD_TIMEOUT) {
    const response = await fetchImpl(url, { cache: "no-store", redirect: "error", ...options, signal: AbortSignal.timeout(timeout) });
    const body = await response.json();
    return { status: response.status, ok: response.ok && body.ok === true, body };
  }

  async function getCenter() {
    const { ok, body } = await request(`${LOCAL_ORIGIN}/api/state`);
    if (!ok || !Array.isArray(body.state?.actions)) throw new Error("LOCAL_WORK_CENTER_OFFLINE");
    return body.state;
  }

  async function getDomeggook() {
    return request(`${DOMEGGOOK_ORIGIN}/api/work-center/state`, { headers: { Origin: LOCAL_ORIGIN } });
  }

  async function getCenterToken() {
    const response = await fetchImpl(`${LOCAL_ORIGIN}/`, { redirect: "error", signal: AbortSignal.timeout(STANDARD_TIMEOUT) });
    if (!response.ok) throw new Error("LOCAL_WORK_CENTER_OFFLINE");
    const html = await response.text();
    const token = html.match(/\blet TOKEN = "([a-f0-9]{48})";/)?.[1];
    if (!token) throw new Error("LOCAL_WORK_CENTER_PROTOCOL_CHANGED");
    return token;
  }

  function centerBusy(center) {
    return Boolean(center.activeRun || center.activeRuns?.length || center.pendingLoginAction);
  }

  async function status() {
    const [center, dome, extension] = await Promise.allSettled([getCenter(), getDomeggook(), ondolpass?.available()]);
    const actionIds = ["connection-check"];
    const centerState = center.status === "fulfilled" ? center.value : null;
    const domeState = dome.status === "fulfilled" && dome.value.ok ? dome.value.body.state : null;
    if (centerState) {
      for (const local of centerState.actions) {
        const action = mobileAction(local.id);
        const supported = action && (local.interactiveOnly === true
          ? action.kind === "extension" && extension.status === "fulfilled" && extension.value?.ready
          : action.kind === "local" && local.mutates !== action.readOnly);
        if (supported) actionIds.push(local.id);
      }
    }
    if (domeState) actionIds.push(...Object.keys(DOMEGGOOK_PATHS));
    return {
      ready: Boolean(centerState),
      busy: Boolean((centerState && centerBusy(centerState)) || domeState?.running || domeState?.withdrawalRunning || (extension.status === "fulfilled" && extension.value?.busy)),
      actions: actionIds,
    };
  }

  async function runLocal(command, action, center) {
    const local = center.actions.find(({ id }) => id === action.id);
    if (!local || local.interactiveOnly || local.mutates === action.readOnly) return result("needs_pc", "CHECK_PC");
    if (local.requiresShoplingLogin !== false && center.shoplingSession?.ready !== true) return result("needs_pc", "LOGIN_REQUIRED");
    const token = await getCenterToken();
    const data = {
      execute: command.execute,
      draftId: command.draftId,
      confirmed: command.confirmed,
      confirmation: command.confirmation,
      invoiceNumbers: command.invoiceNumbers,
      inventoryShortageInvoiceNumbers: command.inventoryShortageInvoiceNumbers,
      maxItems: action.id === "1688-cart-staging" && center.alibaba1688Canary?.draftId !== command.draftId ? 1 : undefined,
    };
    // Once the POST is attempted, a transport error is an ambiguous run, never a retry.
    const response = await request(`${LOCAL_ORIGIN}/api/actions/${action.id}`, {
      method: "POST",
      headers: { Origin: LOCAL_ORIGIN, "Content-Type": "application/json", "x-commerce-os-token": token },
      body: JSON.stringify(data),
    }, 120_000);
    if (!response.ok) {
      if (response.status === 409) return result("needs_pc", "AGENT_BUSY");
      if (LOCAL_PREFLIGHT_REJECTIONS.has(response.body.code)) return result("needs_pc", "REJECTED_BY_PC");
      return result("ambiguous", "RESULT_UNCERTAIN");
    }
    const { run } = response.body;
    if (typeof run?.runId !== "string" || !run.runId || run.actionId !== command.actionId) return result("ambiguous", "MISSING_PROOF");

    const deadline = now() + JOB_TIMEOUT;
    while (now() < deadline) {
      await wait(5_000);
      const current = await getCenter().catch(() => null);
      const receipt = current?.recentRuns?.find(({ runId, actionId }) => runId === run.runId && actionId === command.actionId);
      if (receipt?.status === "succeeded") return result("completed", "DONE");
      if (["failed", "needs_attention", "blocked", "cancelled", "canceled", "stopped", "interrupted", "partial"].includes(receipt?.status)) {
        return command.execute ? result("ambiguous", "CHECK_PC") : result("needs_pc", "CHECK_PC");
      }
    }
    return result("ambiguous", "MISSING_PROOF");
  }

  async function runDomeggook(command) {
    const ready = await getDomeggook().catch(() => null);
    if (!ready?.ok || ready.body.state?.running || ready.body.state?.withdrawalRunning) return result("needs_pc", "AGENT_BUSY");
    const response = await request(`${DOMEGGOOK_ORIGIN}${DOMEGGOOK_PATHS[command.actionId]}`, {
      method: "POST",
      headers: { Origin: LOCAL_ORIGIN, "Content-Type": "application/json" },
      body: "{}",
    }, JOB_TIMEOUT);
    if (!response.ok) return result("ambiguous", "RESULT_UNCERTAIN");
    const receipt = response.body.result;
    if (!Array.isArray(receipt?.results) || receipt.results.length !== 4) return result("ambiguous", "MISSING_PROOF");
    if (receipt.failed?.length || receipt.results.some((entry) => entry?.ok !== true)) {
      return result(command.execute ? "ambiguous" : "needs_pc", "PARTIAL_RESULT");
    }
    return result("completed", "DONE");
  }

  async function execute(raw) {
    const command = normalizeWorkRequest(raw);
    if (!command || now() - command.issuedAt >= REQUEST_MAX_AGE_MS || command.issuedAt > now() + 30_000) return result("failed", "REJECTED_BY_PC");
    const action = mobileAction(command.actionId);
    const center = await getCenter().catch(() => null);
    if (!center) return result("needs_pc", "CHECK_PC");
    if (action.kind === "diagnostic") return result("completed", "PC_READY");
    if (centerBusy(center)) return result("needs_pc", "AGENT_BUSY");
    try {
      if (action.kind === "domeggook") return await runDomeggook(command);
      if (action.kind === "extension") return ondolpass ? await ondolpass.run(command) : result("needs_pc", "EXTENSION_UNAVAILABLE");
      return await runLocal(command, action, center);
    } catch {
      return result("ambiguous", "RESULT_UNCERTAIN");
    }
  }

  return { execute, status };
}

export function createMobileWorkWorker({ endpoint, agentToken, adapter, fetchImpl = fetch, onError = () => {} }) {
  const url = new URL(endpoint);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "127.0.0.1"))
    || url.pathname !== "/api/mobile-work-center" || url.search || url.hash || url.username || url.password
    || !/^[A-Za-z0-9_-]{43,128}$/.test(agentToken)) throw new Error("MOBILE_WORK_AGENT_CONFIG_INVALID");
  let active = null;
  let tickInProgress = false;

  async function post(body) {
    const response = await fetchImpl(url, {
      method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(16_000),
      headers: { Authorization: `Bearer ${agentToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const value = await response.json();
    if (!response.ok || value.ok !== true) throw new Error(`MOBILE_RELAY_HTTP_${response.status}`);
    return value;
  }

  async function tick() {
    if (tickInProgress) return;
    tickInProgress = true;
    try {
      if (active?.receipt) {
        await post({ type: "finish", id: active.id, ...active.receipt });
        active = null;
      }
      const agent = await adapter.status();
      const data = await post({ type: "poll", agent, canClaim: !active });
      if (active || !data.command) return;
      active = { id: data.command.id, receipt: null };
      void Promise.resolve(adapter.execute(data.command)).then(
        (receipt) => { active.receipt = receipt; },
        () => { active.receipt = result("ambiguous", "RESULT_UNCERTAIN"); },
      );
    } catch (error) {
      onError(error instanceof Error ? error.message : "MOBILE_WORK_AGENT_REQUEST_FAILED");
    } finally {
      tickInProgress = false;
    }
  }
  return { tick, isActive: () => Boolean(active) };
}
