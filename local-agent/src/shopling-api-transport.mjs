import { Agent, request } from "node:https";

const SHOPLING_API_HOST = "api.shopling.co.kr";
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;

function errorCode(error) {
  let current = error && typeof error === "object" ? error : {};
  for (let depth = 0; depth < 4; depth += 1) {
    if (current.code) return String(current.code);
    current = current.cause && typeof current.cause === "object" ? current.cause : {};
  }
  return "";
}

export function isScopedShoplingApiUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === SHOPLING_API_HOST && !url.username && !url.password;
  } catch {
    return false;
  }
}

function legacyPost(rawUrl, body, headers, timeoutMs) {
  if (!isScopedShoplingApiUrl(rawUrl)) throw new Error("SHOPLING_LEGACY_DH_TARGET_REJECTED");
  const url = new URL(rawUrl);
  const payload = Buffer.from(body, "utf8");
  const agent = new Agent({
    keepAlive: false,
    rejectUnauthorized: true,
    minVersion: "TLSv1.2",
    ciphers: "DEFAULT@SECLEVEL=1",
  });
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      agent.destroy();
      callback();
    };
    const handle = request({
      protocol: "https:",
      hostname: url.hostname,
      path: `${url.pathname}${url.search}`,
      method: "POST",
      headers: { ...headers, "content-length": String(payload.byteLength) },
      agent,
      servername: url.hostname,
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
      ciphers: "DEFAULT@SECLEVEL=1",
    }, (response) => {
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
        size += buffer.byteLength;
        if (size > MAX_RESPONSE_BYTES) {
          handle.destroy(Object.assign(new Error("SHOPLING_RESPONSE_TOO_LARGE"), { code: "SHOPLING_RESPONSE_TOO_LARGE" }));
          return;
        }
        chunks.push(buffer);
      });
      response.once("error", (error) => finish(() => reject(error)));
      response.once("end", () => finish(() => resolve({
        ok: (response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 300,
        status: response.statusCode ?? 0,
        body: Buffer.concat(chunks).toString("utf8"),
      })));
    });
    handle.setTimeout(timeoutMs, () => handle.destroy(Object.assign(new Error("SHOPLING_API_TIMEOUT"), { code: "SHOPLING_API_TIMEOUT" })));
    handle.once("error", (error) => finish(() => reject(error)));
    handle.end(payload);
  });
}

export async function postShoplingApiXml(url, body, options = {}) {
  if (!isScopedShoplingApiUrl(url)) throw new Error("SHOPLING_API_TARGET_REJECTED");
  const timeoutMs = Math.max(1_000, Math.min(60_000, Number(options.timeoutMs || 45_000)));
  const headers = {
    accept: "application/xml, text/xml",
    "content-type": "application/xml; charset=utf-8",
    "user-agent": "commerce-os-local-agent-shopling-read/1.0",
  };
  try {
    const response = await (options.fetchImpl || fetch)(url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    return { ok: response.ok, status: response.status, body: await response.text() };
  } catch (error) {
    if (errorCode(error) !== "ERR_SSL_DH_KEY_TOO_SMALL") throw error;
    return legacyPost(url, body, headers, timeoutMs);
  }
}
