import { NextResponse } from "next/server";
import {
  engineRunnerConfigs,
  isEngineDispatchTokenConfigured,
} from "@/lib/engineRunnerConfig";

export function GET() {
  return NextResponse.json({
    runners: engineRunnerConfigs,
    githubDispatchTokenConfigured: isEngineDispatchTokenConfigured(),
  });
}
