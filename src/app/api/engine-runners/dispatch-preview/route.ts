import { NextResponse } from "next/server";
import { buildEngineDispatchPreview } from "@/lib/engineRunnerConfig";
import type { EngineRunnerDispatchInput } from "@/lib/engineRunnerTypes";

export async function POST(request: Request) {
  let body: EngineRunnerDispatchInput;

  try {
    body = await request.json();
    const preview = buildEngineDispatchPreview(body);
    return NextResponse.json(preview);
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Invalid dispatch preview request." },
      { status: 400 },
    );
  }
}
