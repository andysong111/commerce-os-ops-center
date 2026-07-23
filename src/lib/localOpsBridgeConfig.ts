export const defaultBaseUrl = "http://127.0.0.1:8765";

export const localOpsBridgeBaseUrlStorageKey =
  "commerce-os.localOpsBridge.baseUrl";

export const localOpsBridgeTokenStorageKey =
  "commerce-os.localOpsBridge.token";

export function normalizeLocalBridgeBaseUrl(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return defaultBaseUrl;
  return trimmed.replace(/\/+$/, "");
}
