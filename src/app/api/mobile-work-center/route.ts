import { mobileWorkCenterConfig, verifyMobileWorkCenterAgent, verifyMobileWorkCenterOwner } from "@/lib/mobileWorkCenterAuth";
import { runMobileWorkQueue } from "@/lib/mobileWorkCenterStore";
import { MOBILE_DRAFT_ID } from "../../../../shared/mobile-work-center.mjs";

const HEADERS = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const RESPONSES = { 401: "LOGIN_REQUIRED", 403: "FORBIDDEN" } as const;
const MAX_EVENT_BYTES = 8 * 1024;

function reply(status: number, body: Record<string, unknown>) {
  return Response.json(body, { status, headers: HEADERS });
}

async function readEvent(request: Request): Promise<Record<string, unknown> | null> {
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json" || !request.body) return null;
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > MAX_EVENT_BYTES) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    const value = JSON.parse(text + decoder.decode());
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

async function handle(request: Request) {
  try {
    const config = mobileWorkCenterConfig();
    if (!config) return reply(503, { ok: false, code: "NOT_CONFIGURED" });
    const agent = request.method === "POST" && request.headers.has("authorization");
    if (agent) {
      if (!verifyMobileWorkCenterAgent(request, config.agentToken)) return reply(403, { ok: false, code: "FORBIDDEN" });
    } else {
      if (request.method === "POST" && request.headers.get("origin") !== config.origin) return reply(403, { ok: false, code: "FORBIDDEN" });
      const authStatus = await verifyMobileWorkCenterOwner(config.ownerId);
      if (authStatus !== 200) return reply(authStatus, { ok: false, code: RESPONSES[authStatus] });
      if (request.method === "GET" && new URL(request.url).searchParams.get("drafts") === "1") {
        const { loadFastPurchaseInternalDrafts } = await import("@/lib/fastPurchaseInternalDraft");
        const result = await loadFastPurchaseInternalDrafts();
        if (result.error) return reply(503, { ok: false, code: "DRAFTS_UNAVAILABLE" });
        const drafts = result.drafts.filter(({ draftId }) => MOBILE_DRAFT_ID.test(draftId)).slice(0, 30)
          .map(({ draftId, cycleStartDate, lineCount }) => ({ draftId, cycleStartDate, lineCount }));
        return reply(200, { ok: true, drafts });
      }
    }
    const event = request.method === "POST" ? await readEvent(request) : undefined;
    if (event === null || (event && !(agent ? ["poll", "finish"] : ["enqueue", "acknowledge"]).includes(String(event.type)))) {
      return reply(400, { ok: false, code: "INVALID_EVENT" });
    }
    const result = await runMobileWorkQueue(config.ownerId, event, agent);
    return reply(result.status, result.body);
  } catch (error) {
    console.error("mobile-work-center", error instanceof Error ? error.message : "unexpected_error");
    return reply(503, { ok: false, code: "QUEUE_UNAVAILABLE" });
  }
}

export const GET = handle;
export const POST = handle;
