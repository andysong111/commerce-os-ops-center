import {
  mobileWorkCenterConfig,
  verifyMobileWorkCenterAgent,
} from "@/lib/mobileWorkCenterAuth";
import { restockWorker } from "@/lib/restockAlertStore";
import { RestockInputError } from "@/lib/restockAlertCore";
export const dynamic = "force-dynamic";
export const maxDuration = 90;
export async function POST(request: Request) {
  const cfg = mobileWorkCenterConfig();
  const reply = (v: unknown, status = 200) =>
    Response.json(v, {
      status,
      headers: { "cache-control": "private, no-store" },
    });
  if (!cfg || !verifyMobileWorkCenterAgent(request, cfg.agentToken))
    return reply({}, 403);
  try {
    const text = await request.text();
    if (text.length > 12000) return reply({}, 413);
    const raw = JSON.parse(text);
    if (!raw || typeof raw !== "object") return reply({}, 400);
    return reply(await restockWorker(cfg.ownerId, cfg.agentToken, raw));
  } catch (e) {
    return reply(
      { error: "RESTOCK_WORKER_UNAVAILABLE" },
      e instanceof RestockInputError ? 409 : 503,
    );
  }
}
