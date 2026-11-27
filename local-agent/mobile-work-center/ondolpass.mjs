import { listChromeTargets, withCdpTarget } from "../src/chrome-cdp.mjs";

const CENTER = "http://127.0.0.1:43121";
const LIMIT = 25 * 60_000;

// This function is evaluated only on the single canonical PC Work Center tab.
// It uses fixed extension messages and exact selected draft/evidence, never
// forwards an arbitrary script, URL, selectors, or DevTools methods.
export async function runInWorkCenter(command, limit) {
  const ready = location.origin === "http://127.0.0.1:43121" && location.pathname === "/";
  if (!ready || typeof browserWorkActive !== "function" || browserWorkActive() || ondolPassTrackingCapabilityRequestId) {
    return { status: "needs_pc", code: "EXTENSION_UNAVAILABLE" };
  }
  const unavailable = { status: "needs_pc", code: "EXTENSION_UNAVAILABLE" };
  const capabilities = await requestOndolPassTrackingCapabilities().catch(() => null);
  if (capabilities?.ok !== true || browserWorkActive()) return unavailable;

  const requestId = `mobile-ondolpass-${command.id}`;
  const marker = `reserved-${requestId}`;
  let posted = false;
  ondolPassRequestId = marker;
  try {
    let config;
    let receiptContext;
    if (command.actionId === "ondolpass-application") {
      if (command.confirmed !== true) return unavailable;
      const prepared = await request("/api/ondolpass/prepare", { method: "POST", body: JSON.stringify({ draftId: command.draftId }) });
      const plan = prepared.result;
      if (plan?.draftId !== command.draftId || !Array.isArray(plan?.lines) || !plan.lines.length) return { status: "needs_pc", code: "MISSING_PROOF" };
      config = {
        message: "COMMERCE_OS_ONDOLPASS_RUN", result: "COMMERCE_OS_ONDOLPASS_RESULT",
        accepted: "COMMERCE_OS_ONDOLPASS_ACCEPTED", payload: { plan },
      };
    } else if (command.actionId === "ondolpass-tracking") {
      if (command.confirmed !== true) return unavailable;
      config = {
        message: "COMMERCE_OS_ONDOLPASS_TRACKING_RUN", result: "COMMERCE_OS_ONDOLPASS_TRACKING_RESULT",
        accepted: "COMMERCE_OS_ONDOLPASS_TRACKING_ACCEPTED",
        payload: { confirmed: true, scope: "ALL", requestedOrderNumbers: [], requestedOrderMappings: [], protocolVersion: "" },
      };
      // Let the existing UI record and show the same tracking receipt/review.
      ondolPassTrackingCurrentScope = "ALL";
      ondolPassTrackingCurrentRequestedOrders = [];
      ondolPassTrackingCurrentRequestedMappings = [];
      ondolPassTrackingCurrentAutomatic = false;
      ondolPassTrackingRequestId = requestId;
    } else if (command.actionId === "ondolpass-receipt-status") {
      const response = await request(`/api/ondolpass/receipt-context?draftId=${encodeURIComponent(command.draftId)}`, { method: "GET" });
      receiptContext = response.result;
      if (receiptContext?.observation?.complete === true) return { status: "completed", code: "DONE" };
      if (!receiptContext?.evidenceHash || !receiptContext.applications?.length) return { status: "needs_pc", code: "MISSING_PROOF" };
      config = {
        message: "COMMERCE_OS_ONDOLPASS_RECEIPT_COLLECT", result: "COMMERCE_OS_ONDOLPASS_RECEIPT_RESULT",
        payload: { draftId: command.draftId, evidenceHash: receiptContext.evidenceHash, applications: receiptContext.applications },
      };
    } else {
      return unavailable;
    }

    const outcome = await new Promise((resolve) => {
      const timer = window.setTimeout(() => finish(null), limit);
      function finish(value) {
        window.clearTimeout(timer);
        window.removeEventListener("message", listener);
        resolve(value);
      }
      function listener(event) {
        const message = event.data;
        if (event.source !== window || event.origin !== location.origin || message?.source !== "commerce-os-extension" || message.requestId !== requestId) return;
        if (config.accepted && message.type === config.accepted && message.payload?.ok !== true) finish(message.payload);
        if (message.type === config.result) finish(message.payload);
      }
      window.addEventListener("message", listener);
      posted = true;
      window.postMessage({ source: "commerce-os-control-center", type: config.message, requestId, ...config.payload }, location.origin);
    });
    if (!outcome) return { status: "ambiguous", code: "MISSING_PROOF" };
    if (outcome.ok !== true) return { status: command.execute ? "ambiguous" : "needs_pc", code: "CHECK_PC" };
    if (command.actionId === "ondolpass-application" && outcome.applicationSubmitted !== false) return { status: "ambiguous", code: "MISSING_PROOF" };
    if (command.actionId === "ondolpass-tracking" && outcome.reviewRequired?.length) return { status: "needs_pc", code: "PARTIAL_RESULT" };
    if (receiptContext) {
      const recorded = await request("/api/ondolpass/receipt-observation", {
        method: "POST",
        body: JSON.stringify({
          draftId: command.draftId, evidenceHash: receiptContext.evidenceHash,
          observedAt: outcome.observedAt || new Date().toISOString(), applications: outcome.applications, trigger: "MANUAL",
        }),
      });
      if (!recorded.result?.observation) return { status: "ambiguous", code: "MISSING_PROOF" };
    }
    return { status: "completed", code: "DONE" };
  } catch {
    return posted ? { status: "ambiguous", code: "RESULT_UNCERTAIN" } : { status: "needs_pc", code: "REJECTED_BY_PC" };
  } finally {
    if (ondolPassRequestId === marker) ondolPassRequestId = "";
    if (ondolPassTrackingRequestId === requestId) ondolPassTrackingRequestId = "";
  }
}

export function createOndolPassAdapter({ listTargets = listChromeTargets, withTarget = withCdpTarget } = {}) {
  async function evaluate(expression, timeout = 4_000) {
    const listing = await listTargets({ chromeDebugBaseUrl: "http://127.0.0.1:9222" });
    const tabs = listing.targets.filter((tab) => {
      try {
        const url = new URL(tab.url);
        const socket = new URL(tab.webSocketDebuggerUrl);
        return tab.type === "page" && url.origin === CENTER && url.pathname === "/" &&
          socket.origin === "ws://127.0.0.1:9222" && socket.pathname === `/devtools/page/${tab.id}`;
      } catch {
        return false;
      }
    });
    if (tabs.length !== 1) return null;
    return withTarget(tabs[0], async (session) => {
      const reply = await session.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, timeout);
      if (reply.exceptionDetails) throw new Error("ONDOLPASS_TAB_PROBE_FAILED");
      return reply.result?.value ?? null;
    });
  }
  return {
    async available() {
      const value = await evaluate(`location.origin === ${JSON.stringify(CENTER)} && location.pathname === "/" && typeof browserWorkActive === "function" && ({ready:true,busy:browserWorkActive()})`);
      return value || { ready: false, busy: false };
    },
    async run(command) {
      const value = await evaluate(`(${runInWorkCenter.toString()})(${JSON.stringify(command)}, ${LIMIT})`, LIMIT + 60_000);
      return value || { status: "needs_pc", code: "EXTENSION_UNAVAILABLE" };
    },
  };
}
