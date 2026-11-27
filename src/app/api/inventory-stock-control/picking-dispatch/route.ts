import {
  mobileWorkCenterConfig,
  verifyMobileWorkCenterAgent,
  verifyMobileWorkCenterOwner,
} from "@/lib/mobileWorkCenterAuth";
import {
  claimPickingDispatch,
  pickingDispatchPending,
} from "@/lib/pickingInventoryFinish";

const reply = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function GET(request: Request) {
  const cfg = mobileWorkCenterConfig();
  if (!cfg || !verifyMobileWorkCenterAgent(request, cfg.agentToken))
    return reply({ ok: false }, 403);
  return reply({ ok: true, pending: await pickingDispatchPending() });
}
export async function POST(request: Request) {
  const cfg = mobileWorkCenterConfig();
  if (!cfg || request.headers.get("origin") !== cfg.origin)
    return reply({ ok: false }, 403);
  const auth = await verifyMobileWorkCenterOwner(cfg.ownerId);
  if (auth !== 200) return reply({ ok: false }, auth);
  return reply({ ok: true, ticket: await claimPickingDispatch() });
}
