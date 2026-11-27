import {
  mobileWorkCenterConfig,
  verifyMobileWorkCenterOwner,
} from "@/lib/mobileWorkCenterAuth";
import {
  finishPickingInventory,
  pickingInventoryReceipt,
} from "@/lib/pickingInventoryFinish";

export const maxDuration = 300;
type Context = { params: Promise<{ token: string }> };
const reply = (body: unknown, status: number) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
async function handle(request: Request, ctx: Context) {
  const config = mobileWorkCenterConfig();
  if (!config)
    return reply(
      { ok: false, message: "업무센터 소유자 설정을 확인해 주세요." },
      503,
    );
  if (
    request.method === "POST" &&
    request.headers.get("origin") !== config.origin
  )
    return reply({ ok: false }, 403);
  const status = await verifyMobileWorkCenterOwner(config.ownerId);
  if (status !== 200)
    return reply(
      { ok: false, message: "업무센터 운영자 계정으로 로그인해 주세요." },
      status,
    );
  const { token } = await ctx.params;
  try {
    const result =
      request.method === "GET"
        ? await pickingInventoryReceipt(token)
        : await finishPickingInventory(token, await request.json(), config.ownerId);
    return reply(result.body, result.status);
  } catch (error) {
    return reply(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "피킹 완료 결과를 확인해 주세요.",
      },
      400,
    );
  }
}
export const GET = handle;
export const POST = handle;
