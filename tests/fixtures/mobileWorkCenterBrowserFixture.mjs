// Local-only fixture. The only accepted command reads the live PC's health
// through the adapter. Every other command is rejected before any business API.
import { createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createMobileWorkWorker, createWindowsWorkAdapter } from "../../local-agent/mobile-work-center/worker.mjs";
import { MOBILE_ACTIONS } from "../../shared/mobile-work-center.mjs";

const webOrigin = "http://127.0.0.1:43287";
const fixtureOrigin = "http://127.0.0.1:43290";
const ownerId = "10000000-1000-4000-9000-100000000001";
const agentToken = "test-fixture-mobile-operator-token-0123456789";
const configured = new Map();
const user = (owner) => ({ id: owner ? ownerId : "20000000-1000-4000-9000-100000000002", email: owner ? "owner@example.test" : "other@example.test", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-11-27T00:00:00Z" });
let stored = null;

function send(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(value));
}

async function read(request) {
  let text = "";
  for await (const chunk of request) text += chunk;
  return JSON.parse(text);
}

function createTestSession(account) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = [b64({ alg: "HS256", typ: "JWT" }), b64({ sub: account.id, exp: issuedAt + 3600, iat: issuedAt, role: "authenticated" })].join(".");
  const signature = createHmac("sha256", "not-a-real-fixture-key").update(unsigned).digest("base64url");
  const token = `${unsigned}.${signature}`;
  configured.set(token, account);
  return { access_token: token, refresh_token: "fixture-refresh-token", token_type: "bearer", expires_in: 3600, expires_at: issuedAt + 3600, user: account };
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, fixtureOrigin);
  if (url.pathname === "/auth/v1/token" && request.method === "POST") {
    const input = await read(request);
    if (input.password !== "fixture-pass-123" || !["owner@example.test", "other@example.test"].includes(input.email)) return send(response, 401, { message: "Invalid test credentials" });
    return send(response, 200, createTestSession(user(input.email === "owner@example.test")));
  }
  if (url.pathname === "/auth/v1/user") {
    const account = configured.get(request.headers.authorization?.slice(7));
    return account ? send(response, 200, account) : send(response, 401, { message: "Invalid test session" });
  }
  if (url.pathname === "/auth/v1/.well-known/jwks.json") return send(response, 200, { keys: [] });
  if (url.pathname !== "/rest/v1/commerce_os_remote_work_center" || request.headers.apikey !== "sb_secret_fixture-only") return send(response, 404, { message: "Fixture route not found" });
  if (request.method === "GET") return send(response, 200, stored ? [stored] : []);
  const input = await read(request);
  if (request.method === "POST" && !stored && input.owner_id === ownerId) {
    stored = input;
    return send(response, 201, [stored]);
  }
  if (request.method === "PATCH" && stored && url.searchParams.get("revision") === `eq.${stored.revision}`) {
    stored = { ...stored, ...input };
    return send(response, 200, [stored]);
  }
  return send(response, 200, []);
});
await new Promise((resolve, reject) => server.once("error", reject).listen(43290, "127.0.0.1", resolve));

const next = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", "43287", "--webpack"], {
  stdio: "inherit",
  env: {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: "1",
    NEXT_PUBLIC_SUPABASE_URL: fixtureOrigin,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture-only",
    SUPABASE_SECRET_KEY: "sb_secret_fixture-only",
    MOBILE_WORK_CENTER_OWNER_ID: ownerId,
    MOBILE_WORK_CENTER_AGENT_TOKEN: agentToken,
    MOBILE_WORK_CENTER_ORIGIN: webOrigin,
  },
});
const pc = createWindowsWorkAdapter();
const worker = createMobileWorkWorker({
  endpoint: `${webOrigin}/api/mobile-work-center`, agentToken,
  adapter: {
    async status() {
      const health = await fetch("http://127.0.0.1:43121/health", { signal: AbortSignal.timeout(5000) }).then((r) => r.json()).catch(() => null);
      return { ready: health?.ok === true, busy: false, actions: Object.keys(MOBILE_ACTIONS) };
    },
    execute(command) {
      if (command.actionId !== "connection-check") return { status: "failed", code: "REJECTED_BY_PC" };
      return pc.execute(command);
    },
  },
});
const wait = setInterval(() => void worker.tick(), 1200);
next.once("exit", (code) => { clearInterval(wait); server.close(); process.exitCode = code || 0; });
process.on("SIGINT", () => next.kill());
process.on("SIGTERM", () => next.kill());
