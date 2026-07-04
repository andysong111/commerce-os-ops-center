export type SourcingApiStatusCode =
  | "SERVER_SAVED"
  | "AUTH_REQUIRED"
  | "SERVER_NOT_CONFIGURED"
  | "SERVER_ERROR";

export type LocalFallbackStatus =
  | "server saved"
  | "local only: auth required"
  | "local only: server not configured"
  | "local only: server error";

export function classifySourcingApiResponse(status: number, code?: string): SourcingApiStatusCode {
  if (status >= 200 && status < 300) return "SERVER_SAVED";
  if (status === 401 || code === "AUTH_REQUIRED") return "AUTH_REQUIRED";
  if (status === 503 || code === "SUPABASE_NOT_CONFIGURED") return "SERVER_NOT_CONFIGURED";
  return "SERVER_ERROR";
}

export function toLocalFallbackStatus(status: SourcingApiStatusCode): LocalFallbackStatus {
  if (status === "SERVER_SAVED") return "server saved";
  if (status === "AUTH_REQUIRED") return "local only: auth required";
  if (status === "SERVER_NOT_CONFIGURED") return "local only: server not configured";
  return "local only: server error";
}
