export const ACCOUNT_PASSWORD_MIN_LENGTH = 16;

export type RecoveryExchange = (code: string, options?: { flowId: string }) => Promise<{
  data: { session: { user: { id: string } } | null; redirectType?: string | null };
  error: { message: string } | null;
}>;

export async function passwordRecoveryResponse(params: URLSearchParams, exchange?: RecoveryExchange) {
  const code = params.get("code");
  const flowId = params.get("sb_flow_id");
  let destination = "/forgot-password?error=link";
  if (exchange && code && !params.has("error") && !params.has("error_code")) {
    try {
      const { data, error } = await exchange(code, flowId === null ? undefined : { flowId });
      if (!error && data.session?.user.id && data.redirectType === "recovery") destination = "/account/password?recovery=1";
    } catch {
      // A failed exchange must never authorize editing an existing session.
    }
  }
  // The public browser hostname can differ from the reverse proxy's hostname.
  // A relative Location keeps the newly established cookie on the return path.
  return new Response(null, {
    status: 303, headers: { Location: destination, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" },
  });
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
