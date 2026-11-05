import { pathToFileURL } from "node:url";

const REQUIRED_KEYS = [
  "KEYWORD_ENGINE_OPENAI_API_KEY",
  "SHOPLING_CATEGORY_OPENAI_API_KEY",
  "PRODUCT_TITLE_OPENAI_API_KEY",
  "OPS_AI_HELP_OPENAI_API_KEY",
];

const RETRYABLE_HTTP_STATUS = new Set([408, 429, 500, 502, 503, 504]);

const sleep = (milliseconds) =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

export async function verifyOpenAIKey({
  name,
  key,
  fetchImpl = globalThis.fetch,
  timeoutMs = 10_000,
  maxAttempts = 3,
  sleepImpl = sleep,
  logger = console,
}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response;
    try {
      response = await fetchImpl("https://api.openai.com/v1/models", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${key}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.name : "NETWORK_ERROR";
      if (attempt >= maxAttempts) return { ok: false, reason };
      logger.warn(
        `OpenAI production key verification retrying for ${name}: ${reason} (${attempt}/${maxAttempts})`,
      );
      await sleepImpl(attempt * 1_000);
      continue;
    }

    if (response.ok) return { ok: true };

    const reason = `HTTP ${response.status}`;
    if (!RETRYABLE_HTTP_STATUS.has(response.status) || attempt >= maxAttempts) {
      return { ok: false, reason };
    }
    logger.warn(
      `OpenAI production key verification retrying for ${name}: ${reason} (${attempt}/${maxAttempts})`,
    );
    await sleepImpl(attempt * 1_000);
  }

  return { ok: false, reason: "UNKNOWN_ERROR" };
}

export async function verifyProductionKeys({
  env = process.env,
  fetchImpl = globalThis.fetch,
  logger = console,
  sleepImpl = sleep,
} = {}) {
  if (env.VERCEL_ENV !== "production") {
    logger.log("OpenAI production key verification skipped outside Vercel Production.");
    return true;
  }

  const missing = REQUIRED_KEYS.filter((name) => !String(env[name] ?? "").trim());
  if (missing.length) {
    logger.error(`OpenAI production key verification failed: missing ${missing.join(", ")}`);
    return false;
  }

  for (const name of REQUIRED_KEYS) {
    const result = await verifyOpenAIKey({
      name,
      key: String(env[name] ?? "").trim(),
      fetchImpl,
      sleepImpl,
      logger,
    });
    if (!result.ok) {
      logger.error(`OpenAI production key verification failed for ${name}: ${result.reason}`);
      return false;
    }
    logger.log(`OpenAI production key verified: ${name}`);
  }

  logger.log("All dedicated OpenAI production keys verified.");
  return true;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain && !(await verifyProductionKeys())) process.exit(1);
