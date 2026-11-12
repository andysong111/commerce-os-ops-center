const TERMINAL_STATES = new Set([
  "completed",
  "completed_with_exceptions",
  "exception",
  "cancelled",
]);

const ACTIVE_STATES = new Set([
  "waiting_upload",
  "uploading",
  "market_ready",
  "market_claimed",
  "market_running",
]);

type MarketAutoReconnectInput = {
  state: string;
  agentId?: string | null;
  leaseUntil?: string | null;
  nowMs?: number;
};

export type MarketAutoReconnectDecision = {
  reconnectAllowed: boolean;
  terminal: boolean;
  activeAgent: boolean;
  nextState: string;
};

export function decideMarketAutoReconnect(
  input: MarketAutoReconnectInput,
): MarketAutoReconnectDecision {
  const state = String(input.state ?? "").trim();
  if (TERMINAL_STATES.has(state)) {
    return {
      reconnectAllowed: false,
      terminal: true,
      activeAgent: false,
      nextState: state,
    };
  }
  if (!ACTIVE_STATES.has(state)) {
    return {
      reconnectAllowed: false,
      terminal: false,
      activeAgent: false,
      nextState: state,
    };
  }

  const nowMs = Number.isFinite(input.nowMs) ? Number(input.nowMs) : Date.now();
  const leaseUntilMs = Date.parse(String(input.leaseUntil ?? ""));
  const leaseActive = Number.isFinite(leaseUntilMs) && leaseUntilMs > nowMs;
  const claimedOrRunning = ["market_claimed", "market_running"].includes(state);
  const activeAgent =
    claimedOrRunning && Boolean(String(input.agentId ?? "").trim()) && leaseActive;

  if (activeAgent) {
    return {
      reconnectAllowed: false,
      terminal: false,
      activeAgent: true,
      nextState: state,
    };
  }

  return {
    reconnectAllowed: true,
    terminal: false,
    activeAgent: false,
    nextState: claimedOrRunning ? "market_ready" : state,
  };
}
