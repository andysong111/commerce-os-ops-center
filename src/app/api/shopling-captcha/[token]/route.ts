import {
  readShoplingCaptchaChallenge,
  requestFreshShoplingCaptcha,
  submitShoplingCaptchaAnswer,
} from "@/lib/shoplingCaptchaApproval";

function noStore(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const result = await readShoplingCaptchaChallenge(token);
  return result.ok
    ? noStore({ ok: true, challenge: result.value })
    : noStore({ ok: false, code: result.code }, result.status);
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  let body: { action?: unknown; answer?: unknown; imageVersion?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return noStore({ ok: false, code: "SHOPLING_CAPTCHA_REQUEST_INVALID" }, 400);
  }
  if (!Number.isInteger(body.imageVersion)) {
    return noStore({ ok: false, code: "SHOPLING_CAPTCHA_REQUEST_INVALID" }, 400);
  }
  const { token } = await context.params;
  const result = body.action === "submit" && typeof body.answer === "string"
    ? await submitShoplingCaptchaAnswer(token, body.answer.trim(), Number(body.imageVersion))
    : body.action === "refresh"
      ? await requestFreshShoplingCaptcha(token, Number(body.imageVersion))
      : { ok: false as const, status: 400, code: "SHOPLING_CAPTCHA_REQUEST_INVALID" };
  return result.ok
    ? noStore({ ok: true, result: result.value })
    : noStore({ ok: false, code: result.code }, result.status);
}
