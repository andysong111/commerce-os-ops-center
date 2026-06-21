import { createRequire } from "node:module";
import { getEngineAdminToken, type EngineEnvConfig } from "./engineEnvConfig";


type LibsodiumWrappers = {
  ready: Promise<void>;
  base64_variants: { ORIGINAL: number };
  from_base64(value: string, variant: number): Uint8Array;
  from_string(value: string): Uint8Array;
  crypto_box_seal(message: Uint8Array, publicKey: Uint8Array): Uint8Array;
  to_base64(value: Uint8Array, variant: number): string;
};

const require = createRequire(import.meta.url);
const sodium = require("libsodium-wrappers") as LibsodiumWrappers;

export type EngineSecretStatus = {
  name: string;
  configured: boolean | "unknown";
  updatedAt?: string;
};

export type GitHubSecretFailureReason = "missing_token" | "github_api_error" | "fetch_public_key_failed" | "encrypt_secret_failed" | "put_secret_failed";

export type SecretSaveFailure = {
  name: string;
  reason: GitHubSecretFailureReason;
  action: "fetch_public_key_failed" | "encrypt_secret_failed" | "put_secret_failed";
  message: string;
  status?: number;
  githubMessage?: string;
};

export type SecretSaveResult = {
  saved: string[];
  failed: SecretSaveFailure[];
  skipped: string[];
};

export const missingTokenMessage = "GITHUB_ENGINE_ADMIN_TOKEN이 없거나 권한이 부족합니다. Vercel 환경변수에 등록한 뒤 Redeploy 해주세요.";
export const permissionMessage = "GitHub Secrets 확인 권한이 없습니다. GITHUB_ENGINE_ADMIN_TOKEN 권한을 확인해 주세요.";

