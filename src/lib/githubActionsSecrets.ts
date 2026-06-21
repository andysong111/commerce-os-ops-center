import { getEngineAdminToken, type EngineEnvConfig } from "./engineEnvConfig";

export type EngineSecretStatus = {
  name: string;
  configured: boolean | "unknown";
  updatedAt?: string;
};

export const missingTokenMessage = "GITHUB_ENGINE_ADMIN_TOKEN이 없거나 권한이 부족합니다. Vercel 환경변수에 등록한 뒤 Redeploy 해주세요.";
export const permissionMessage = "GitHub Secrets 확인 권한이 없습니다. GITHUB_ENGINE_ADMIN_TOKEN 권한을 확인해 주세요.";

function headers(token: string) {
  return { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
}

export function isPermissionStatus(status: number) {
  return status === 401 || status === 403 || status === 404;
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

async function encryptWithGitHubPublicKey(publicKey: string, secretValue: string): Promise<string> {
  const testEncrypt = (globalThis as typeof globalThis & { __engineSecretEncryptForTest?: (key: string, value: string) => string }).__engineSecretEncryptForTest;
  if (testEncrypt) return testEncrypt(publicKey, secretValue);
  const sodium = await (new Function("return import(\"libsodium-wrappers\")")() as Promise<{ ready: Promise<void>; crypto_box_seal: (message: Uint8Array, key: Uint8Array) => Uint8Array; from_string: (value: string) => Uint8Array; from_base64: (value: string, variant: unknown) => Uint8Array; to_base64: (value: Uint8Array, variant: unknown) => string; base64_variants: { ORIGINAL: unknown } }>);
  await sodium.ready;
  const bytes = sodium.crypto_box_seal(sodium.from_string(secretValue), sodium.from_base64(publicKey, sodium.base64_variants.ORIGINAL));
  return sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL);
}

export async function saveRepositorySecrets(config: EngineEnvConfig, secrets: Record<string, string>) {
  const token = getEngineAdminToken();
  if (!token) throw new Error(missingTokenMessage);
  const publicKeyResponse = await fetch(`https://api.github.com/repos/${config.repoOwner}/${config.repoName}/actions/secrets/public-key`, { headers: headers(token) });
  if (!publicKeyResponse.ok) {
    if (isPermissionStatus(publicKeyResponse.status)) throw new Error(permissionMessage);
    throw new Error(`GitHub Secrets public key request failed with HTTP ${publicKeyResponse.status}.`);
  }
  const publicKeyPayload = await publicKeyResponse.json() as { key?: string; key_id?: string };
  if (!publicKeyPayload.key || !publicKeyPayload.key_id) throw new Error("GitHub Secrets 공개키를 확인하지 못했습니다.");

  const saved: string[] = [];
  for (const [name, value] of Object.entries(secrets)) {
    if (!value) continue;
    const encryptedValue = await encryptWithGitHubPublicKey(publicKeyPayload.key, value);
    const response = await fetch(`https://api.github.com/repos/${config.repoOwner}/${config.repoName}/actions/secrets/${encodeURIComponent(name)}`, {
      method: "PUT",
      headers: { ...headers(token), "Content-Type": "application/json" },
      body: JSON.stringify({ encrypted_value: encryptedValue, key_id: publicKeyPayload.key_id }),
    });
    if (!response.ok) throw new Error(`GitHub Secrets update request failed for ${name} with HTTP ${response.status}.`);
    saved.push(name);
  }
  return saved;
}
