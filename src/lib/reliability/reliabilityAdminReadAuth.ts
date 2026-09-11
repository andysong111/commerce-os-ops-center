import { createHmac, timingSafeEqual } from "node:crypto";

export const RELIABILITY_ADMIN_READ_HEADER =
  "x-commerce-os-reliability-read-token";
export const RELIABILITY_ADMIN_READ_CONTEXT = "ai-saurus-admin-read-v1";

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function reliabilityAdminReadSecret() {
  return String(process.env.COMMERCE_OS_RELIABILITY_INGEST_SECRET ?? "").trim();
}

export function deriveReliabilityAdminReadToken(secret: string) {
  const normalized = String(secret ?? "").trim();
  if (!normalized) return "";
  return createHmac("sha256", normalized)
    .update(RELIABILITY_ADMIN_READ_CONTEXT, "utf8")
    .digest("hex");
}

export function authorizeReliabilityAdminRead(
  request: Request,
  expectedSecret = reliabilityAdminReadSecret(),
): { ok: true } | { ok: false; status: number; code: string; message: string } {
  if (!expectedSecret) {
    return {
      ok: false,
      status: 503,
      code: "RELIABILITY_ADMIN_READ_UNCONFIGURED",
      message: "신뢰성 관리자 조회 연결이 설정되지 않았습니다.",
    };
  }

  const expectedToken = deriveReliabilityAdminReadToken(expectedSecret);
  const supplied = request.headers
    .get(RELIABILITY_ADMIN_READ_HEADER)
    ?.trim();
  if (!supplied || !safeEqual(supplied, expectedToken)) {
    return {
      ok: false,
      status: 401,
      code: "RELIABILITY_ADMIN_READ_UNAUTHORIZED",
      message: "신뢰성 관리자 조회 권한을 확인하지 못했습니다.",
    };
  }

  return { ok: true };
}
