import { NextResponse } from "next/server";
import { getEngineEnvConfig } from "@/lib/engineEnvConfig";
import { saveRepositorySecrets } from "@/lib/githubActionsSecrets";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null) as { engine?: unknown; secrets?: unknown } | null;
  const engine = typeof payload?.engine === "string" ? payload.engine : null;
  const config = getEngineEnvConfig(engine);
  if (!config) return NextResponse.json({ ok: false, saved: [], failed: [], skipped: [], message: "허용되지 않은 엔진입니다." }, { status: 400 });
  if (!payload || typeof payload.secrets !== "object" || payload.secrets === null || Array.isArray(payload.secrets)) {
    return NextResponse.json({ ok: false, saved: [], failed: [], skipped: [], message: "저장할 환경변수를 확인해 주세요." }, { status: 400 });
  }
  const allowed = new Set(config.secrets.map((secret) => secret.name));
  const sanitized: Record<string, string> = {};
  for (const [name, value] of Object.entries(payload.secrets as Record<string, unknown>)) {
    if (!allowed.has(name as never)) return NextResponse.json({ ok: false, saved: [], failed: [], skipped: [], message: "허용되지 않은 Secret 이름입니다." }, { status: 400 });
    if (typeof value === "string" && value.trim()) sanitized[name] = value.trim();
  }

  const result = await saveRepositorySecrets(config, sanitized);
  const ok = result.failed.length === 0;
  const partial = result.saved.length > 0 && result.failed.length > 0;
  return NextResponse.json({ ok, partial, engine: config.engine, repo: config.repo, saved: result.saved, failed: result.failed, skipped: result.skipped }, { status: ok ? 200 : 207 });
}
