import { createHmac, timingSafeEqual } from "node:crypto";

export const OPS_SAURUS_CONTRACT = "ops-detail-v1";
export const OPS_SAURUS_PRODUCTION = "https://ai-saurus.com";
export const OPS_SAURUS_STATUS_PATH = "/api/saas/ops-detail";
const HEX = /^[a-f0-9]{64}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VERSION = /^\d+\.\d+\.\d+$/;

export type OpsDetailDispatch = {
  attempt: string;
  inputHash: string;
  email: string;
  source: string;
  name: string;
  options: string[];
  importer: string;
  deployment: string;
  maxCredits: number;
  expires: number;
};

export function opsDetailSecret() {
  const value = process.env.AI_SAURUS_OPS_BRIDGE_SECRET?.trim();
  return value && value.length >= 32 ? value : "";
}

export function canonicalOpsOffer(value: string) {
  const url = URL.parse(value);
  return url && url.origin === "https://detail.1688.com" && !url.username && !url.password && /^\/offer\/\d+\.html$/.test(url.pathname)
    ? url.origin + url.pathname : "";
}

function validDispatch(value: unknown): value is OpsDetailDispatch {
  if (!value || typeof value !== "object") return false;
  const row = value as OpsDetailDispatch;
  return typeof row.attempt === "string" && HEX.test(row.attempt) &&
    typeof row.inputHash === "string" && HEX.test(row.inputHash) &&
    typeof row.email === "string" && row.email.length <= 254 && EMAIL.test(row.email) &&
    typeof row.source === "string" && canonicalOpsOffer(row.source) === row.source &&
    typeof row.name === "string" && row.name.trim() === row.name && row.name.length > 0 && row.name.length <= 250 &&
    Array.isArray(row.options) && row.options.length > 0 && row.options.length <= 80 &&
    new Set(row.options).size === row.options.length &&
    row.options.every((name) => typeof name === "string" && name.trim() === name && name.length > 0 && name.length <= 100) &&
    typeof row.importer === "string" && VERSION.test(row.importer) &&
    typeof row.deployment === "string" && /^[a-f0-9]{40}$/.test(row.deployment) &&
    Number.isSafeInteger(row.maxCredits) && row.maxCredits > 0 && row.maxCredits <= 1000 &&
    Number.isSafeInteger(row.expires);
}

export function signOpsDispatch(claims: OpsDetailDispatch, secret: string) {
  if (!validDispatch(claims) || !secret) throw new Error("잘못된 OPS 제작 요청입니다.");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const mac = createHmac("sha256", secret).update(OPS_SAURUS_CONTRACT + "." + payload).digest("base64url");
  return payload + "." + mac;
}

export function verifyOpsDispatch(token: unknown, secret: string, now = Date.now()): OpsDetailDispatch | null {
  if (typeof token !== "string" || token.length > 48_000 || !secret) return null;
  const match = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) return null;
  const expected = createHmac("sha256", secret).update(OPS_SAURUS_CONTRACT + "." + match[1]).digest();
  const actual = Buffer.from(match[2], "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const claims: unknown = JSON.parse(Buffer.from(match[1], "base64url").toString("utf8"));
    return validDispatch(claims) && claims.expires > now && claims.expires <= now + 4 * 60 * 60_000 ? claims : null;
  } catch {
    return null;
  }
}
