const SENSITIVE_PARAM = /(?:token|access|refresh|secret|session|password|passwd|pwd|cookie|auth|apikey|api_key|key|code|jwt|bearer)/i;
const SENSITIVE_FIELD = /(?:token|access[_-]?token|refresh[_-]?token|secret|session|password|passwd|pwd|cookie|authorization|bearer|jwt|api[_-]?key|csrf)/i;
const URL_LIKE = /\bhttps?:\/\/[^\s"')<>]+/gi;
const INLINE_SECRET = /\b(token|access[_-]?token|refresh[_-]?token|secret|session|password|passwd|pwd|cookie|authorization|bearer|jwt|api[_-]?key|csrf)\s*[:=]\s*([^\s&,;]+)/gi;

export function redactText(value, maxLength = 1_000) {
  const text = String(value ?? "");
  return text
    .replace(URL_LIKE, (url) => redactUrl(url))
    .replace(INLINE_SECRET, "$1=[redacted]")
    .slice(0, maxLength);
}

export function redactStructuredData(value, key = "") {
  if (value === null || value === undefined) return value;
  if (SENSITIVE_FIELD.test(key)) return "[redacted]";
  if (typeof value === "string") return redactText(value, 5_000);
  if (Array.isArray(value)) return value.map((item) => redactStructuredData(item));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [childKey, redactStructuredData(childValue, childKey)]),
    );
  }
  return value;
}

export function redactUrl(rawUrl) {
  if (!rawUrl) return "";
  try {
    const url = new URL(String(rawUrl));
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_PARAM.test(key)) url.searchParams.set(key, "[redacted]");
    }
    return url.toString();
  } catch {
    return String(rawUrl).replace(URL_LIKE, (url) => redactUrl(url)).slice(0, 1_000);
  }
}

export function sanitizeError(error, fallbackCode = "UNKNOWN_ERROR") {
  const code =
    typeof error?.code === "string"
      ? error.code
      : fallbackCode;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : JSON.stringify(error ?? {});
  return {
    code,
    message: redactText(message, 600),
  };
}

export function compactString(value, maxLength = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}
