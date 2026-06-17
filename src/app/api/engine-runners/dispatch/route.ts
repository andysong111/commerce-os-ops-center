import { NextResponse } from "next/server";
import {
  buildEngineDispatchPreview,
  isEngineDispatchTokenConfigured,
} from "@/lib/engineRunnerConfig";
import type { EngineRunnerDispatchInput } from "@/lib/engineRunnerTypes";

export async function POST(request: Request) {
  let body: EngineRunnerDispatchInput;

  try {
    body = await request.json();
    buildEngineDispatchPreview(body);
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Invalid dispatch request." },
      { status: 400 },
    );
  }

  if (!isEngineDispatchTokenConfigured()) {
    return NextResponse.json(
      { message: "GitHub Actions dispatch is not configured yet." },
      { status: 501 },
    );
  }

  return NextResponse.json(
    { message: "GitHub Actions dispatch adapter is scaffolded but not enabled in this OPS CENTER build." },
    { status: 501 },
  );
}
