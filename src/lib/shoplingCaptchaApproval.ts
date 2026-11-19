import { createHash, constants as cryptoConstants, publicEncrypt } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const TABLE = "commerce_os_shopling_captcha_challenges";

type ChallengeRow = {
  status: "WAITING" | "ANSWER_SUBMITTED" | "CONSUMED" | "EXPIRED" | "CANCELLED";
  image_data: string | null;
  image_hash: string;
  image_version: number;
  image_updated_at: string;
  answer_public_key: string;
  answer_submitted_at: string | null;
  refresh_requested_at: string | null;
  expires_at: string;
  updated_at: string;
};

function tokenHash(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function validShoplingCaptchaToken(token: string) {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

function asRow(value: unknown): ChallengeRow | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<ChallengeRow>;
  if (!["WAITING", "ANSWER_SUBMITTED", "CONSUMED", "EXPIRED", "CANCELLED"].includes(String(row.status))) return null;
  if (!Number.isInteger(row.image_version) || Number(row.image_version) < 1) return null;
  if (!/^[a-f0-9]{64}$/.test(String(row.image_hash || ""))) return null;
  if (!Number.isFinite(Date.parse(String(row.expires_at || "")))) return null;
  return row as ChallengeRow;
}

async function lookup(token: string) {
  if (!validShoplingCaptchaToken(token)) {
    return { ok: false as const, status: 404, code: "SHOPLING_CAPTCHA_NOT_FOUND" };
  }
  const admin = await createSupabaseAdminClient();
  if (!admin) return { ok: false as const, status: 503, code: "SHOPLING_CAPTCHA_STORAGE_UNAVAILABLE" };
  const result = await admin
    .from(TABLE)
    .select("status,image_data,image_hash,image_version,image_updated_at,answer_public_key,answer_submitted_at,refresh_requested_at,expires_at,updated_at")
    .eq("token_hash", tokenHash(token))
    .maybeSingle();
  if (result.error) return { ok: false as const, status: 503, code: "SHOPLING_CAPTCHA_READ_FAILED" };
  const row = asRow(result.data);
  if (!row) return { ok: false as const, status: 404, code: "SHOPLING_CAPTCHA_NOT_FOUND" };
  return { ok: true as const, admin, row };
}

function publicChallenge(row: ChallengeRow) {
  const expired = Date.parse(row.expires_at) <= Date.now();
  return {
    status: expired ? "EXPIRED" : row.status,
    imageVersion: row.image_version,
    imageUpdatedAt: row.image_updated_at,
    answerSubmittedAt: row.answer_submitted_at,
    refreshRequestedAt: row.refresh_requested_at,
    expiresAt: row.expires_at,
    expired,
    imageAvailable: Boolean(row.image_data),
  };
}

export async function readShoplingCaptchaChallenge(token: string) {
  const found = await lookup(token);
  if (!found.ok) return found;
  return { ok: true as const, value: publicChallenge(found.row) };
}

export async function readShoplingCaptchaImage(token: string) {
  const found = await lookup(token);
  if (!found.ok) return found;
  if (Date.parse(found.row.expires_at) <= Date.now() || !found.row.image_data) {
    return { ok: false as const, status: 410, code: "SHOPLING_CAPTCHA_EXPIRED" };
  }
  const match = found.row.image_data.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return { ok: false as const, status: 503, code: "SHOPLING_CAPTCHA_IMAGE_INVALID" };
  const image = Buffer.from(match[1], "base64");
  if (image.length < 64 || image.length > 180_000) {
    return { ok: false as const, status: 503, code: "SHOPLING_CAPTCHA_IMAGE_INVALID" };
  }
  return { ok: true as const, image, version: found.row.image_version };
}

export async function submitShoplingCaptchaAnswer(token: string, answer: string, imageVersion: number) {
  if (!/^\d{4}$/.test(answer)) {
    return { ok: false as const, status: 400, code: "SHOPLING_CAPTCHA_ANSWER_INVALID" };
  }
  if (!Number.isInteger(imageVersion) || imageVersion < 1) {
    return { ok: false as const, status: 400, code: "SHOPLING_CAPTCHA_VERSION_INVALID" };
  }
  const found = await lookup(token);
  if (!found.ok) return found;
  if (Date.parse(found.row.expires_at) <= Date.now()) {
    return { ok: false as const, status: 410, code: "SHOPLING_CAPTCHA_EXPIRED" };
  }
  if (found.row.status !== "WAITING" || found.row.image_version !== imageVersion) {
    return { ok: false as const, status: 409, code: "SHOPLING_CAPTCHA_STALE" };
  }
  let ciphertext: string;
  try {
    ciphertext = publicEncrypt({
      key: found.row.answer_public_key,
      padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    }, Buffer.from(answer, "utf8")).toString("base64");
  } catch {
    return { ok: false as const, status: 503, code: "SHOPLING_CAPTCHA_ENCRYPT_FAILED" };
  }
  const now = new Date().toISOString();
  const update = await found.admin
    .from(TABLE)
    .update({
      status: "ANSWER_SUBMITTED",
      answer_ciphertext: ciphertext,
      answer_submitted_at: now,
      updated_at: now,
    })
    .select("status,image_version,answer_submitted_at")
    .eq("token_hash", tokenHash(token))
    .eq("image_version", imageVersion)
    .eq("status", "WAITING")
    .gt("expires_at", now);
  if (update.error) return { ok: false as const, status: 503, code: "SHOPLING_CAPTCHA_WRITE_FAILED" };
  if (!Array.isArray(update.data) || update.data.length !== 1) {
    return { ok: false as const, status: 409, code: "SHOPLING_CAPTCHA_STALE" };
  }
  return { ok: true as const, value: { status: "ANSWER_SUBMITTED", submittedAt: now } };
}

export async function requestFreshShoplingCaptcha(token: string, imageVersion: number) {
  if (!Number.isInteger(imageVersion) || imageVersion < 1) {
    return { ok: false as const, status: 400, code: "SHOPLING_CAPTCHA_VERSION_INVALID" };
  }
  const found = await lookup(token);
  if (!found.ok) return found;
  if (Date.parse(found.row.expires_at) <= Date.now()) {
    return { ok: false as const, status: 410, code: "SHOPLING_CAPTCHA_EXPIRED" };
  }
  if (!["WAITING", "ANSWER_SUBMITTED"].includes(found.row.status) || found.row.image_version !== imageVersion) {
    return { ok: false as const, status: 409, code: "SHOPLING_CAPTCHA_STALE" };
  }
  const now = new Date().toISOString();
  const update = await found.admin
    .from(TABLE)
    .update({
      status: "WAITING",
      answer_ciphertext: null,
      answer_submitted_at: null,
      refresh_requested_at: now,
      updated_at: now,
    })
    .select("status,image_version,refresh_requested_at")
    .eq("token_hash", tokenHash(token))
    .eq("image_version", imageVersion)
    .in("status", ["WAITING", "ANSWER_SUBMITTED"])
    .gt("expires_at", now);
  if (update.error) return { ok: false as const, status: 503, code: "SHOPLING_CAPTCHA_WRITE_FAILED" };
  if (!Array.isArray(update.data) || update.data.length !== 1) {
    return { ok: false as const, status: 409, code: "SHOPLING_CAPTCHA_STALE" };
  }
  return { ok: true as const, value: { status: "WAITING", refreshRequestedAt: now } };
}
