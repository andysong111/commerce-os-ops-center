import { readShoplingCaptchaImage } from "@/lib/shoplingCaptchaApproval";

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const result = await readShoplingCaptchaImage(token);
  if (!result.ok) {
    return Response.json({ ok: false, code: result.code }, {
      status: result.status,
      headers: { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" },
    });
  }
  return new Response(result.image, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(result.image.length),
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
