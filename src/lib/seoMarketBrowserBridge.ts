type UnknownRecord = Record<string, unknown>;
function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

const BRIDGE_PROBE = "commerce-os-shopling-market-auto-probe-v0330";
const BRIDGE_PROBE_ACK = "commerce-os-shopling-market-auto-probe-ack-v0330";
const BRIDGE_HANDOFF = "commerce-os-shopling-market-auto-handoff-v0330";
const BRIDGE_HANDOFF_ACK = "commerce-os-shopling-market-auto-handoff-ack-v0330";
export function createHandoffToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function waitForBridgeAck(type: string, requestId: string, timeoutMs: number) {
  return new Promise<UnknownRecord | null>((resolve) => {
    let done = false;
    const finish = (value: UnknownRecord | null) => {
      if (done) return;
      done = true;
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timer);
      resolve(value);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin)
        return;
      const row = record(event.data);
      if (text(row.type) !== type || text(row.requestId) !== requestId) return;
      finish(row);
    };
    const timer = window.setTimeout(() => finish(null), timeoutMs);
    window.addEventListener("message", onMessage);
  });
}

export async function probeExtension() {
  const requestId = crypto.randomUUID();
  const pending = waitForBridgeAck(BRIDGE_PROBE_ACK, requestId, 1_800);
  window.postMessage({ type: BRIDGE_PROBE, requestId }, window.location.origin);
  const ack = await pending;
  return ack?.ok === true && text(ack.version) === "0.3.30";
}

export async function handoffToExtension(
  orchestrationId: string,
  token: string,
) {
  const requestId = crypto.randomUUID();
  const pending = waitForBridgeAck(BRIDGE_HANDOFF_ACK, requestId, 3_000);
  window.postMessage(
    { type: BRIDGE_HANDOFF, requestId, orchestrationId, token },
    window.location.origin,
  );
  const ack = await pending;
  return ack?.ok === true;
}
