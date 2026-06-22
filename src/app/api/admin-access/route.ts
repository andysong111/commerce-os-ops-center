import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

function isPasswordMatch(candidate: string, expected: string) {
  const candidateBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);

  return (
    candidateBuffer.length === expectedBuffer.length &&
    timingSafeEqual(candidateBuffer, expectedBuffer)
  );
}

export async function POST(request: Request) {
  const expectedPassword = process.env.OPS_ADMIN_PASSWORD;

  if (!expectedPassword) {
    return NextResponse.json(
      { error: "OPS_ADMIN_PASSWORD is not configured." },
      { status: 503 },
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const password =
    typeof body === "object" && body !== null && "password" in body
      ? body.password
      : undefined;

  if (typeof password !== "string" || !isPasswordMatch(password, expectedPassword)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  return NextResponse.json({ ok: true });
}