function headers(token: string) {
  return { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
}

export function isPermissionStatus(status: number) {
  return status === 401 || status === 403 || status === 404;
}

function safeGitHubMessage(payload: unknown) {
  if (!payload || typeof payload !== "object") return undefined;
  const message = (payload as { message?: unknown }).message;
  if (typeof message !== "string") return undefined;
  return message.replace(/https?:\/\/\S+/g, "GitHub API documentation").slice(0, 240);
}

async function readSafeGitHubMessage(response: Response) {
  const payload = await response.json().catch(() => null) as unknown;
  return safeGitHubMessage(payload);
}

function publicKeyFailure(name: string, response: Response, githubMessage?: string): SecretSaveFailure {
  return {
    name,
    reason: "github_api_error",
    action: "fetch_public_key_failed",
    status: response.status,
    githubMessage,
    message: `GitHub public key 조회에 실패했습니다. GitHub API가 ${response.status}을 반환했습니다.${isPermissionStatus(response.status) ? " 토큰의 Secrets 쓰기 권한을 확인해 주세요." : ""}`,
  };
}

function putFailure(name: string, response: Response, githubMessage?: string): SecretSaveFailure {
  return {
    name,
    reason: "github_api_error",
    action: "put_secret_failed",
    status: response.status,
    githubMessage,
    message: `GitHub API가 ${response.status}을 반환했습니다.${isPermissionStatus(response.status) ? " 토큰의 Secrets 쓰기 권한을 확인해 주세요." : ""}`,
  };
}

export async function listRepositorySecretStatuses(config: EngineEnvConfig): Promise<EngineSecretStatus[]> {
  const token = getEngineAdminToken();
  if (!token) throw new Error(missingTokenMessage);
  const response = await fetch(`https://api.github.com/repos/${config.repoOwner}/${config.repoName}/actions/secrets`, { headers: headers(token) });
  if (!response.ok) {
    if (isPermissionStatus(response.status)) throw new Error(permissionMessage);
    throw new Error(`GitHub Secrets status request failed with HTTP ${response.status}.`);
  }
  const payload = await response.json() as { secrets?: unknown[] };
  const existing = new Map((Array.isArray(payload.secrets) ? payload.secrets : []).map((secret) => {
    const value = secret as Record<string, unknown>;
    return [String(value.name), typeof value.updated_at === "string" ? value.updated_at : undefined];
  }));
  return config.secrets.map((secret) => ({ name: secret.name, configured: existing.has(secret.name), updatedAt: existing.get(secret.name) }));
}

export async function encryptGitHubSecret(publicKey: string, secretValue: string): Promise<string> {
  const testEncrypt = (globalThis as typeof globalThis & { __engineSecretEncryptForTest?: (key: string, value: string) => string }).__engineSecretEncryptForTest;
  if (testEncrypt) return testEncrypt(publicKey, secretValue);

  await sodium.ready;
  const publicKeyBytes = sodium.from_base64(publicKey, sodium.base64_variants.ORIGINAL);
  const messageBytes = sodium.from_string(secretValue);
  const encryptedBytes = sodium.crypto_box_seal(messageBytes, publicKeyBytes);
  return sodium.to_base64(encryptedBytes, sodium.base64_variants.ORIGINAL);
}

export async function saveRepositorySecrets(config: EngineEnvConfig, secrets: Record<string, string>): Promise<SecretSaveResult> {
  const token = getEngineAdminToken();
  const entries = Object.entries(secrets).filter(([, value]) => value.trim());
  const skipped = config.secrets.map((secret) => secret.name).filter((name) => !secrets[name]?.trim());
  if (!token) {
    return { saved: [], skipped, failed: entries.map(([name]) => ({ name, reason: "missing_token", action: "put_secret_failed", message: missingTokenMessage })) };
  }

  let publicKeyResponse: Response;
  try {
    publicKeyResponse = await fetch(`https://api.github.com/repos/${config.repoOwner}/${config.repoName}/actions/secrets/public-key`, { headers: headers(token) });
  } catch {
    return { saved: [], skipped, failed: entries.map(([name]) => ({ name, reason: "fetch_public_key_failed", action: "fetch_public_key_failed", message: "GitHub public key 조회에 실패했습니다." })) };
  }
  if (!publicKeyResponse.ok) {
    const githubMessage = await readSafeGitHubMessage(publicKeyResponse);
    return { saved: [], skipped, failed: entries.map(([name]) => publicKeyFailure(name, publicKeyResponse, githubMessage)) };
  }
  const publicKeyPayload = await publicKeyResponse.json().catch(() => null) as { key?: string; key_id?: string } | null;
  if (!publicKeyPayload?.key || !publicKeyPayload.key_id) {
    return { saved: [], skipped, failed: entries.map(([name]) => ({ name, reason: "fetch_public_key_failed", action: "fetch_public_key_failed", message: "GitHub public key 조회에 실패했습니다." })) };
  }

  const saved: string[] = [];
  const failed: SecretSaveFailure[] = [];
  for (const [name, value] of entries) {
    let encryptedValue = "";
    try {
      encryptedValue = await encryptGitHubSecret(publicKeyPayload.key, value);
    } catch {
      failed.push({ name, reason: "encrypt_secret_failed", action: "encrypt_secret_failed", message: "GitHub Secrets 저장 전 암호화에 실패했습니다. 서버 암호화 모듈을 확인해 주세요." });
      continue;
    }
    let response: Response;
    try {
      response = await fetch(`https://api.github.com/repos/${config.repoOwner}/${config.repoName}/actions/secrets/${encodeURIComponent(name)}`, {
        method: "PUT",
        headers: { ...headers(token), "Content-Type": "application/json" },
        body: JSON.stringify({ encrypted_value: encryptedValue, key_id: publicKeyPayload.key_id }),
      });
    } catch {
      failed.push({ name, reason: "put_secret_failed", action: "put_secret_failed", message: "GitHub Secrets 저장 요청에 실패했습니다." });
      continue;
    }
    if (!response.ok) {
      failed.push(putFailure(name, response, await readSafeGitHubMessage(response)));
      continue;
    }
    saved.push(name);
  }
  return { saved, failed, skipped };
}
