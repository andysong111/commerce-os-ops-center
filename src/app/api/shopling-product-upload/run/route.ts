import { NextResponse } from "next/server";
import { runShoplingProductUpload } from "@/lib/shoplingProductUploadRunner";

export const runtime = "nodejs";

type RequestBody = {
  rowExpression?: unknown;
  channel?: unknown;
  skip_if_goods_key?: unknown;
  dump?: unknown;
  sleep?: unknown;
};

export async function POST(request: Request) {
  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { status: "error", message: "요청 JSON을 읽을 수 없습니다." },
      { status: 400 },
    );
  }

  const result = await runShoplingProductUpload({
    rowExpression: typeof body.rowExpression === "string" ? body.rowExpression : "",
    channel: typeof body.channel === "string" ? body.channel : "",
    skip_if_goods_key: body.skip_if_goods_key === true,
    dump: body.dump === true,
    sleep: body.sleep,
  });

  const statusCode = result.status === "blocked" ? 403 : result.status === "error" ? 400 : 200;
  return NextResponse.json(result, { status: statusCode });
}
