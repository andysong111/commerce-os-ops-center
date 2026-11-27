import { timingSafeEqual } from "node:crypto";
import { getOpsCurrentUser } from "@/lib/supabase/currentUser";

const OWNER_ID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const AGENT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;

export function mobileWorkCenterConfig() {
  const ownerId = process.env.MOBILE_WORK_CENTER_OWNER_ID?.trim();
  const agentToken = process.env.MOBILE_WORK_CENTER_AGENT_TOKEN?.trim();
  const rawOrigin = process.env.MOBILE_WORK_CENTER_ORIGIN?.trim() || "https://commerce-os-ops-center.vercel.app";
  if (!ownerId || !OWNER_ID_PATTERN.test(ownerId) || !agentToken || !AGENT_TOKEN_PATTERN.test(agentToken)) return null;
  try {
    const origin = new URL(rawOrigin);
    if (origin.href !== `${origin.origin}/` || (origin.protocol !== "https:" && !(origin.protocol === "http:" && origin.hostname === "127.0.0.1"))) return null;
    return { ownerId, agentToken, origin: origin.origin };
  } catch {
    return null;
  }
}

export async function verifyMobileWorkCenterOwner(ownerId: string) {
  const { user } = await getOpsCurrentUser();
  return !user ? 401 : user.id !== ownerId ? 403 : 200;
}

export function verifyMobileWorkCenterAgent(request: Request, token: string) {
  const header = request.headers.get("authorization") ?? "";
  const provided = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${token}`);
  return !request.headers.has("origin") && provided.length === expected.length && timingSafeEqual(provided, expected);
}
