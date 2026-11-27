export const ACCOUNT_PASSWORD_MIN_LENGTH = 16;

export type RecoveryExchange = (code: string, options?: { flowId: string }) => Promise<{
  data: { session: { user: { id: string } } | null; redirectType?: string | null };
  error: { message: string } | null;
}>;

export async function passwordRecoveryDestination(params: URLSearchParams, exchange?: RecoveryExchange) {
  const code = params.get("code");
  const flowId = params.get("sb_flow_id");
  const retry = "/forgot-password?error=link";
  if (!exchange || !code || params.has("error") || params.has("error_code")) return retry;
  try {
    const { data, error } = await exchange(code, flowId === null ? undefined : { flowId });
    return !error && data.session?.user.id && data.redirectType === "recovery" ? "/account/password?recovery=1" : retry;
  } catch {
    return retry;
  }
}

export type AccountPasswordValidation =
  | { ok: true }
  | { ok: false; message: string };

export function validateAccountPassword(
  password: string,
  confirmation: string,
): AccountPasswordValidation {
  if (Array.from(password).length < ACCOUNT_PASSWORD_MIN_LENGTH) {
    return {
      ok: false,
      message: `비밀번호는 ${ACCOUNT_PASSWORD_MIN_LENGTH}자 이상이어야 합니다.`,
    };
  }

  if (password !== confirmation) {
    return {
      ok: false,
      message: "새 비밀번호와 비밀번호 확인이 일치하지 않습니다.",
    };
  }

  return { ok: true };
}
